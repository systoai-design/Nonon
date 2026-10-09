import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import { MAX_TEXT_BYTES, formatNumber, htmlToMarkdown, previewOutput } from "./outputs";

const root = mkdtempSync(join(tmpdir(), "nonon-outputs-"));
const folder = join(root, "ws");
const outside = join(root, "elsewhere");
const workspaces = { list: () => [{ folder }, { folder: null }] };

beforeAll(() => {
  mkdirSync(folder, { recursive: true });
  mkdirSync(outside, { recursive: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function table(path: string, maxRows?: number) {
  const res = await previewOutput(workspaces, path, maxRows);
  if (res.kind !== "table") throw new Error(`expected table, got ${res.kind}`);
  return res.sheets;
}

describe("previewOutput: spreadsheets", () => {
  it("reads every visible sheet of a workbook, formulas as cached results, dates and money formatted", async () => {
    const wb = new ExcelJS.Workbook();
    const summary = wb.addWorksheet("Summary");
    summary.addRow(["Group", "Amount", "Share", "When"]);
    const r = summary.addRow(["Matched", 1234567.5, 0.256, new Date(Date.UTC(2026, 4, 3))]);
    r.getCell(2).numFmt = "#,##0.00;[Red]-#,##0.00";
    r.getCell(3).numFmt = "0.0%";
    summary.addRow(["Total", { formula: "SUM(B2:B2)", result: 1234567.5 }, "", new Date(Date.UTC(2026, 4, 3, 14, 30))]);
    const only = wb.addWorksheet("Only in A");
    only.addRow(["File", "Row", "Note"]);
    only.addRow(["A", 7, { richText: [{ text: "needs " }, { text: "a look" }] }]);
    const hidden = wb.addWorksheet("Hidden");
    hidden.state = "hidden";
    hidden.addRow(["secret"]);
    wb.addWorksheet("Empty");
    const path = join(folder, "compare.xlsx");
    await wb.xlsx.writeFile(path);

    const sheets = await table(path);
    expect(sheets.map((s) => s.name)).toEqual(["Summary", "Only in A", "Empty"]);
    expect(sheets[0]?.rows[0]).toEqual(["Group", "Amount", "Share", "When"]);
    expect(sheets[0]?.rows[1]).toEqual(["Matched", "1,234,567.50", "25.6%", "2026-05-03"]);
    expect(sheets[0]?.rows[2]).toEqual(["Total", "1234567.5", "", "2026-05-03 14:30"]);
    expect(sheets[0]?.totalRows).toBe(2);
    expect(sheets[1]?.rows[1]).toEqual(["A", "7", "needs a look"]);
    expect(sheets[2]?.rows).toEqual([]);
    expect(sheets.every((s) => !s.truncated)).toBe(true);
  });

  it("caps a long, wide sheet at the requested rows and 20 columns and reports the real size", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Big");
    ws.addRow(Array.from({ length: 30 }, (_, i) => `c${i + 1}`));
    for (let r = 1; r <= 450; r++) ws.addRow(Array.from({ length: 30 }, (_, i) => r * 100 + i));
    const path = join(folder, "big.xlsx");
    await wb.xlsx.writeFile(path);

    const [full] = await table(path);
    expect(full?.rows.length).toBe(201);
    expect(full?.rows[0]?.length).toBe(20);
    expect(full?.totalRows).toBe(450);
    expect(full?.totalCols).toBe(30);
    expect(full?.truncated).toBe(true);
    expect(full?.rows[200]?.[0]).toBe("20000");

    const [small] = await table(path, 12);
    expect(small?.rows.length).toBe(13);
    expect(small?.totalRows).toBe(450);
  });

  it("shows a plain 'open it instead' result for a file that only pretends to be a workbook", async () => {
    const path = join(folder, "broken.xlsx");
    writeFileSync(path, "this is not a zip file at all");
    const res = await previewOutput(workspaces, path);
    expect(res.kind).toBe("unsupported");
    expect(res.kind === "unsupported" && res.reason).toMatch(/Open document/);
  });
});

describe("previewOutput: csv", () => {
  it("keeps quoted commas, quotes and line breaks inside their cells", async () => {
    const path = join(folder, "bank.csv");
    writeFileSync(path, 'Date,Description,Amount\n2026-05-01,"Paper, ink and toner",-120.50\n2026-05-02,"Said ""hello""",30\n2026-05-03,"two\nlines",5\n');
    const [sheet] = await table(path);
    expect(sheet?.rows).toEqual([
      ["Date", "Description", "Amount"],
      ["2026-05-01", "Paper, ink and toner", "-120.50"],
      ["2026-05-02", 'Said "hello"', "30"],
      ["2026-05-03", "two\nlines", "5"],
    ]);
    expect(sheet?.totalRows).toBe(3);
    expect(sheet?.truncated).toBe(false);
  });
});

describe("previewOutput: documents", () => {
  it("shows a Word document as markdown with headings, lists, bold and a real table", async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: "Meeting follow-up", heading: HeadingLevel.TITLE }),
            new Paragraph({ text: "Weekly meeting", heading: HeadingLevel.HEADING_1 }),
            new Paragraph({ children: [new TextRun({ text: "Missing: owner", bold: true, highlight: "yellow" })] }),
            new Paragraph({ children: [new TextRun("Agreed to "), new TextRun({ text: "ship Friday", bold: true }), new TextRun(".")] }),
            new Paragraph({ text: "Send the invoice", bullet: { level: 0 } }),
            new Paragraph({ text: "Book the room", bullet: { level: 0 } }),
            new Table({
              rows: [
                new TableRow({ children: ["Who", "What | when"].map((t) => new TableCell({ children: [new Paragraph(t)] })) }),
                new TableRow({ children: ["Sam", "Friday"].map((t) => new TableCell({ children: [new Paragraph(t)] })) }),
              ],
            }),
          ],
        },
      ],
    });
    const path = join(folder, "notes.docx");
    writeFileSync(path, await Packer.toBuffer(doc));
    const res = await previewOutput(workspaces, path);
    expect(res.kind).toBe("markdown");
    const text = res.kind === "markdown" ? res.text : "";
    expect(text.startsWith("# Meeting follow-up\n")).toBe(true);
    expect(text).toContain("\n## Weekly meeting");
    expect(text).toContain("**==Missing: owner==**");
    expect(text).toContain("Agreed to **ship Friday**.");
    expect(text).toMatch(/- Send the invoice\n- Book the room/);
    expect(text).toContain("| Who | What \\| when |");
    expect(text).toContain("| Sam | Friday |");
  });

  it("returns .md and .txt as written and pretty-prints .json", async () => {
    writeFileSync(join(folder, "a.md"), "# Title\n\n- one\n- two\n");
    writeFileSync(join(folder, "b.txt"), "plain words\n");
    writeFileSync(join(folder, "c.json"), '{"a":1,"b":[1,2]}');
    expect(await previewOutput(workspaces, join(folder, "a.md"))).toEqual({ kind: "markdown", text: "# Title\n\n- one\n- two\n", truncated: false, bytes: 21 });
    expect(await previewOutput(workspaces, join(folder, "b.txt"))).toMatchObject({ kind: "text", text: "plain words\n" });
    const json = await previewOutput(workspaces, join(folder, "c.json"));
    expect(json.kind === "text" && json.text).toContain('  "a": 1');
  });

  it("caps oversized text at about 200 KB, cuts at a line end and says so", async () => {
    const line = "0123456789 the quick brown fox\n";
    const path = join(folder, "huge.txt");
    writeFileSync(path, line.repeat(Math.ceil((MAX_TEXT_BYTES * 3) / line.length)));
    const res = await previewOutput(workspaces, path);
    expect(res.kind).toBe("text");
    if (res.kind !== "text") return;
    expect(res.truncated).toBe(true);
    expect(res.text.length).toBeLessThanOrEqual(MAX_TEXT_BYTES);
    expect(res.text.length).toBeGreaterThan(MAX_TEXT_BYTES * 0.8);
    expect(res.text.endsWith("fox")).toBe(true);
    expect(res.bytes).toBeGreaterThan(MAX_TEXT_BYTES * 2);
  });

  it("does not try to show binary files or unknown types", async () => {
    writeFileSync(join(folder, "fake.txt"), Buffer.from([1, 2, 0, 3, 4]));
    writeFileSync(join(folder, "scan.pdf"), "%PDF-1.4");
    expect((await previewOutput(workspaces, join(folder, "fake.txt"))).kind).toBe("unsupported");
    const pdf = await previewOutput(workspaces, join(folder, "scan.pdf"));
    expect(pdf).toEqual({ kind: "unsupported", reason: expect.stringContaining(".pdf") });
  });
});

describe("previewOutput: security", () => {
  it("rejects a file outside every approved folder", async () => {
    const path = join(outside, "secret.txt");
    writeFileSync(path, "do not show");
    await expect(previewOutput(workspaces, path)).rejects.toThrow(/outside your project folders/);
  });

  it("rejects relative paths, missing files, folders and parent-directory tricks", async () => {
    await expect(previewOutput(workspaces, "a.md")).rejects.toThrow(/project folders/);
    await expect(previewOutput(workspaces, join(folder, "nope.md"))).rejects.toThrow(/could not find/);
    await expect(previewOutput(workspaces, folder)).rejects.toThrow(/folder, not a file/);
    writeFileSync(join(outside, "x.txt"), "x");
    await expect(previewOutput(workspaces, join(folder, "..", "elsewhere", "x.txt"))).rejects.toThrow(/project folders/);
  });

  it("rejects a link inside the folder that points outside it", async () => {
    const target = join(outside, "linked.txt");
    writeFileSync(target, "linked secret");
    const link = join(folder, "link.txt");
    try {
      symlinkSync(target, link, "file");
    } catch {
      return; // creating links needs a privilege on some Windows setups
    }
    await expect(previewOutput(workspaces, link)).rejects.toThrow(/project folders/);
  });

  it("approves nothing when no workspace has a folder", async () => {
    await expect(previewOutput({ list: () => [{ folder: null }] }, join(folder, "a.md"))).rejects.toThrow(/project folders/);
  });
});

describe("helpers", () => {
  it("formats numbers like their Excel format", () => {
    expect(formatNumber(1234.5, "#,##0.00")).toBe("1,234.50");
    expect(formatNumber(-5, "#,##0.00;[Red]-#,##0.00")).toBe("-5.00");
    expect(formatNumber(0.1 + 0.2, "General")).toBe("0.3");
    expect(formatNumber(0.5, "0%")).toBe("50%");
    expect(formatNumber(7, undefined)).toBe("7");
  });

  it("turns mammoth html into markdown without leaking tags or entities", () => {
    const md = htmlToMarkdown("<h2>A &amp; B</h2><p>Hi <em>there</em></p><ol><li>one<ul><li>nested</li></ul></li><li>two</li></ol>");
    expect(md).toBe("## A & B\n\nHi *there*\n\n1. one\n  - nested\n2. two\n");
  });
});
