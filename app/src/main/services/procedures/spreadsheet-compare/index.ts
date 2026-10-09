import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  Check,
  ChangeProposalDraft,
  ProcedureDef,
  ProcedureOutcome,
  ProcedureRunContext,
  Question,
} from "../../../../shared/contracts";
import { aiHeaderHints } from "./ai-map";
import {
  mappingQuestions,
  profileColumns,
  proposeMapping,
  toMapping,
  type ColumnProfile,
  type ProposedMapping,
} from "./columns";
import {
  analyseDateColumn,
  friendlyDate,
  rangeOf,
  resolveDate,
  suggestOrder,
  type DateColumnInfo,
  type DateRange,
} from "./dates";
import { explain, topItems, type ExplainInput } from "./explain";
import { compareRecords } from "./match";
import { formatMoney, parseMoney } from "./money";
import { buildProposal } from "./proposal";
import { MAX_ROWS, readTable, UnsupportedFile } from "./read";
import { applySignRule, buildRecords, signsDiffer, skippedChecks, type BuildOutput, type SignRule } from "./records";
import { accountingChecks, computeTotals } from "./totals";
import type { DateOrder, FieldKey, Mapping, ReadTable, Rec, Rules } from "./types";
import { buildWorkbook, validateWorkbook, validationCheck, type WorkbookInput } from "./workbook";

const REVISION = "1";
const DEFAULT_DATE_TOL = 3;

const SIGN_LABEL: Record<SignRule, string> = {
  same: "Amounts were compared as written",
  opposite: "Plus and minus were flipped in the second file (one file shows spending as plus, the other as minus)",
  ignore: "Plus and minus were ignored",
};

interface Side {
  table: ReadTable;
  profiles: ColumnProfile[];
  proposal: ProposedMapping;
  mapping: Mapping | null;
  questions: Question[];
}

async function mapSide(ctx: ProcedureRunContext, table: ReadTable, prefix: string, label: string): Promise<Side> {
  const profiles = profileColumns(table);
  let proposal = proposeMapping(table, profiles, ctx.answers, prefix);
  const required: FieldKey[] = ["date", "amount", "debit", "credit"];
  const unsure = required.some((f) => {
    const c = proposal.fields[f];
    return c && !c.confident && !c.answered;
  });
  const plausible = profiles.some((p) => p.money > 0) && profiles.some((p) => p.dateLike > 0);
  if (unsure && plausible) {
    ctx.step(`Reading the column titles in file ${label}`);
    const hints = await aiHeaderHints(ctx.ai, table, ctx.signal);
    if (hints) proposal = proposeMapping(table, profiles, ctx.answers, prefix, hints);
  }
  return { table, profiles, proposal, mapping: toMapping(proposal), questions: mappingQuestions(table, profiles, proposal, prefix, label) };
}

function missingReason(side: Side, label: string): string | null {
  if (side.mapping) return null;
  const f = side.proposal.fields;
  const parts: string[] = [];
  if (f.date?.col == null) parts.push("a date column");
  const hasAmount = f.amount?.col != null || f.debit?.col != null || f.credit?.col != null;
  if (!hasAmount) parts.push("an amount column (one column of numbers, or separate Debit and Credit columns)");
  return `File ${label} ("${side.table.name}") is missing ${parts.join(" and ")}. These are the columns NONON found: ${side.table.headers.join(", ")}.`;
}

function dateRangeOf(recs: Rec[]): DateRange | null {
  return rangeOf(recs.map((r) => r.date).filter((d): d is string => d !== null));
}

function parseDays(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\s*\d{1,2}\s*$/.test(raw)) return undefined;
  const n = Number(raw);
  return n >= 0 && n <= 31 ? n : undefined;
}

function parseTolerance(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const m = parseMoney(raw);
  return m && m.cents >= 0 && m.cents <= 1_000_000 ? m.cents : undefined;
}

function columnName(table: ReadTable, i: number | null): string | null {
  return i === null ? null : (table.headers[i] ?? null);
}

function mappingLines(table: ReadTable, m: Mapping): string[] {
  const out: string[] = [];
  const add = (label: string, i: number | null) => {
    const n = columnName(table, i);
    if (n) out.push(`${label} column: ${n}`);
  };
  add("Date", m.date);
  add("Description", m.description);
  add("Reference", m.reference);
  add("Amount", m.amount);
  add("Debit", m.debit);
  add("Credit", m.credit);
  return out;
}

async function run(ctx: ProcedureRunContext): Promise<ProcedureOutcome> {
  const pathA = ctx.files.fileA?.[0];
  const pathB = ctx.files.fileB?.[0];
  if (!pathA || !pathB) return { kind: "unsupported", reason: "Choose two files to compare: file A and file B." };
  if (path.resolve(pathA).toLowerCase() === path.resolve(pathB).toLowerCase()) {
    return { kind: "unsupported", reason: "File A and file B are the same file.", suggestion: "Choose two different files." };
  }

  ctx.step("Opening both files");
  let tableA: ReadTable;
  let tableB: ReadTable;
  try {
    [tableA, tableB] = await Promise.all([
      readTable(pathA, { sheet: ctx.answers["sheet.a"], maxRows: MAX_ROWS }),
      readTable(pathB, { sheet: ctx.answers["sheet.b"], maxRows: MAX_ROWS }),
    ]);
  } catch (e) {
    if (e instanceof UnsupportedFile) return { kind: "unsupported", reason: e.message, ...(e.suggestion ? { suggestion: e.suggestion } : {}) };
    throw e;
  }
  ctx.signal.throwIfAborted();

  const questions: Question[] = [];
  for (const [t, id, label] of [[tableA, "sheet.a", "A"], [tableB, "sheet.b", "B"]] as const) {
    if (!t.needsSheet || ctx.answers[id]) continue;
    questions.push({
      id,
      prompt: `"${t.name}" (file ${label}) has more than one sheet with data. Which sheet should NONON use?`,
      kind: "choice",
      options: t.sheets.filter((s) => s.rows >= 2).map((s) => ({ value: s.name, label: `${s.name} (${s.rows} rows)` })),
      ...(t.sheet ? { suggested: t.sheet } : {}),
    });
  }

  ctx.step("Finding the date, amount and description in each file");
  const sideA = await mapSide(ctx, tableA, "map.a", "A");
  const sideB = await mapSide(ctx, tableB, "map.b", "B");
  const problems = [missingReason(sideA, "A"), missingReason(sideB, "B")].filter((x): x is string => x !== null);
  if (problems.length) {
    return {
      kind: "unsupported",
      reason: problems.join(" "),
      suggestion: "Each file needs a date column and an amount column. Add them, or choose a different file. Nothing was changed.",
    };
  }
  questions.push(...sideA.questions, ...sideB.questions);
  const mapA = sideA.mapping as Mapping;
  const mapB = sideB.mapping as Mapping;

  // Day/month order, per file.
  const infoA = analyseDateColumn(tableA.rows.map((r) => r.cells[mapA.date] ?? { t: "" }));
  const infoB = analyseDateColumn(tableB.rows.map((r) => r.cells[mapB.date] ?? { t: "" }));
  const siblingRange = (info: DateColumnInfo): DateRange | null => {
    if (info.status === "ambiguous" || info.status === "mixed") return null;
    const order: DateOrder = info.order ?? "DMY";
    return rangeOf(info.values.map((v) => resolveDate(v, order)).filter((d): d is string => d !== null));
  };
  const orders: Record<"a" | "b", DateOrder> = { a: "DMY", b: "DMY" };
  const pendingDateOrder: boolean[] = [];
  for (const [key, info, sibling, table] of [
    ["a", infoA, infoB, tableA],
    ["b", infoB, infoA, tableB],
  ] as const) {
    if (info.status === "determined" && info.order) orders[key] = info.order;
    else if (info.status === "ambiguous" || info.status === "mixed") {
      const answered = ctx.answers[`rule.dateOrder.${key}`];
      if (answered === "DMY" || answered === "MDY") orders[key] = answered;
      else {
        const suggested = suggestOrder(info.values, siblingRange(sibling));
        orders[key] = suggested;
        pendingDateOrder.push(true);
        const ex = info.example;
        const dmy = ex ? resolveDate(ex, "DMY") : null;
        const mdy = ex ? resolveDate(ex, "MDY") : null;
        questions.push({
          id: `rule.dateOrder.${key}`,
          prompt: ex
            ? `A date like ${ex.text} in "${table.name}" could be read two ways. Is it ${dmy ? friendlyDate(dmy) : "day first"} (day first) or ${mdy ? friendlyDate(mdy) : "month first"} (month first)?`
            : `Some dates in "${table.name}" are written day first and some month first. Which is right for this file?`,
          kind: "choice",
          options: [
            { value: "DMY", label: "Day first (31/12/2026)" },
            { value: "MDY", label: "Month first (12/31/2026)" },
          ],
          suggested,
        });
      }
    }
  }

  const built = {
    a: buildRecords(tableA, mapA, orders.a, "A"),
    b: buildRecords(tableB, mapB, orders.b, "B"),
  };
  const noRecords = (b: BuildOutput, t: ReadTable, label: string) =>
    b.records.length === 0 ? `NONON could not find any rows with an amount in file ${label} ("${t.name}").` : null;
  const empty = [noRecords(built.a, tableA, "A"), noRecords(built.b, tableB, "B")].filter((x): x is string => x !== null);
  if (empty.length) return { kind: "unsupported", reason: empty.join(" "), suggestion: "Check that the amount column holds numbers. Nothing was changed." };

  // One currency per file, and the same currency in both.
  const curA = [...built.a.currencies];
  const curB = [...built.b.currencies];
  if (curA.length > 1 || curB.length > 1) {
    const which = curA.length > 1 ? `File A (${curA.join(", ")})` : `File B (${curB.join(", ")})`;
    return { kind: "unsupported", reason: `${which} has more than one currency. NONON cannot compare mixed currencies or convert between them.`, suggestion: "Split the file by currency, then compare each part. Nothing was changed." };
  }
  if (curA[0] && curB[0] && curA[0] !== curB[0]) {
    return { kind: "unsupported", reason: `File A is in ${curA[0]} and file B is in ${curB[0]}. NONON cannot convert between currencies.`, suggestion: "Save both files in the same currency, then try again. Nothing was changed." };
  }
  const currency = curA[0] ?? curB[0] ?? null;

  // Sign convention.
  let signRule: SignRule = "same";
  if (signsDiffer(built.a.records, built.b.records)) {
    const ans = ctx.answers["rule.amountSign"];
    if (ans === "same" || ans === "opposite" || ans === "ignore") signRule = ans;
    else {
      signRule = "opposite";
      questions.push({
        id: "rule.amountSign",
        prompt: "One file shows spending as plus numbers and the other as minus numbers. Should NONON treat them as the same thing?",
        kind: "choice",
        options: [
          { value: "opposite", label: "Yes, flip file B (usual for a bank statement against an expense list)" },
          { value: "ignore", label: "Ignore plus and minus" },
          { value: "same", label: "No, compare as written" },
        ],
        suggested: "opposite",
      });
    }
  }
  applySignRule(built.a.records, built.b.records, signRule);

  // Period.
  const rangeA = dateRangeOf(built.a.records);
  const rangeB = dateRangeOf(built.b.records);
  let overlap: DateRange | null = null;
  if (rangeA && rangeB) {
    const from = rangeA.from > rangeB.from ? rangeA.from : rangeB.from;
    const to = rangeA.to < rangeB.to ? rangeA.to : rangeB.to;
    overlap = from <= to ? { from, to } : null;
    if (!overlap && !pendingDateOrder.length) {
      return {
        kind: "unsupported",
        reason: `The two files cover different dates. File A runs ${friendlyDate(rangeA.from)} to ${friendlyDate(rangeA.to)}. File B runs ${friendlyDate(rangeB.from)} to ${friendlyDate(rangeB.to)}. There is nothing to compare.`,
        suggestion: "Choose two files for the same period. Or check whether the dates are written day first or month first. Nothing was changed.",
      };
    }
  }
  let usePeriod = false;
  if (overlap) {
    const ans = ctx.answers["rule.period"];
    if (ans === "overlap" || ans === "all") usePeriod = ans === "overlap";
    else {
      usePeriod = true;
      questions.push({
        id: "rule.period",
        prompt: `Both files cover ${friendlyDate(overlap.from)} to ${friendlyDate(overlap.to)}. Which dates do you want to compare?`,
        kind: "choice",
        options: [
          { value: "overlap", label: `Only ${friendlyDate(overlap.from)} to ${friendlyDate(overlap.to)} (where both overlap)` },
          { value: "all", label: "Everything in both files" },
        ],
        suggested: "overlap",
      });
    }
  }

  // Matching rules.
  let amountTolCents = parseTolerance(ctx.answers["rule.amountTolerance"]);
  if (amountTolCents === undefined) {
    amountTolCents = 0;
    questions.push({
      id: "rule.amountTolerance",
      prompt: "How far apart can two amounts be and still count as the same? Type 0.00 if they must match exactly.",
      kind: "text",
      suggested: "0.00",
    });
  }
  let dateTolDays = parseDays(ctx.answers["rule.dateToleranceDays"]);
  if (dateTolDays === undefined) {
    dateTolDays = DEFAULT_DATE_TOL;
    questions.push({
      id: "rule.dateToleranceDays",
      prompt: "How many days apart can two dates be and still count as the same payment? Banks often record a payment a day or two after you do.",
      kind: "text",
      suggested: String(DEFAULT_DATE_TOL),
    });
  }

  if (questions.length) {
    return {
      kind: "needs-input",
      reason: "A few quick questions before NONON compares. Each one has a suggested answer you can accept.",
      questions,
    };
  }

  // ---------------------------------------------------------------- match
  const rules: Rules = { amountTolCents, dateTolDays };
  ctx.step("Matching rows", `${built.a.records.length} rows in A, ${built.b.records.length} rows in B`);
  const recsA = built.a.records;
  const recsB = built.b.records;
  const match = compareRecords(recsA, recsB, rules);
  const totals = computeTotals(recsA, recsB, match);
  ctx.signal.throwIfAborted();

  const checks: Check[] = [];
  checks.push({
    id: "files-read",
    label: "Both files were opened and read",
    status: "pass",
    detail: `${tableA.name}: ${recsA.length} rows${tableA.sheet ? ` (sheet "${tableA.sheet}")` : ""}. ${tableB.name}: ${recsB.length} rows${tableB.sheet ? ` (sheet "${tableB.sheet}")` : ""}.`,
  });
  checks.push(...tableA.warnings, ...tableB.warnings);
  checks.push(...skippedChecks("A", tableA.name, built.a.skipped), ...skippedChecks("B", tableB.name, built.b.skipped));
  for (const [b, name] of [[built.a, tableA.name], [built.b, tableB.name]] as const) {
    if (b.missingDates) {
      checks.push({
        id: `unreadable-dates-${name}`,
        label: `${b.missingDates === 1 ? "1 date" : `${b.missingDates} dates`} in "${name}" could not be read`,
        status: "warn",
        detail: "Those rows can only be matched by their reference number. NONON does not guess a date.",
      });
    }
    if (b.fractionalAmounts) {
      checks.push({ id: `fractional-${name}`, label: `${b.fractionalAmounts === 1 ? "1 amount" : `${b.fractionalAmounts} amounts`} in "${name}" had more than two decimal places`, status: "warn", detail: "They were rounded to two decimal places." });
    }
  }
  if (!mapA.description || !mapB.description) {
    checks.push({
      id: "no-description",
      label: "One file has no description column",
      status: "warn",
      detail: "That file was matched by amount and date only, so look closely at the matches.",
    });
  }
  if (infoA.status === "mixed" || infoB.status === "mixed") {
    checks.push({ id: "mixed-date-order", label: "A date column mixes day-first and month-first dates", status: "warn", detail: "Some dates may be read the wrong way. Look at the rows whose dates could not be read." });
  }
  checks.push(...accountingChecks(recsA, recsB, match, totals));
  const weak = match.pairs.filter((p) => p.how === "amount-date").length;
  if (weak) {
    checks.push({
      id: "weak-matches",
      label: weak === 1 ? "1 match is based on the amount and date only" : `${weak} matches are based on the amount and date only`,
      status: "warn",
      detail: "The descriptions are different in those. They are marked 'Amount and date only' on the Matched sheet, so have a look.",
    });
  }

  // Rows that fall outside the shared period are probably someone else's month.
  let outside = 0;
  if (usePeriod && overlap) {
    for (const x of [...match.onlyA, ...match.onlyB]) {
      if (x.rec.date && (x.rec.date < overlap.from || x.rec.date > overlap.to)) {
        outside++;
        x.note = `${x.note ? x.note + ". " : ""}Outside the dates both files cover`;
      }
    }
  }
  const periodNote = usePeriod && overlap && outside
    ? `${outside} of the rows found in only one file fall outside the dates both files cover (${friendlyDate(overlap.from)} to ${friendlyDate(overlap.to)}).`
    : "";

  // ---------------------------------------------------------------- output workbook
  const readAs = (info: DateColumnInfo, order: DateOrder) =>
    info.num3 ? (order === "DMY" ? "day first" : "month first") : "as written (no day and month mix-up is possible)";
  const ruleLines = [
    amountTolCents === 0 ? "Amounts must match exactly" : `Amounts may differ by up to ${formatMoney(amountTolCents, currency)}`,
    dateTolDays === 0 ? "Dates must match exactly" : `Dates may differ by up to ${dateTolDays} day${dateTolDays === 1 ? "" : "s"}`,
    `Dates in the first file are read ${readAs(infoA, orders.a)}`,
    `Dates in the second file are read ${readAs(infoB, orders.b)}`,
    overlap
      ? usePeriod
        ? `Only the dates both files cover were compared (${friendlyDate(overlap.from)} to ${friendlyDate(overlap.to)})`
        : "Everything in both files was compared"
      : "Dates were not limited",
    SIGN_LABEL[signRule],
    "Rows are paired by the same reference first, then by amount, date and wording. Each row is used once",
  ];
  const wbInput: WorkbookInput = {
    revision: REVISION,
    generatedAt: new Date().toISOString(),
    a: {
      name: tableA.name, sha256: tableA.fingerprint.sha256, ...(tableA.sheet ? { sheet: tableA.sheet } : {}), records: recsA.length,
      skipped: built.a.skipped.length, headers: tableA.headers, mappingLines: mappingLines(tableA, mapA), currency: curA[0] ?? null,
    },
    b: {
      name: tableB.name, sha256: tableB.fingerprint.sha256, ...(tableB.sheet ? { sheet: tableB.sheet } : {}), records: recsB.length,
      skipped: built.b.skipped.length, headers: tableB.headers, mappingLines: mappingLines(tableB, mapB), currency: curB[0] ?? null,
    },
    ruleLines,
    recsA,
    recsB,
    match,
    totals,
    skipped: [...built.a.skipped, ...built.b.skipped],
  };
  ctx.step("Building your comparison spreadsheet");
  const bytes = await buildWorkbook(wbInput);
  const pre = await validateWorkbook(bytes, wbInput);
  if (!pre.ok) throw new Error(`NONON built the comparison spreadsheet, but it did not pass its own check, so nothing was saved. Please try again. (${pre.problems.slice(0, 3).join(" ")})`);
  const stem = (n: string) => n.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 40);
  const output = await ctx.writeOutput(`Comparison - ${stem(tableA.name)} vs ${stem(tableB.name)}.xlsx`, bytes, "xlsx", "Comparison spreadsheet");
  ctx.step("Checking the saved spreadsheet");
  const reread = await validateWorkbook(await readFile(output.path), wbInput);
  checks.push(validationCheck(reread, output.label, totals.difference));

  // ---------------------------------------------------------------- explanation
  ctx.step("Writing a short explanation");
  const explainInput: ExplainInput = {
    nameA: tableA.name,
    nameB: tableB.name,
    currency,
    match,
    totals,
    ruleLines,
    skippedA: built.a.skipped.length,
    skippedB: built.b.skipped.length,
    periodNote,
  };
  const explanation = await explain(ctx.ai, explainInput, ctx.signal);
  if (explanation.check) checks.push(explanation.check);

  // ---------------------------------------------------------------- staged change to file A
  const proposals: ChangeProposalDraft[] = [];
  const prop = buildProposal({ table: tableA, label: "A", mapping: mapA, recs: recsA, byId: match.byId, skipped: built.a.skipped, otherName: tableB.name });
  checks.push(prop.check);
  if (prop.draft) proposals.push(prop.draft);

  // ---------------------------------------------------------------- outcome
  const m = (c: number) => formatMoney(c, currency);
  const t = totals;
  const numbers = [
    `Rows compared: ${recsA.length} in A, ${recsB.length} in B`,
    `Matched pairs: ${t.matched.pairs}`,
    `Only in A: ${t.onlyA.count} (${m(t.onlyA.cents)})`,
    `Only in B: ${t.onlyB.count} (${m(t.onlyB.cents)})`,
    `Listed twice: ${t.dupA.count} in A (${m(t.dupA.cents)}), ${t.dupB.count} in B (${m(t.dupB.cents)})`,
    `Not sure which row matches: ${t.ambA.count} in A, ${t.ambB.count} in B`,
    `Totals: A ${m(t.totalA.cents)}, B ${m(t.totalB.cents)}, difference ${m(t.difference)}`,
  ];
  const lead = explanation.source === "model" ? explanation.summary : `Standard summary (the AI could not write one this time): ${explanation.summary}`;
  const summary = [
    lead,
    "",
    "Look at these first:",
    ...explanation.checkFirst.map((x) => `- ${x}`),
    "",
    "The numbers (calculated by NONON, not by AI):",
    ...numbers.map((x) => `- ${x}`),
  ].join("\n");

  const report = {
    kind: "spreadsheet-compare",
    revision: REVISION,
    files: {
      a: { name: tableA.name, sheet: tableA.sheet ?? null, rows: recsA.length, skipped: built.a.skipped.length, sha256: tableA.fingerprint.sha256, currency: curA[0] ?? null },
      b: { name: tableB.name, sheet: tableB.sheet ?? null, rows: recsB.length, skipped: built.b.skipped.length, sha256: tableB.fingerprint.sha256, currency: curB[0] ?? null },
    },
    mapping: { a: mappingLines(tableA, mapA), b: mappingLines(tableB, mapB) },
    rules: {
      amountToleranceCents: amountTolCents,
      dateToleranceDays: dateTolDays,
      dateOrder: orders,
      period: usePeriod && overlap ? overlap : null,
      signRule,
    },
    counts: {
      totalA: recsA.length,
      totalB: recsB.length,
      matched: t.matched.pairs,
      onlyA: t.onlyA.count,
      onlyB: t.onlyB.count,
      duplicateA: t.dupA.count,
      duplicateB: t.dupB.count,
      ambiguousA: t.ambA.count,
      ambiguousB: t.ambB.count,
    },
    totalsCents: {
      a: t.totalA.cents,
      b: t.totalB.cents,
      difference: t.difference,
      byClass: t.rows.map((r) => ({ key: r.key, label: r.label, aCount: r.a.count, bCount: r.b.count, aCents: r.a.cents, bCents: r.b.cents, effectCents: r.effect })),
    },
    top: topItems(match, 10).map((x) => ({ ...x, amountCents: x.cmp })),
    explanation: {
      source: explanation.source,
      summary: explanation.summary,
      checkFirst: explanation.checkFirst,
      attempts: explanation.attempts,
      ...(explanation.timingMs !== undefined ? { timingMs: explanation.timingMs } : {}),
    },
  };

  return { kind: "done", summary, outputs: [output], proposals, checks, report };
}

export const spreadsheetCompare: ProcedureDef = {
  id: "spreadsheet-compare",
  pack: "bookkeeping",
  title: "Compare two spreadsheets",
  summary: "See what matches and what does not between two lists, like your bank statement and your own records.",
  supports:
    "Give it two spreadsheets (Excel or .csv). You get a new spreadsheet showing what matches, what is missing, and what is listed twice. NONON adds up the amounts itself, so the numbers are exact.",
  limits: [
    "Works with Excel and .csv files. If your Excel file has several sheets, you choose one.",
    "NONON reads the numbers shown in Excel cells, not the formulas. If a formula shows nothing, open the file in Excel, save it, and try again.",
    "If your Excel file has macros, pivot tables, charts or links to other files, NONON can still read it. It will not change it.",
    "Each file can have up to 50,000 rows. If yours is bigger, split it by month.",
    "Each file should use one currency, and both files the same one. NONON does not convert money.",
    "Each file needs a date and an amount. The amount can be one column, or separate Debit and Credit columns.",
    "Your original files are never changed without your OK. The only change offered is two extra columns on file A.",
    "If a row could match more than one other row, NONON marks it \"not sure\" for you to decide. It does not guess.",
  ],
  inputs: [
    { key: "fileA", label: "File A: your own records (for example an expense list)", kind: "file", accept: [".csv", ".xlsx"] },
    { key: "fileB", label: "File B: the other list (for example your bank statement)", kind: "file", accept: [".csv", ".xlsx"] },
  ],
  revision: REVISION,
  run,
};

export const procedures: ProcedureDef[] = [spreadsheetCompare];
