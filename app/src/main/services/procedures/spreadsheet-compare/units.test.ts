import { describe, expect, it } from "vitest";
import { analyseDateColumn, classifyDate, resolveDate, suggestOrder } from "./dates";
import { compareRecords } from "./match";
import { formatMoney, moneyFromNumber, parseMoney } from "./money";
import { normRef, tokensOf } from "./records";
import type { Rec } from "./types";

describe("parseMoney (real parsing, no model)", () => {
  const cases: [string, number, string | null][] = [
    ["1,234.50", 123450, null],
    ["(250.00)", -25000, null],
    ["PHP 99", 9900, "PHP"],
    ["₱1,200", 120000, "PHP"],
    ["-PHP 1,234.50", -123450, "PHP"],
    ["P 480.5", 48050, "PHP"],
    ["$12", 1200, "USD"],
    ["1.234,50", 123450, null],
    ["12,50", 1250, null],
    ["1,234", 123400, null],
    ["250.00-", -25000, null],
    ["− 75.10", -7510, null],
    ["0.07", 7, null],
    ["19.999", 2000, null],
    [".5", 50, null],
  ];
  it.each(cases)("%s -> %i cents", (raw, cents, cur) => {
    const m = parseMoney(raw);
    expect(m?.cents).toBe(cents);
    expect(m?.currency ?? null).toBe(cur);
  });

  it("rejects things that are not amounts", () => {
    for (const bad of ["", "abc", "12 apples", "1,2,3x", "OR-2031", "12%", "--5", "n/a"]) expect(parseMoney(bad)).toBeNull();
  });

  it("flags more than two decimals and rounds half up on the magnitude", () => {
    expect(parseMoney("1.005")).toMatchObject({ cents: 101, fractional: true });
    expect(parseMoney("-1.005")).toMatchObject({ cents: -101, fractional: true });
    expect(parseMoney("1.000")).toMatchObject({ cents: 100, fractional: false });
  });

  it("does integer maths on spreadsheet numbers without float drift", () => {
    expect(moneyFromNumber(100.35)?.cents).toBe(10035);
    expect(moneyFromNumber(0.1 + 0.2)?.cents).toBe(30);
    expect(moneyFromNumber(1234.5)?.fractional).toBe(false);
    expect(moneyFromNumber(1.005)?.fractional).toBe(true);
  });

  it("sums whole cents exactly", () => {
    const values = Array.from({ length: 1000 }, () => "0.10");
    const total = values.reduce((s, v) => s + (parseMoney(v)?.cents ?? 0), 0);
    expect(total).toBe(10000);
    expect(formatMoney(total, "PHP")).toBe("PHP 100.00");
    expect(formatMoney(-123456789, "PHP")).toBe("-PHP 1,234,567.89");
  });
});

describe("dates", () => {
  it("reads common shapes", () => {
    const iso = (s: string, order: "DMY" | "MDY" = "DMY") => {
      const c = classifyDate(s);
      return c ? resolveDate(c, order) : null;
    };
    expect(iso("2026-06-03")).toBe("2026-06-03");
    expect(iso("2026/6/3")).toBe("2026-06-03");
    expect(iso("03/06/2026", "DMY")).toBe("2026-06-03");
    expect(iso("03/06/2026", "MDY")).toBe("2026-03-06");
    expect(iso("3 Jun 2026")).toBe("2026-06-03");
    expect(iso("03-Jun-2026")).toBe("2026-06-03");
    expect(iso("June 3, 2026")).toBe("2026-06-03");
    expect(iso("Fri, 3 Jun 2026")).toBe("2026-06-03");
    expect(iso("2026-06-03 14:22:11")).toBe("2026-06-03");
    expect(iso("03/06/26")).toBe("2026-06-03");
    expect(iso("20260603")).toBe("2026-06-03");
    expect(iso("31/02/2026")).toBeNull();
    expect(classifyDate("not a date")).toBeNull();
    expect(classifyDate("12345")).toBeNull();
  });

  it("proves the day/month order from the data, or admits it cannot", () => {
    const col = (xs: string[]) => analyseDateColumn(xs.map((t) => ({ t })));
    expect(col(["03/04/2026", "25/04/2026"])).toMatchObject({ status: "determined", order: "DMY" });
    expect(col(["03/04/2026", "04/25/2026"])).toMatchObject({ status: "determined", order: "MDY" });
    expect(col(["03/04/2026", "05/04/2026"])).toMatchObject({ status: "ambiguous", order: null });
    expect(col(["25/04/2026", "04/25/2026"])).toMatchObject({ status: "mixed" });
    expect(col(["2026-04-03", "2026-04-05"])).toMatchObject({ status: "none" });
  });

  it("suggests the reading that fits the other file, else the tighter span", () => {
    const vals = analyseDateColumn(["02/04/2026", "05/04/2026", "11/04/2026"].map((t) => ({ t }))).values;
    expect(suggestOrder(vals, null)).toBe("DMY");
    expect(suggestOrder(vals, { from: "2026-04-01", to: "2026-04-30" })).toBe("DMY");
    expect(suggestOrder(vals, { from: "2026-02-01", to: "2026-02-28" })).toBe("MDY");
  });
});

let seq = 0;
function rec(file: "A" | "B", row: number, date: string | null, cents: number, desc = "", ref = ""): Rec {
  const t = tokensOf(desc);
  seq++;
  return {
    id: `${file}:${row}`, file, row, date, dateRaw: date ?? "", cents, cmp: cents, amountRaw: String(cents / 100),
    description: desc, descTokens: t, descNorm: t.join(" "), reference: ref, refNorm: normRef(ref), rawCells: [`s${seq}`],
  };
}
const rules = { amountTolCents: 0, dateTolDays: 3 };

describe("compareRecords", () => {
  it("matches by reference first, even when wording and date differ", () => {
    const m = compareRecords(
      [rec("A", 2, "2026-06-01", -1000, "Lunch", "INV-7")],
      [rec("B", 2, "2026-06-20", -1000, "POS 8841 CARD", "inv7")],
      rules,
    );
    expect(m.pairs).toHaveLength(1);
    expect(m.pairs[0]?.how).toBe("reference");
    expect(m.pairs[0]?.note).toContain("19 days apart");
  });

  it("does not match a shared reference when the amounts differ; says why instead", () => {
    const m = compareRecords(
      [rec("A", 2, "2026-06-01", -456000, "Hardware", "INV-4410")],
      [rec("B", 2, "2026-06-02", -465000, "HARDWARE", "INV-4410")],
      rules,
    );
    expect(m.pairs).toHaveLength(0);
    expect(m.onlyA[0]?.note).toContain("Same reference as B row 2");
    expect(m.onlyB[0]?.note).toContain("Same reference as A row 2");
  });

  it("points at a likely late posting without matching it", () => {
    const m = compareRecords(
      [rec("A", 2, "2026-05-09", -189900, "Globe Fiber internet")],
      [rec("B", 2, "2026-05-14", -189900, "GLOBE TELECOM")],
      rules,
    );
    expect(m.pairs).toHaveLength(0);
    expect(m.onlyA[0]?.note).toBe("Possible match: B row 2 (date differs by 5 days)");
    expect(m.onlyB[0]?.note).toBe("Possible match: A row 2 (date differs by 5 days)");
  });

  it("respects amount and date tolerances", () => {
    const a = [rec("A", 2, "2026-06-10", -10000, "Shell fuel")];
    const near = [rec("B", 2, "2026-06-13", -10005, "SHELL")];
    expect(compareRecords(a, near, rules).pairs).toHaveLength(0);
    expect(compareRecords(a, near, { amountTolCents: 5, dateTolDays: 3 }).pairs).toHaveLength(1);
    expect(compareRecords(a, near, { amountTolCents: 5, dateTolDays: 2 }).pairs).toHaveLength(0);
  });

  it("counts repeated identical entries as duplicates, not guesses", () => {
    const m = compareRecords(
      [rec("A", 2, "2026-06-01", -500, "Rice"), rec("A", 3, "2026-06-01", -500, "Rice")],
      [rec("B", 2, "2026-06-01", -500, "RICE")],
      rules,
    );
    expect(m.pairs).toHaveLength(1);
    expect(m.pairs[0]?.a.row).toBe(2);
    expect(m.dupA.map((x) => x.rec.row)).toEqual([3]);
  });

  it("matches two identical entries against two identical entries", () => {
    const m = compareRecords(
      [rec("A", 2, "2026-06-01", -500, "Rice"), rec("A", 3, "2026-06-01", -500, "Rice")],
      [rec("B", 2, "2026-06-01", -500, "RICE"), rec("B", 3, "2026-06-01", -500, "RICE")],
      rules,
    );
    expect(m.pairs).toHaveLength(2);
    expect(m.dupA).toHaveLength(0);
  });

  it("keeps one unmatched twin as only-in and flags the extra as duplicate", () => {
    const m = compareRecords([rec("A", 2, "2026-06-01", -500, "Rice"), rec("A", 3, "2026-06-01", -500, "Rice")], [], rules);
    expect(m.onlyA.map((x) => x.rec.row)).toEqual([2]);
    expect(m.dupA.map((x) => x.rec.row)).toEqual([3]);
  });

  it("refuses to pick between equally good partners", () => {
    const m = compareRecords(
      [rec("A", 2, "2026-06-17", -25000, "Grab ride")],
      [rec("B", 2, "2026-06-16", -25000, "GRAB RIDE"), rec("B", 3, "2026-06-18", -25000, "GRAB RIDE")],
      rules,
    );
    expect(m.pairs).toHaveLength(0);
    expect(m.ambA.map((x) => x.rec.row)).toEqual([2]);
    expect(m.ambB.map((x) => x.rec.row)).toEqual([2, 3]);
  });

  it("resolves a near-tie when one candidate is clearly closer", () => {
    const m = compareRecords(
      [rec("A", 2, "2026-06-17", -25000, "Grab ride")],
      [rec("B", 2, "2026-06-17", -25000, "GRAB RIDE"), rec("B", 3, "2026-06-19", -25000, "GRAB RIDE")],
      rules,
    );
    expect(m.pairs).toHaveLength(1);
    expect(m.pairs[0]?.b.row).toBe(2);
    expect(m.onlyB.map((x) => x.rec.row)).toEqual([3]);
  });

  it("assigns one-to-one across a chain of candidates", () => {
    const m = compareRecords(
      [rec("A", 2, "2026-06-10", -10000, "Shell"), rec("A", 3, "2026-06-12", -10000, "Shell")],
      [rec("B", 2, "2026-06-10", -10000, "SHELL"), rec("B", 3, "2026-06-12", -10000, "SHELL")],
      rules,
    );
    expect(m.pairs.map((p) => [p.a.row, p.b.row])).toEqual([[2, 2], [3, 3]]);
  });

  it("will not match completely different wording unless amount and date are exact", () => {
    const a = [rec("A", 2, "2026-06-10", -10000, "Office plants")];
    expect(compareRecords(a, [rec("B", 2, "2026-06-11", -10000, "TAXI")], rules).pairs).toHaveLength(0);
    const exact = compareRecords(a, [rec("B", 2, "2026-06-10", -10000, "TAXI")], rules);
    expect(exact.pairs[0]?.how).toBe("amount-date");
  });

  it("accounts for every record exactly once", () => {
    const a = [rec("A", 2, "2026-06-01", -100, "x1"), rec("A", 3, "2026-06-02", -200, "y"), rec("A", 4, "2026-06-02", -200, "y")];
    const b = [rec("B", 2, "2026-06-01", -100, "x1"), rec("B", 3, "2026-06-09", -999, "z")];
    const m = compareRecords(a, b, rules);
    expect(m.byId.size).toBe(a.length + b.length);
    const classes = [...m.byId.values()].map((x) => x.cls).sort();
    expect(classes).toEqual(["duplicate", "matched", "matched", "only", "only"]);
  });
});
