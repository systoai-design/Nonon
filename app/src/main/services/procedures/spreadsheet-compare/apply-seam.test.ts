// Seam test: the staged edits this procedure produces are applied by the REAL change appliers
// (services/changes/csv.ts and xlsx.ts, owned by another workstream) on in-memory copies of the fixtures.
// The model is mocked here; the appliers are not.
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { applyCsvEdit } from "../../changes/csv";
import { applyXlsxEdit } from "../../changes/xlsx";
import { spreadsheetCompare } from "./index";
import { RULES_DEFAULT, doneOrThrow, fx, makeCtx } from "./testkit";

describe("staged edit applies cleanly", () => {
  it("CSV: two columns are appended, every other cell is untouched, statuses land on the right rows", async () => {
    const ctx = await makeCtx({ fileA: fx("mixed-a.csv"), fileB: fx("mixed-b.csv"), answers: RULES_DEFAULT });
    const out = doneOrThrow(await spreadsheetCompare.run(ctx));
    const edit = out.proposals[0]!.edits[0]!;
    if (edit.op !== "csv-set-cells") throw new Error("expected csv edit");
    const original = readFileSync(fx("mixed-a.csv"));
    const result = applyCsvEdit(original, edit, "mixed-a.csv");

    const before = Papa.parse<string[]>(original.toString("utf8"), { skipEmptyLines: true }).data;
    const after = Papa.parse<string[]>(result.bytes.toString("utf8"), { skipEmptyLines: true }).data;
    expect(after).toHaveLength(before.length);
    expect(after[0]!.slice(-2)).toEqual(["NONON status", "NONON note"]);
    for (let r = 0; r < before.length; r++) expect(after[r]!.slice(0, 4)).toEqual(before[r]);

    const exp = JSON.parse(readFileSync(fx("expected/mixed.json"), "utf8"));
    const statusAt = (row: number) => after[row - 1]![4];
    for (const row of exp.rows.onlyA) expect(statusAt(row)).toBe("only here");
    for (const row of exp.rows.duplicateA) expect(statusAt(row)).toBe("listed twice");
    for (const row of exp.rows.ambiguousA) expect(statusAt(row)).toBe("check");
    for (const m of exp.rows.matched) expect(statusAt(m.a)).toBe("matched");
    expect(result.bytes.subarray(0, 3)).not.toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it("XLSX: two columns are appended on the chosen sheet and the original cells keep their values", async () => {
    const ctx = await makeCtx({ fileA: fx("mixed-a.xlsx"), fileB: fx("mixed-b.xlsx"), answers: RULES_DEFAULT });
    const out = doneOrThrow(await spreadsheetCompare.run(ctx));
    const edit = out.proposals[0]!.edits[0]!;
    if (edit.op !== "xlsx-set-cells") throw new Error("expected xlsx edit");
    const original = readFileSync(fx("mixed-a.xlsx"));
    const result = await applyXlsxEdit(original, edit, "mixed-a.xlsx");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(result.bytes as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("Ledger")!;
    expect(ws.getRow(1).getCell(5).value).toBe("NONON status");
    expect(ws.getRow(1).getCell(6).value).toBe("NONON note");
    const exp = JSON.parse(readFileSync(fx("expected/mixed-xlsx.json"), "utf8"));
    for (const row of exp.rows.onlyA) expect(ws.getRow(row).getCell(5).value).toBe("only here");
    for (const m of exp.rows.matched) expect(ws.getRow(m.a).getCell(5).value).toBe("matched");

    const wb0 = new ExcelJS.Workbook();
    await wb0.xlsx.load(original as unknown as ExcelJS.Buffer);
    const ws0 = wb0.getWorksheet("Ledger")!;
    for (let r = 1; r <= ws0.rowCount; r++) for (let c = 1; c <= 4; c++) expect(ws.getRow(r).getCell(c).value).toEqual(ws0.getRow(r).getCell(c).value);
  });
});
