// Test helpers only (never imported by the procedure itself).
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import type {
  InferenceClient,
  InferenceRequest,
  InferenceResult,
  OutputRef,
  ProcedureOutcome,
  ProcedureRunContext,
  Task,
  Workspace,
} from "../../../../shared/contracts";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.resolve(here, "../../../../../../fixtures/spreadsheet");
export const SAMPLES = path.resolve(here, "../../../../../resources/samples/bookkeeping");

export const fx = (name: string) => path.join(FIXTURES, name);

export interface FakeAi extends InferenceClient {
  calls: InferenceRequest[];
}

export type AiHandler = (req: InferenceRequest, n: number) => string;

const LOCAL = { ai: "local", files: "this-computer" } as const;

/** MOCKED model. The default handler returns a valid explanation built only from numbers in the prompt. */
export function fakeAi(handler?: AiHandler): FakeAi {
  const calls: InferenceRequest[] = [];
  return {
    location: LOCAL,
    calls,
    async chat(req): Promise<InferenceResult> {
      calls.push(req);
      const text = (handler ?? defaultHandler)(req, calls.length);
      return { text, location: LOCAL };
    },
  };
}

function defaultHandler(req: InferenceRequest): string {
  const props = (req.jsonSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
  if ("checkFirst" in props) {
    const prompt = req.messages.map((m) => m.content).join("\n");
    const m = /Matched pairs: (\d+)/.exec(prompt);
    return JSON.stringify({
      summary: `${m?.[1] ?? "Some"} pairs of rows match between the two files. The rest are listed in the comparison workbook.`,
      checkFirst: ["Open the comparison workbook and start with the largest unmatched amount."],
    });
  }
  return JSON.stringify({ date: "", description: "", reference: "", amount: "", debit: "", credit: "" });
}

export interface TestCtx extends ProcedureRunContext {
  steps: string[];
  written: OutputRef[];
  fake: FakeAi;
}

export async function makeCtx(opts: {
  fileA: string;
  fileB: string;
  answers?: Record<string, string>;
  ai?: FakeAi | InferenceClient;
  outDir?: string;
}): Promise<TestCtx> {
  const outputDir = opts.outDir ?? (await mkdtemp(path.join(os.tmpdir(), "nonon-sheet-")));
  await mkdir(outputDir, { recursive: true });
  const fake = (opts.ai as FakeAi | undefined) ?? fakeAi();
  const steps: string[] = [];
  const written: OutputRef[] = [];
  const ctx: TestCtx = {
    task: { id: "t1", procedureId: "spreadsheet-compare" } as unknown as Task,
    workspace: { id: "w1", policy: "local-only" } as unknown as Workspace,
    outputDir,
    files: { fileA: [opts.fileA], fileB: [opts.fileB] },
    text: {},
    answers: opts.answers ?? {},
    ai: fake,
    signal: new AbortController().signal,
    step: (label, detail) => void steps.push(detail ? `${label}: ${detail}` : label),
    checkpoint: () => undefined,
    saveCheckpoint: () => undefined,
    async writeOutput(name, data, kind, label) {
      let target = path.join(outputDir, name);
      const ext = path.extname(name);
      for (let n = 2; existsSync(target); n++) target = path.join(outputDir, `${path.basename(name, ext)} (${n})${ext}`);
      await writeFile(target, data);
      const ref: OutputRef = { path: target, label: label ?? name, kind };
      written.push(ref);
      return ref;
    },
    steps,
    written,
    fake,
  };
  return ctx;
}

export const RULES_DEFAULT = { "rule.period": "overlap", "rule.amountTolerance": "0.00", "rule.dateToleranceDays": "3" };

export interface Classes {
  matched: [number, number][];
  onlyA: number[];
  onlyB: number[];
  dupA: number[];
  dupB: number[];
  ambA: number[];
  ambB: number[];
  skipped: number[];
}

/** Reads the written comparison workbook back so tests assert on what a person would open. */
export async function readClasses(file: string): Promise<Classes> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const rowsOf = (sheet: string, filter?: (r: ExcelJS.Row) => boolean) => {
    const ws = wb.getWorksheet(sheet);
    const out: ExcelJS.Row[] = [];
    ws?.eachRow((r, n) => {
      if (n > 1 && (!filter || filter(r))) out.push(r);
    });
    return out;
  };
  const num = (r: ExcelJS.Row, c: number) => Number(r.getCell(c).value);
  const bySource = (sheet: string, src: string) => rowsOf(sheet, (r) => String(r.getCell(1).value) === src).map((r) => num(r, 3));
  return {
    matched: rowsOf("Matched").map((r) => [num(r, 3), num(r, 9)] as [number, number]),
    onlyA: bySource("Only in A", "A"),
    onlyB: bySource("Only in B", "B"),
    dupA: bySource("Listed twice", "A"),
    dupB: bySource("Listed twice", "B"),
    ambA: bySource("Not sure", "A"),
    ambB: bySource("Not sure", "B"),
    skipped: rowsOf("Skipped rows").map((r) => num(r, 3)),
  };
}

function cellText(v: ExcelJS.CellValue, numFmt: string | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return numFmt?.includes("0.00") ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v);
  return String(v);
}

/** A sheet as plain text, one line per row with cells joined by " | ", the way a person reads it. */
export async function dumpSheet(file: string, sheet: string): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet(sheet);
  if (!ws) throw new Error(`no sheet ${sheet}`);
  const lines: string[] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const cell = row.getCell(c);
      cells.push(cellText(cell.value, cell.numFmt));
    }
    while (cells.length && cells[cells.length - 1] === "") cells.pop();
    lines.push(cells.join(" | "));
  });
  return lines;
}

export function doneOrThrow(o: ProcedureOutcome) {
  if (o.kind !== "done") throw new Error(`expected done, got ${JSON.stringify(o).slice(0, 600)}`);
  return o;
}
