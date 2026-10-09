// The first sheet of the comparison workbook is a plain one-page answer; technical details sit on the last sheet.
import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { spreadsheetCompare } from "./index";
import { compareRecords } from "./match";
import { normRef, tokensOf } from "./records";
import { friendlyTimestamp, gapLines, headline, looksSwapped } from "./summary-text";
import { RULES_DEFAULT, SAMPLES, doneOrThrow, dumpSheet, fx, makeCtx } from "./testkit";
import { computeTotals } from "./totals";
import type { Rec } from "./types";
import { buildWorkbook, validateWorkbook, type WorkbookInput } from "./workbook";

function rec(file: "A" | "B", row: number, date: string, cents: number, desc: string, ref = ""): Rec {
  const t = tokensOf(desc);
  return {
    id: `${file}:${row}`, file, row, date, dateRaw: date, cents, cmp: cents, amountRaw: String(cents / 100),
    description: desc, descTokens: t, descNorm: t.join(" "), reference: ref, refNorm: normRef(ref), rawCells: [desc],
  };
}

function input(recsA: Rec[], recsB: Rec[]): WorkbookInput {
  const match = compareRecords(recsA, recsB, { amountTolCents: 0, dateTolDays: 3 });
  const side = (name: string, records: Rec[], sha: string) => ({
    name, sha256: sha, records: records.length, skipped: 0, headers: ["Description"], currency: "PHP",
    mappingLines: ["Date column: Date", "Description column: Description", "Amount column: Amount"],
  });
  return {
    revision: "1",
    generatedAt: "2026-10-09T09:57:35.685Z",
    a: side("books.csv", recsA, "a".repeat(64)),
    b: side("bank.csv", recsB, "b".repeat(64)),
    ruleLines: ["Amounts must match exactly", "Dates may differ by up to 3 days"],
    recsA,
    recsB,
    match,
    totals: computeTotals(recsA, recsB, match),
    skipped: [],
  };
}

describe("text helpers", () => {
  it("writes the time like 9 Oct 2026, 5:57 PM in the computer's own time zone", () => {
    const iso = "2026-10-09T09:57:35.685Z";
    const d = new Date(iso);
    const h = d.getHours();
    const mins = String(d.getMinutes()).padStart(2, "0");
    expect(friendlyTimestamp(iso)).toBe(`${d.getDate()} Oct 2026, ${h % 12 || 12}:${mins} ${h < 12 ? "AM" : "PM"}`);
    expect(friendlyTimestamp("not a date")).toBe("not a date");
  });

  it("calls two amounts swapped only when two neighbouring digits trade places", () => {
    expect(looksSwapped(384600, 348600)).toBe(true);
    expect(looksSwapped(-384600, -348600)).toBe(true);
    expect(looksSwapped(384600, 384000)).toBe(false);
    expect(looksSwapped(384600, 438600)).toBe(false);
    expect(looksSwapped(384600, -348600)).toBe(false);
    expect(looksSwapped(500, 500)).toBe(false);
  });
});

describe("summary from known numbers", () => {
  const a = [
    rec("A", 2, "2026-05-04", 384600, "Puregold groceries", "OR-1"),
    rec("A", 3, "2026-05-05", 25000, "Rent"),
    rec("A", 4, "2026-05-06", 120000, "Cash purchase"),
    rec("A", 5, "2026-05-07", 9900, "Water"),
    rec("A", 6, "2026-05-07", 9900, "Water"),
  ];
  const b = [
    rec("B", 2, "2026-05-04", 348600, "PUREGOLD QC", "OR-1"),
    rec("B", 3, "2026-05-05", 25000, "Rent"),
    rec("B", 4, "2026-05-07", 9900, "Water"),
    rec("B", 5, "2026-05-20", 4500, "Bank fee"),
  ];

  it("states the counts, the totals, the gap and where the gap comes from, in whole cents", () => {
    const t = input(a, b).totals;
    expect(t.totalA.cents).toBe(384600 + 25000 + 120000 + 9900 + 9900);
    expect(t.difference).toBe(t.totalA.cents - t.totalB.cents);
    expect(headline(t)).toBe("Of 9 rows, 4 match. 2 are only in the first file, 2 only in the second, 1 listed twice.");
    const lines = gapLines(t, "PHP").join(" ");
    expect(lines).toContain("2 items only in the first file add up to PHP 5,046.00.");
    expect(lines).toContain("2 items only in the second file add up to PHP 3,531.00.");
    expect(lines).toContain("1 row listed twice in the first file (PHP 99.00 extra).");
  });

  it("writes a Summary that opens with the answer and a last sheet that holds the technical details", async () => {
    const i = input(a, b);
    const bytes = await buildWorkbook(i);
    expect((await validateWorkbook(bytes, i)).ok).toBe(true);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    expect(wb.worksheets[0]!.name).toBe("Summary");
    expect(wb.worksheets.at(-1)!.name).toBe("About this comparison");

    const rows: string[] = [];
    wb.getWorksheet("Summary")!.eachRow((r) => rows.push(String(r.getCell(1).value ?? "")));
    const text = rows.join(" ").replace(/\s+/g, " ");
    expect(rows[0]).toBe("Comparison of books.csv and bank.csv");
    expect(text).not.toMatch(/SHA|Job version|Created|spreadsheet-compare|rows left out|Date column/);
    expect(text).toContain("The difference");
    expect(text).toContain("What to look at first");
    expect(text).toContain("The digits may be swapped.");
    expect(text).toContain("The first file says PHP 3,846.00, the second");
    expect(text).toContain("Matched (pairs)");

    const about: string[] = [];
    wb.getWorksheet("About this comparison")!.eachRow((r) => about.push(`${r.getCell(1).value ?? ""} | ${r.getCell(2).value ?? ""}`));
    const aboutText = about.join("\n");
    expect(aboutText).toContain("Amounts must match exactly");
    expect(aboutText).toContain("Dates may differ by up to 3 days");
    expect(aboutText).toContain("Date read from | Date");
    expect(aboutText).toContain("Reference read from | no column found");
    const record = aboutText.indexOf("For the record");
    expect(record).toBeGreaterThan(aboutText.indexOf("The second file"));
    expect(aboutText.indexOf(`File check code, first file | ${"a".repeat(64)}`)).toBeGreaterThan(record);
    expect(aboutText).toContain("spreadsheet-compare 1");
  });

  it("fails its own check when a number on the Summary no longer matches", async () => {
    const i = input(a, b);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildWorkbook(i)) as unknown as ExcelJS.Buffer);
    wb.getWorksheet("Summary")!.eachRow((r) => {
      if (r.getCell(1).value === "Total of the first file") r.getCell(2).value = 1;
      if (r.getCell(1).value === "Only in the first file") r.getCell(2).value = 99;
    });
    const bad = await validateWorkbook(Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer), i);
    expect(bad.ok).toBe(false);
    expect(bad.problems.join(" ")).toContain("Total of the first file");
    expect(bad.problems.join(" ")).toContain("Only in the first file");
  });

  it("says nothing needs a look when every row has its partner", async () => {
    const i = input([rec("A", 2, "2026-05-04", 5000, "Rent")], [rec("B", 2, "2026-05-04", 5000, "Rent")]);
    expect(headline(i.totals)).toBe("Of 2 rows, all 2 match.");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildWorkbook(i)) as unknown as ExcelJS.Buffer);
    const rows: string[] = [];
    wb.getWorksheet("Summary")!.eachRow((r) => rows.push(String(r.getCell(1).value ?? "")));
    expect(rows.join("\n")).toContain("Nothing needs a look.");
    expect(rows.join("\n")).toContain("There is no gap.");
  });

  it("writes every sentence as ONE cell in a wide column that wraps, so Excel and the viewer can read it", async () => {
    const i = input(a, b);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildWorkbook(i)) as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("Summary")!;
    expect(ws.getColumn(1).width).toBe(70);
    const cells = new Map<string, ExcelJS.Cell>();
    ws.eachRow((r) => cells.set(String(r.getCell(1).value ?? ""), r.getCell(1)));
    const sentences = [headline(i.totals), ...gapLines(i.totals, "PHP")];
    expect(sentences.some((s) => s.length > 46)).toBe(true);
    for (const sentence of sentences) {
      const hit = [...cells.keys()].find((k) => k.trim().startsWith(sentence.trim()));
      expect(hit, sentence).toBeDefined();
      expect(cells.get(hit!)?.alignment?.wrapText).toBe(true);
    }
    expect([...cells.keys()].some((k) => k.length > 46)).toBe(true);
    expect(wb.getWorksheet("About this comparison")!.getColumn(1).width).toBe(70);
  });
});

describe("summary from the real bookkeeping sample", () => {
  const a = path.join(SAMPLES, "expense-report-may-2026.csv");
  const b = path.join(SAMPLES, "bank-export-may-2026.csv");

  it("puts the answer first and the codes last", async () => {
    const exp = JSON.parse(readFileSync(fx("expected/sample-bookkeeping.json"), "utf8"));
    const ctx = await makeCtx({ fileA: a, fileB: b, answers: { ...RULES_DEFAULT, "rule.amountSign": "opposite" } });
    const out = doneOrThrow(await spreadsheetCompare.run(ctx));
    expect(out.checks.find((c) => c.id === "output-reopened")?.status).toBe("pass");
    const file = ctx.written[0]!.path;
    const summary = (await dumpSheet(file, "Summary")).join("\n");
    expect(summary).toContain("Of 51 rows, 38 match.");
    expect(summary).toContain("Total of the first file | 70,852.30");
    expect(summary).toContain("Total of the second file | 68,286.70");
    expect(summary).toContain("Gap (first minus second) | 2,565.60");
    expect(summary).toContain("See the sheet 'Only in A'");
    expect(exp.counts.matched).toBe(19);
    const about = (await dumpSheet(file, "About this comparison")).join("\n");
    const files = (out.report as { files: { a: { sha256: string }; b: { sha256: string } } }).files;
    expect(about).toContain(files.a.sha256);
    expect(about).toContain(files.b.sha256);
    expect(summary).not.toContain(files.a.sha256);
  });
});
