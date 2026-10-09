import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { spreadsheetCompare } from "./index";
import { UnsupportedFile, readTable } from "./read";
import { RULES_DEFAULT, doneOrThrow, fx, makeCtx, readClasses } from "./testkit";

const dir = mkdtempSync(path.join(os.tmpdir(), "nonon-read-"));
function file(name: string, content: string | Buffer): string {
  const p = path.join(dir, name);
  writeFileSync(p, content);
  return p;
}

describe("reading CSV the way real exports look", () => {
  it("skips title lines above the header, finds the header row, keeps source row numbers, ignores blank lines", async () => {
    const p = file(
      "bank.csv",
      ["Account Statement - Sample Bank", "Account: 1234", "", "Posting Date,Description,Debit,Credit", "2026-06-01,Rice,100.00,", "", "2026-06-02,Refund,,50.00", "", ""].join("\r\n"),
    );
    const t = await readTable(p);
    expect(t.headerRow).toBe(4);
    expect(t.headers).toEqual(["Posting Date", "Description", "Debit", "Credit"]);
    expect(t.rows.map((r) => r.row)).toEqual([5, 7]);
    expect(t.lastRow).toBe(7);
    expect(t.warnings.map((w) => w.id)).toContain("header-not-first");
  });

  it("detects semicolon delimiters and decimal commas", async () => {
    const a = file("semi-a.csv", "Datum;Beschreibung;Betrag\n2026-06-01;Reis;-1.234,50\n2026-06-02;Brot;-12,5\n");
    const t = await readTable(a);
    expect(t.headers).toEqual(["Datum", "Beschreibung", "Betrag"]);
    const ctx = await makeCtx({ fileA: a, fileB: file("semi-b.csv", "Date,Description,Amount\n2026-06-01,REIS,-1234.50\n2026-06-02,BROT,-12.50\n"), answers: { ...RULES_DEFAULT, "map.a.date": "Datum", "map.a.description": "Beschreibung", "map.a.amount": "Betrag" } });
    const out = doneOrThrow(await spreadsheetCompare.run(ctx));
    expect((out.report as { counts: { matched: number } }).counts.matched).toBe(2);
  });

  it("reads UTF-16 and Windows-1252 text", async () => {
    const text = "Date,Description,Amount\n2026-06-01,Café,-10.00\n";
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    expect((await readTable(file("u16.csv", utf16))).rows[0]?.cells[1]?.t).toBe("Café");
    const latin = Buffer.from(text, "latin1");
    expect((await readTable(file("latin.csv", latin))).rows[0]?.cells[1]?.t).toBe("Café");
  });

  it("refuses files over the row limit and old Excel formats, with a way forward", async () => {
    const big = file("big.csv", "Date,Amount\n" + Array.from({ length: 12 }, (_, i) => `2026-06-01,${i + 1}.00`).join("\n"));
    await expect(readTable(big, { maxRows: 10 })).rejects.toThrow(/up to 10 rows/);
    await expect(readTable(file("old.xls", "x"))).rejects.toMatchObject({ suggestion: expect.stringContaining("Save As") });
    await expect(readTable(file("empty.csv", ""))).rejects.toBeInstanceOf(UnsupportedFile);
    await expect(readTable(file("broken.xlsx", "this is not a zip"))).rejects.toThrow(/not a proper \.xlsx/);
    await expect(readTable(file("locked.xlsx", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0, 0, 0])))).rejects.toThrow(/has a password/);
  });
});

describe("procedure on awkward inputs", () => {
  const B = () => file("plain-b.csv", "Date,Description,Amount\n2026-06-01,RICE,-100.00\n2026-06-02,REFUND,50.00\n");

  it("maps Debit and Credit columns, skips total lines, and offers no edit when the header is not on row 1", async () => {
    const a = file(
      "bank2.csv",
      ["Statement,,,", "Posting Date,Description,Debit,Credit,Balance", "2026-06-01,Rice,100.00,,900.00", "2026-06-02,Refund,,50.00,950.00", "Total,,100.00,50.00,"].join("\n"),
    );
    const ctx = await makeCtx({ fileA: a, fileB: B(), answers: RULES_DEFAULT });
    const out = doneOrThrow(await spreadsheetCompare.run(ctx));
    const r = out.report as { counts: Record<string, number>; mapping: { a: string[] }; files: { a: { skipped: number } } };
    expect(r.mapping.a).toEqual(["Date column: Posting Date", "Description column: Description", "Debit column: Debit", "Credit column: Credit"]);
    expect(r.counts).toMatchObject({ totalA: 2, matched: 2 });
    expect(r.files.a.skipped).toBe(1);
    const c = await readClasses(ctx.written[0]!.path);
    expect(c.skipped).toEqual([5]);
    expect(out.proposals).toHaveLength(0);
    expect(out.checks.find((x) => x.id === "proposal-offered")?.detail).toContain("row 2");
  });

  it("a Total line with an amount but no date is not treated as an entry", async () => {
    const a = file("tot.csv", "Date,Description,Amount\n2026-06-01,Rice,-100.00\n2026-06-02,Refund,50.00\n,Grand total,-50.00\n");
    const ctx = await makeCtx({ fileA: a, fileB: B(), answers: RULES_DEFAULT });
    const out = doneOrThrow(await spreadsheetCompare.run(ctx));
    expect((out.report as { counts: { totalA: number } }).counts.totalA).toBe(2);
    expect(out.checks.find((x) => x.id === "skipped-rows-a")?.status).toBe("warn");
  });

  it("an unreadable amount is left out and reported, never guessed", async () => {
    const good = Array.from({ length: 8 }, (_, i) => `2026-06-0${i + 1},Item ${i},-${10 + i}.00`);
    const a = file("bad.csv", ["Date,Description,Amount", ...good, "2026-06-09,Refund,fifty"].join("\n"));
    const b = file("bad-b.csv", ["Date,Description,Amount", ...good.map((l) => l.toUpperCase())].join("\n"));
    const ctx = await makeCtx({ fileA: a, fileB: b, answers: RULES_DEFAULT });
    const out = doneOrThrow(await spreadsheetCompare.run(ctx));
    expect((out.report as { counts: { totalA: number; matched: number } }).counts).toMatchObject({ totalA: 8, matched: 8 });
    expect(out.checks.find((x) => x.id === "skipped-rows-a")?.detail).toContain("Rows 10");
  });

  it("rows with an unreadable date can only match by reference", async () => {
    const rows = Array.from({ length: 8 }, (_, i) => `2026-06-0${i + 2},Item ${i},,-${20 + i}.00`);
    const a = file("nodate.csv", ["Date,Description,Reference,Amount", "soon,Rice,REF-1,-100.00", ...rows].join("\n"));
    const b = file("nodate-b.csv", ["Date,Description,Reference,Amount", "2026-06-01,RICE,REF-1,-100.00", ...rows.map((l) => l.toUpperCase())].join("\n"));
    const ctx = await makeCtx({ fileA: a, fileB: b, answers: RULES_DEFAULT });
    const out = doneOrThrow(await spreadsheetCompare.run(ctx));
    expect((out.report as { counts: { matched: number } }).counts.matched).toBe(9);
    expect(out.checks.some((x) => x.id.startsWith("unreadable-dates"))).toBe(true);
  });

  it("stops when the files are in different currencies", async () => {
    const a = file("php.csv", "Date,Description,Amount\n2026-06-01,Rice,PHP -100.00\n");
    const b = file("usd.csv", "Date,Description,Amount\n2026-06-01,Rice,USD -100.00\n");
    const out = await spreadsheetCompare.run(await makeCtx({ fileA: a, fileB: b, answers: RULES_DEFAULT }));
    expect(out.kind === "unsupported" && out.reason).toContain("PHP");
    expect(out.kind === "unsupported" && out.reason).toContain("USD");
  });

  it("stops when one file mixes currencies", async () => {
    const a = file("mixcur.csv", "Date,Description,Amount\n2026-06-01,Rice,PHP -100.00\n2026-06-02,Rice,USD -5.00\n");
    const out = await spreadsheetCompare.run(await makeCtx({ fileA: a, fileB: B(), answers: RULES_DEFAULT }));
    expect(out.kind === "unsupported" && out.reason).toContain("more than one currency");
  });

  it("stops when the two files cover different periods", async () => {
    const a = file("june.csv", "Date,Description,Amount\n2026-06-01,Rice,-100.00\n2026-06-02,Rice,-5.00\n");
    const b = file("july.csv", "Date,Description,Amount\n2026-07-01,Rice,-100.00\n2026-07-02,Rice,-5.00\n");
    const out = await spreadsheetCompare.run(await makeCtx({ fileA: a, fileB: b, answers: RULES_DEFAULT }));
    expect(out.kind === "unsupported" && out.reason).toContain("different dates");
  });

  it("applies an amount tolerance when the user sets one", async () => {
    const a = file("tol-a.csv", "Date,Description,Amount\n2026-06-01,Rice,-100.00\n");
    const b = file("tol-b.csv", "Date,Description,Amount\n2026-06-01,RICE,-100.05\n");
    const strict = doneOrThrow(await spreadsheetCompare.run(await makeCtx({ fileA: a, fileB: b, answers: RULES_DEFAULT })));
    expect((strict.report as { counts: { matched: number } }).counts.matched).toBe(0);
    const loose = doneOrThrow(await spreadsheetCompare.run(await makeCtx({ fileA: a, fileB: b, answers: { ...RULES_DEFAULT, "rule.amountTolerance": "0.10" } })));
    expect((loose.report as { counts: { matched: number } }).counts.matched).toBe(1);
  });

  it("re-asks when a rule answer is not usable", async () => {
    const ctx = await makeCtx({ fileA: fx("clean-a.csv"), fileB: fx("clean-b.csv"), answers: { ...RULES_DEFAULT, "rule.dateToleranceDays": "lots", "rule.amountTolerance": "-3" } });
    const out = await spreadsheetCompare.run(ctx);
    expect(out.kind === "needs-input" && out.questions.map((q) => q.id)).toEqual(["rule.amountTolerance", "rule.dateToleranceDays"]);
  });
});
