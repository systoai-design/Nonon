// Generates the spreadsheet-compare fixtures and the bookkeeping demo samples.
// Every expected answer is known BY CONSTRUCTION here, never read back from the procedure.
// Run from the repo root:  node fixtures/spreadsheet/generate.mjs
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const require = createRequire(path.join(repo, "app", "package.json"));
const ExcelJS = require("exceljs");
const JSZip = require("jszip");

const OUT = here;
const SAMPLES = path.join(repo, "app", "resources", "samples", "bookkeeping");
fs.mkdirSync(path.join(OUT, "expected"), { recursive: true });
fs.mkdirSync(SAMPLES, { recursive: true });

// ------------------------------------------------------------------ helpers
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pad = (n) => String(n).padStart(2, "0");
const dayOf = (iso) => Number(iso.slice(8, 10));
function addDays(iso, n) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
const plain = (c) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)}.${pad(Math.abs(c) % 100)}`;
const comma = (c) => `${Math.floor(Math.abs(c) / 100).toLocaleString("en-US")}.${pad(Math.abs(c) % 100)}`;
const ddmmyyyy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const mmddyyyy = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dMonYyyy = (iso) => `${iso.slice(8, 10)}-${MON[+iso.slice(5, 7) - 1]}-${iso.slice(0, 4)}`;
const utc = (iso) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));

function csvField(v) {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function writeCsv(file, headers, rows, opts = {}) {
  const eol = opts.eol ?? "\n";
  const lines = [...(opts.preamble ?? []), headers.map(csvField).join(","), ...rows.map((r) => r.map(csvField).join(","))];
  const text = lines.join(eol) + eol + (opts.trailingBlank ? eol : "");
  fs.writeFileSync(file, (opts.bom ? "﻿" : "") + text, "utf8");
}
function writeJson(name, obj) {
  fs.writeFileSync(path.join(OUT, "expected", name), JSON.stringify(obj, null, 2) + "\n", "utf8");
}
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

// ------------------------------------------------------------------ (b) mixed: the main fixture
const VENDORS = [
  "Meralco", "Globe", "Jollibee", "Shell", "Puregold", "Mercury", "Lazada", "Maynilad", "Starbucks", "Petron", "Watsons",
  "Ace Hardware", "Mang Inasal", "Unioil", "Landers", "Robinsons", "Savemore", "McDonalds", "Chowking", "Greenwich", "Shopee",
  "Canon", "Epson", "Fedex", "LBC", "Metrobank", "Wilcon", "Handyman", "Converge", "PLDT", "Foodpanda",
];
const NOUNS = ["supplies", "bill", "lunch", "fuel", "payment", "order", "subscription"];

function buildMixed() {
  const rand = rng(20261009);
  const used = new Set();
  const uniqueCents = (lo, hi) => {
    for (;;) {
      const c = lo + Math.floor(rand() * (hi - lo));
      if (!used.has(c)) {
        used.add(c);
        return c;
      }
    }
  };
  // Reserve amounts the hand-written rows use, so no pair can collide with them.
  for (const c of [25000, 45000, 127500, 456000, 465000, 15000]) used.add(c);

  const POSITIVE = new Map([[6, 9900], [14, 250000], [22, 118740]]);
  const pairs = [];
  VENDORS.forEach((v, i) => {
    const date = `2026-06-${pad(1 + ((i * 5) % 28))}`;
    const cents = POSITIVE.has(i) ? POSITIVE.get(i) : -uniqueCents(5000, 999999);
    if (POSITIVE.has(i)) used.add(cents);
    const noun = NOUNS[i % NOUNS.length];
    const hasRef = i % 4 === 0;
    const offset = [0, 1, 0, 2, 0, 1, 0][i % 7];
    const form = i % 3;
    const bDesc = form === 0 ? `${v.toUpperCase()} ${1000 + ((i * 37) % 9000)}` : form === 1 ? `POS ${v.toUpperCase()}` : `${v.toUpperCase()} ${noun.toUpperCase()}`;
    pairs.push({
      i,
      a: { date, desc: `${v} ${noun}`, ref: hasRef ? `INV-${1000 + i}` : "", cents },
      b: { date: addDays(date, offset), desc: bDesc, ref: hasRef ? `inv${1000 + i}` : "", cents },
    });
  });
  // pair 29 and 30: take 31 pairs total (VENDORS has 31 entries)

  const aRows = []; // {date, desc, ref, cents, kind, pairIndex?}
  const bRows = [];
  const DUP_OF = new Set([3, 4]);
  for (const p of pairs) {
    aRows.push({ ...p.a, kind: "matched", pair: p.i });
    if (DUP_OF.has(p.i)) aRows.push({ ...p.a, kind: "dupA", pair: p.i });
    bRows.push({ ...p.b, kind: "matched", pair: p.i });
  }
  aRows.push({ date: "2026-06-09", desc: "Petty cash - rice for staff", ref: "", cents: -45000, kind: "onlyA" });
  aRows.push({ date: "2026-06-21", desc: "Office plants", ref: "", cents: -127500, kind: "onlyA" });
  aRows.push({ date: "2026-06-12", desc: "Hardware - shelving brackets", ref: "INV-4410", cents: -456000, kind: "onlyA" });
  bRows.push({ date: "2026-06-30", desc: "MONTHLY SERVICE FEE", ref: "", cents: -15000, kind: "onlyB" });
  bRows.push({ date: "2026-06-13", desc: "HARDWARE SHELVING BRACKETS", ref: "INV-4410", cents: -465000, kind: "onlyB" });
  aRows.push({ date: "2026-06-17", desc: "Grab ride client visit", ref: "", cents: -25000, kind: "ambA" });
  bRows.push({ date: "2026-06-16", desc: "GRAB*RIDE", ref: "", cents: -25000, kind: "ambB" });
  bRows.push({ date: "2026-06-18", desc: "GRAB*RIDE", ref: "", cents: -25000, kind: "ambB" });

  // Stable by date; ties keep construction order, so a duplicate always sits after its original.
  const order = (rows, key) => rows.map((r, idx) => ({ r, idx })).sort((x, y) => (x.r[key] < y.r[key] ? -1 : x.r[key] > y.r[key] ? 1 : x.idx - y.idx)).map((x) => x.r);
  const A = order(aRows, "date").map((r, k) => ({ ...r, row: k + 2 }));
  const B = order(bRows, "date").map((r, k) => ({ ...r, row: k + 2 }));

  const expected = summarize(A, B);
  return { A, B, expected };
}

function summarize(A, B, extra = {}) {
  const rowsOf = (rows, kind) => rows.filter((r) => r.kind === kind).map((r) => r.row);
  const sumOf = (rows, kind) => sum(rows.filter((r) => r.kind === kind).map((r) => r.cents));
  const pairs = A.filter((r) => r.kind === "matched").map((a) => ({ a: a.row, b: B.find((b) => b.kind === "matched" && b.pair === a.pair).row }));
  return {
    rules: { amountToleranceCents: 0, dateToleranceDays: 3 },
    counts: {
      totalA: A.length, totalB: B.length, matched: pairs.length,
      onlyA: rowsOf(A, "onlyA").length, onlyB: rowsOf(B, "onlyB").length,
      duplicateA: rowsOf(A, "dupA").length, duplicateB: 0,
      ambiguousA: rowsOf(A, "ambA").length, ambiguousB: rowsOf(B, "ambB").length,
    },
    rows: {
      matched: pairs, onlyA: rowsOf(A, "onlyA"), onlyB: rowsOf(B, "onlyB"), duplicateA: rowsOf(A, "dupA"),
      ambiguousA: rowsOf(A, "ambA"), ambiguousB: rowsOf(B, "ambB"),
    },
    totalsCents: {
      a: sum(A.map((r) => r.cents)), b: sum(B.map((r) => r.cents)),
      difference: sum(A.map((r) => r.cents)) - sum(B.map((r) => r.cents)),
      matchedA: sumOf(A, "matched"), matchedB: sumOf(B, "matched"),
      onlyA: sumOf(A, "onlyA"), onlyB: sumOf(B, "onlyB"), duplicateA: sumOf(A, "dupA"),
      ambiguousA: sumOf(A, "ambA"), ambiguousB: sumOf(B, "ambB"),
    },
    ...extra,
  };
}

const mixed = buildMixed();

// A: ledger, DD/MM/YYYY dates, mixed amount styles, CRLF. B: bank export, ISO dates, BOM, trailing blank line.
function amountA(c, idx) {
  if (c > 0) return c % 100 === 0 ? `PHP ${c / 100}` : `PHP ${comma(c)}`;
  const m = idx % 5;
  if (m === 0) return `(${comma(c)})`;
  if (m === 1 || m === 4) return `-${plain(c).slice(1)}`;
  if (m === 2) return `-${comma(c)}`;
  return `-PHP ${comma(c)}`;
}
writeCsv(
  path.join(OUT, "mixed-a.csv"),
  ["Date", "Description", "Reference", "Amount"],
  mixed.A.map((r, k) => [ddmmyyyy(r.date), r.desc, r.ref, amountA(r.cents, k)]),
  { eol: "\r\n" },
);
writeCsv(
  path.join(OUT, "mixed-b.csv"),
  ["Posting Date", "Description", "Reference", "Amount"],
  mixed.B.map((r) => [r.date, r.desc, r.ref, plain(r.cents)]),
  { bom: true, trailingBlank: true },
);
writeJson("mixed.json", mixed.expected);

// ------------------------------------------------------------------ XLSX variants of (b)
async function sheetFor(wb, name, headers, rows, valueOf) {
  const ws = wb.addWorksheet(name);
  ws.addRow(headers);
  rows.forEach((r) => ws.addRow(valueOf(r)));
  ws.getColumn(1).numFmt = "yyyy-mm-dd";
  ws.getColumn(1).width = 14;
  return ws;
}
const xlsxA = (r) => [utc(r.date), r.desc, r.ref, r.cents / 100];
const xlsxB = (r) => [utc(r.date), r.desc, r.ref, r.cents / 100];

{
  const wa = new ExcelJS.Workbook();
  await sheetFor(wa, "Ledger", ["Date", "Description", "Reference", "Amount"], mixed.A, xlsxA);
  await wa.xlsx.writeFile(path.join(OUT, "mixed-a.xlsx"));
  const wb = new ExcelJS.Workbook();
  await sheetFor(wb, "Statement", ["Posting Date", "Description", "Reference", "Amount"], mixed.B, xlsxB);
  await wb.xlsx.writeFile(path.join(OUT, "mixed-b.xlsx"));
  writeJson("mixed-xlsx.json", mixed.expected);

  // Formula cells: one only-in-A row has a formula with NO saved result (must be left out and flagged),
  // one matched row has a formula WITH a saved result (must be used as the value).
  const wf = new ExcelJS.Workbook();
  const gone = mixed.A.find((r) => r.kind === "onlyA");
  const cached = mixed.A.find((r) => r.kind === "matched" && r.pair === 7);
  await sheetFor(wf, "Ledger", ["Date", "Description", "Reference", "Amount"], mixed.A, (r) => {
    const v = xlsxA(r);
    if (r === gone) v[3] = { formula: "-300-150" };
    if (r === cached) v[3] = { formula: `${r.cents / 100}+0`, result: r.cents / 100 };
    return v;
  });
  await wf.xlsx.writeFile(path.join(OUT, "mixed-a-formula.xlsx"));
  const A2 = mixed.A.filter((r) => r !== gone);
  const exp2 = summarize(A2, mixed.B);
  writeJson("mixed-xlsx-formula.json", {
    ...exp2,
    skippedA: [gone.row],
    note: "Row listed in skippedA has a formula with no saved result. Rows are the ORIGINAL Excel row numbers, so row numbers in `rows` stay as in the file.",
  });

  // Chart marker injected into the zip: proves the unsupported-feature warning and no proposal.
  const base = fs.readFileSync(path.join(OUT, "mixed-a.xlsx"));
  const zip = await JSZip.loadAsync(base);
  zip.file("xl/charts/chart1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>');
  fs.writeFileSync(path.join(OUT, "mixed-a-chart.xlsx"), await zip.generateAsync({ type: "nodebuffer" }));
  writeJson("mixed-xlsx-chart.json", { ...mixed.expected, features: ["charts"] });

  // Two sheets with data; the first one is a notes sheet.
  const wm = new ExcelJS.Workbook();
  const notes = wm.addWorksheet("Notes");
  notes.addRow(["Note", "Detail"]);
  notes.addRow(["Prepared by", "Accounting"]);
  notes.addRow(["Period", "June 2026"]);
  await sheetFor(wm, "Ledger", ["Date", "Description", "Reference", "Amount"], mixed.A, xlsxA);
  // Move Ledger to be the second sheet (already is); suggested answer must be Ledger.
  await wm.xlsx.writeFile(path.join(OUT, "multi-sheet-a.xlsx"));
}

// ------------------------------------------------------------------ (a) clean: 40 vs 40, all match
{
  const rand = rng(777);
  const used = new Set();
  const items = [];
  for (let i = 0; i < 40; i++) {
    let c;
    do c = 10000 + Math.floor(rand() * 900000);
    while (used.has(c));
    used.add(c);
    const v = (VENDORS[i % VENDORS.length] ?? "Vendor") + (i >= VENDORS.length ? ` ${i}` : "");
    items.push({
      date: `2026-06-${pad(1 + ((i * 11) % 28))}`,
      desc: `${v} ${NOUNS[i % NOUNS.length]}`,
      ref: i < 25 ? `REF-${5000 + i}` : "",
      cents: -c,
      offset: [0, 1, 2, 0, 1][i % 5],
    });
  }
  const A = items.map((r, k) => ({ ...r, row: k + 2, kind: "matched", pair: k }));
  const Bunordered = items.map((r, k) => ({ date: addDays(r.date, r.offset), desc: `POS ${r.desc.toUpperCase()}`, ref: r.ref, cents: r.cents, kind: "matched", pair: k }));
  const B = Bunordered.map((r, idx) => ({ r, idx })).sort((x, y) => (x.r.date < y.r.date ? -1 : x.r.date > y.r.date ? 1 : x.idx - y.idx)).map((x, k) => ({ ...x.r, row: k + 2 }));
  writeCsv(path.join(OUT, "clean-a.csv"), ["Date", "Description", "Reference", "Amount"], A.map((r) => [r.date, r.desc, r.ref, plain(r.cents)]));
  writeCsv(path.join(OUT, "clean-b.csv"), ["Transaction Date", "Description", "Reference", "Amount"], B.map((r) => [r.date, r.desc, r.ref, plain(r.cents)]));
  writeJson("clean.json", summarize(A, B));
}

// ------------------------------------------------------------------ (c) ambiguous headers
{
  const rows = [];
  for (let i = 0; i < 20; i++) {
    rows.push({ date: `2026-07-${pad(1 + i)}`, desc: `${VENDORS[i]} ${NOUNS[i % NOUNS.length]}`, cents: -(25000 + i * 1337) });
  }
  const A = rows.map((r, k) => ({ ...r, row: k + 2, kind: k === 19 ? "onlyA" : "matched", pair: k }));
  const B = rows.slice(0, 19).map((r, k) => ({ ...r, desc: r.desc.toUpperCase(), row: k + 2, kind: "matched", pair: k }));
  writeCsv(path.join(OUT, "ambiguous-a.csv"), ["Txn Dt", "Details", "Amt"], A.map((r) => [r.date, r.desc, plain(r.cents)]));
  writeCsv(path.join(OUT, "ambiguous-b.csv"), ["Date", "Description", "Amount"], B.map((r) => [r.date, r.desc, plain(r.cents)]));
  writeJson("ambiguous-headers.json", {
    ...summarize(A, B),
    questions: { "map.a.date": "Txn Dt", "map.a.description": "Details", "map.a.amount": "Amt" },
  });
}

// ------------------------------------------------------------------ (d) missing amount column
{
  const A = [];
  const B = [];
  for (let i = 0; i < 10; i++) {
    A.push([`2026-08-${pad(1 + i)}`, `${VENDORS[i]} ${NOUNS[i % NOUNS.length]}`, `INV-${i + 1}`, plain(-(10000 + i * 777))]);
    B.push([`2026-08-${pad(1 + i)}`, `${VENDORS[i].toUpperCase()}`, `OR-${2000 + i}`, "checked by Ana"]);
  }
  writeCsv(path.join(OUT, "missing-a.csv"), ["Date", "Description", "Reference", "Amount"], A);
  writeCsv(path.join(OUT, "missing-b.csv"), ["Date", "Description", "Reference", "Notes"], B);
  writeJson("missing-column.json", { unsupportedMentions: ["File B", "amount"] });
}

// ------------------------------------------------------------------ (e) day/month ambiguity
{
  const rows = [];
  for (let i = 0; i < 11; i++) rows.push({ day: 2 + i, desc: `${VENDORS[i]} ${NOUNS[i % NOUNS.length]}`, cents: -(15000 + i * 2111) });
  const A = rows.map((r) => [`${pad(r.day)}/04/2026`, r.desc, plain(r.cents)]);
  const B = rows.map((r) => [`2026-04-${pad(r.day)}`, r.desc.toUpperCase(), plain(r.cents)]);
  writeCsv(path.join(OUT, "ddmm-a.csv"), ["Date", "Description", "Amount"], A);
  writeCsv(path.join(OUT, "ddmm-b.csv"), ["Date", "Description", "Amount"], B);
  // Same data but one day is 25, which proves day-first and removes the question.
  const A2 = A.map((r, i) => (i === 10 ? [`25/04/2026`, r[1], r[2]] : r));
  const B2 = B.map((r, i) => (i === 10 ? [`2026-04-25`, r[1], r[2]] : r));
  writeCsv(path.join(OUT, "ddmm-clear-a.csv"), ["Date", "Description", "Amount"], A2);
  writeCsv(path.join(OUT, "ddmm-clear-b.csv"), ["Date", "Description", "Amount"], B2);
  writeJson("dates-dd-mm.json", { counts: { dmy: { matched: 11 } }, suggestedOrder: "DMY" });
}

// ------------------------------------------------------------------ demo samples: a small print shop, May 2026
{
  const rows = [
    // [aDate, aDesc, aRef, aCents, bDate|null, bDesc, bRef, kind]
    ["2026-05-02", "Meralco electric bill (April)", "OR-20401", 684235, "2026-05-04", "MERALCO PAYMENT 0504", "", "matched"],
    ["2026-05-02", "Maynilad water bill", "OR-20402", 121560, "2026-05-03", "MAYNILAD WATER 0503", "", "matched"],
    ["2026-05-03", "Ink and toner, Lazada order", "OR-20403", 849000, "2026-05-03", "LAZADA PH PURCHASE", "", "matched"],
    ["2026-05-05", "Jollibee, client lunch", "OR-20404", 103600, "2026-05-05", "POS JOLLIBEE QC", "", "matched"],
    ["2026-05-06", "Grab, delivery to Makati", "", 31200, "2026-05-06", "GRAB*DELIVERY", "", "matched"],
    ["2026-05-07", "Shell fuel, delivery van", "OR-20405", 250000, "2026-05-07", "SHELL ELMS 0507", "", "matched"],
    ["2026-05-08", "National Book Store, A3 paper", "OR-20406", 495000, "2026-05-09", "NATIONAL BOOK STORE MANILA", "", "matched"],
    ["2026-05-09", "Globe Fiber internet (May)", "OR-20407", 189900, "2026-05-14", "GLOBE TELECOM 0514", "", "lag"],
    ["2026-05-10", "Puregold, pantry supplies", "OR-20418", 384600, "2026-05-10", "PUREGOLD QC", "OR-20418", "typo", 348600],
    ["2026-05-12", "Mercury Drug, first aid kit", "OR-20409", 74250, "2026-05-12", "MERCURY DRUG", "", "matched"],
    ["2026-05-13", "Mang Inasal, staff overtime meals", "", 156000, "2026-05-14", "MANG INASAL SM NORTH", "", "matched"],
    ["2026-05-14", "Canon cartridges", "OR-20410", 532000, "2026-05-15", "CANON MARKETING PH", "", "matched"],
    ["2026-05-16", "Grab, client meeting", "", 25000, null, "", "", "amb"],
    ["2026-05-17", "SM Supermarket, cleaning supplies", "OR-20411", 118425, "2026-05-17", "SM SUPERMARKET NORTH EDSA", "", "matched"],
    ["2026-05-19", "LBC shipping, customer orders", "OR-20412", 69000, "2026-05-20", "LBC EXPRESS", "", "matched"],
    ["2026-05-20", "Wilcon Depot, shelf brackets", "OR-20413", 227500, "2026-05-21", "WILCON DEPOT BF", "", "matched"],
    ["2026-05-21", "Starbucks, supplier meeting", "", 56500, "2026-05-21", "STARBUCKS CORP", "", "matched"],
    ["2026-05-22", "Petron, van fuel", "OR-20414", 235000, "2026-05-22", "PETRON PASIG 0522", "", "matched"],
    ["2026-05-23", "Epson ink bottles", "OR-20415", 312000, "2026-05-24", "EPSON PHILIPPINES", "", "matched"],
    ["2026-05-26", "Smart postpaid plan", "OR-20416", 99900, "2026-05-27", "SMART COMMUNICATIONS", "", "matched"],
    ["2026-05-27", "Cash, rice for staff", "", 45000, null, "", "", "onlyA"],
    ["2026-05-28", "Cash, drinking water refill", "", 18000, null, "", "", "onlyA"],
    ["2026-05-29", "Office Warehouse, stapler and tape", "OR-20417", 86000, "2026-05-29", "OFFICE WAREHOUSE", "", "matched"],
    ["2026-05-30", "Rent, shop space (May)", "OR-20419", 1800000, "2026-05-30", "CHECK PAYMENT", "004512", "matched"],
  ];
  const A = [];
  const B = [];
  for (const r of rows) {
    const [aDate, aDesc, aRef, aCents, bDate, bDesc, bRef, kind, bCents] = r;
    const idx = A.length;
    const a = { date: aDate, desc: aDesc, ref: aRef, cents: aCents, kind: kind === "lag" ? "onlyA" : kind === "typo" ? "onlyA" : kind === "amb" ? "ambA" : kind, pair: idx };
    A.push(a);
    if (a.desc === "Maynilad water bill") A.push({ ...a, kind: "dupA" });
    if (bDate) B.push({ date: bDate, desc: bDesc, ref: bRef, cents: bCents ?? aCents, kind: kind === "lag" ? "onlyB" : kind === "typo" ? "onlyB" : kind, pair: idx });
  }
  B.push({ date: "2026-05-15", desc: "GRAB*RIDES", ref: "", cents: 25000, kind: "ambB" });
  B.push({ date: "2026-05-17", desc: "GRAB*RIDES", ref: "", cents: 25000, kind: "ambB" });
  B.push({ date: "2026-05-31", desc: "MONTHLY MAINTENANCE FEE", ref: "", cents: 15000, kind: "onlyB" });
  B.push({ date: "2026-05-31", desc: "CHECKBOOK ORDER FEE", ref: "", cents: 34000, kind: "onlyB" });
  // A credit (money in): a supplier refund the expense report does not list.
  B.push({ date: "2026-05-25", desc: "SUPPLIER REFUND EPSON", ref: "", cents: -110000, kind: "onlyB", credit: true });

  const order = (rows) => rows.map((r, idx) => ({ r, idx })).sort((x, y) => (x.r.date < y.r.date ? -1 : x.r.date > y.r.date ? 1 : x.idx - y.idx)).map((x) => x.r);
  const As = order(A).map((r, k) => ({ ...r, row: k + 2 }));
  const Bs = order(B).map((r, k) => ({ ...r, row: k + 2 }));

  const aAmount = (r) => {
    const c = r.cents;
    if (r.desc.startsWith("Grab, delivery")) return `PHP ${c / 100}`;
    if (r.desc.startsWith("Starbucks")) return `PHP ${comma(c)}`;
    return c >= 100000 ? comma(c) : plain(c);
  };
  writeCsv(
    path.join(SAMPLES, "expense-report-may-2026.csv"),
    ["Date", "Description", "Reference", "Amount"],
    As.map((r) => [mmddyyyy(r.date), r.desc, r.ref, aAmount(r)]),
  );

  // Bank export: debits positive in the Debit column, credits in Credit, running balance.
  let balance = 25000000;
  const bankRows = Bs.map((r) => {
    const isCredit = Boolean(r.credit);
    const money = Math.abs(r.cents);
    balance += isCredit ? money : -money;
    return [dMonYyyy(r.date), r.desc, r.ref, isCredit ? "" : comma(money), isCredit ? comma(money) : "", comma(balance)];
  });
  writeCsv(path.join(SAMPLES, "bank-export-may-2026.csv"), ["Posting Date", "Description", "Reference", "Debit", "Credit", "Balance"], bankRows);

  // Expected answer with sign rule "opposite" (expense sheet + vs bank debit -): comparison amounts.
  const cmpA = (r) => r.cents;
  const bCmp = (r) => (r.credit ? -Math.abs(r.cents) : Math.abs(r.cents)); // after flipping the signed bank amount
  const exp = {
    rules: { amountToleranceCents: 0, dateToleranceDays: 3, signRule: "opposite", period: "overlap" },
    counts: {
      totalA: As.length, totalB: Bs.length,
      matched: As.filter((r) => r.kind === "matched").length,
      onlyA: As.filter((r) => r.kind === "onlyA").length, onlyB: Bs.filter((r) => r.kind === "onlyB").length,
      duplicateA: As.filter((r) => r.kind === "dupA").length, duplicateB: 0,
      ambiguousA: As.filter((r) => r.kind === "ambA").length, ambiguousB: Bs.filter((r) => r.kind === "ambB").length,
    },
    rows: {
      onlyA: As.filter((r) => r.kind === "onlyA").map((r) => r.row),
      onlyB: Bs.filter((r) => r.kind === "onlyB").map((r) => r.row),
      duplicateA: As.filter((r) => r.kind === "dupA").map((r) => r.row),
      ambiguousA: As.filter((r) => r.kind === "ambA").map((r) => r.row),
      ambiguousB: Bs.filter((r) => r.kind === "ambB").map((r) => r.row),
    },
    totalsCents: {
      a: sum(As.map(cmpA)),
      b: sum(Bs.map(bCmp)),
      difference: sum(As.map(cmpA)) - sum(Bs.map(bCmp)),
    },
  };
  writeJson("sample-bookkeeping.json", exp);

  fs.writeFileSync(
    path.join(SAMPLES, "README.md"),
    `# Bookkeeping demo files (for developers)

A small print shop ("Mabini Print and Copy", Quezon City) reconciles its May 2026 expense report against the
bank export. Generated by \`fixtures/spreadsheet/generate.mjs\`; do not edit by hand. Expected answers:
\`fixtures/spreadsheet/expected/sample-bookkeeping.json\`.

Files
- \`expense-report-may-2026.csv\` (A): Date (MM/DD/YYYY), Description, Reference, Amount. Spending is positive. Some amounts
  are written "PHP 312" / "PHP 565.00".
- \`bank-export-may-2026.csv\` (B): Posting Date (DD-Mon-YYYY), Description, Reference, Debit, Credit, Balance.

Planted (default rules: tolerance 0.00, 3 days, period = overlap, sign = opposite)
- Matched: 19 pairs, found by amount, date and wording (bank text is upper case and abbreviated).
- Duplicate in A: "Maynilad water bill" is entered twice.
- Typo: Puregold, receipt OR-20418. Expense report says 3,846.00, bank says 3,486.00 (digits swapped). Same
  reference, different amount, so both rows are listed as "only in" with a note pointing at each other.
- Date lag beyond the default 3 days: Globe Fiber, entered 05/09, posted 05/14. Listed only in A / only in B. Setting the
  date tolerance to 5 matches them.
- Only in A: two cash purchases that never touched the bank (rice 450.00, water refill 180.00).
- Only in B: monthly maintenance fee 150.00, checkbook fee 340.00, and a credit (supplier refund 1,100.00).
- Unclear: one "Grab, client meeting" 250.00 on 05/16; the bank has two Grab rides of 250.00 on 05/15 and 05/17, equally close.
- Weak match: rent 18,000.00 matches on amount and date only (the bank shows "CHECK PAYMENT"). The Matched sheet marks it.
- Signs: spending is plus in A and the bank debits are minus, so the app asks how to compare signs (suggests "opposite").
- Dates in A (05/14/2026 style) prove month-first because a day above 12 appears, so no date-order question.
`,
    "utf8",
  );
}

console.log("fixtures written to", OUT);
console.log("samples written to", SAMPLES);
console.log("mixed:", JSON.stringify(mixed.expected.counts));
