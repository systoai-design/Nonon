export interface ParsedMoney {
  /** Signed integer cents. All arithmetic downstream is on integers. */
  cents: number;
  currency: string | null;
  /** More than two decimal places were present and were rounded. */
  fractional: boolean;
}

const CODE_RE = /\b(PHP|PESOS?|USD|EUR|GBP|JPY|SGD|AUD|CAD|CNY|HKD|INR|KRW|THB|MYR|IDR|NZD|CHF)\b/gi;
const SYMBOLS: Record<string, string> = { "₱": "PHP", $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR", "₩": "KRW" };

function codeOf(raw: string): string {
  const up = raw.toUpperCase();
  return up.startsWith("PESO") ? "PHP" : up;
}

/**
 * Reads amounts the way people write them: "1,234.50", "(250.00)", "-12", "PHP 99", "P1,200",
 * "1.234,50". Returns null for anything that is not clearly a number, never a guess.
 */
export function parseMoney(raw: string): ParsedMoney | null {
  let s = raw.normalize("NFKC").trim();
  if (!s) return null;
  let currency: string | null = null;

  s = s.replace(CODE_RE, (m) => {
    currency ??= codeOf(m);
    return " ";
  });
  for (const [sym, code] of Object.entries(SYMBOLS)) {
    if (s.includes(sym)) {
      currency ??= code;
      s = s.split(sym).join(" ");
    }
  }
  s = s.replace(/^([\s(\-+−]*)P(?=\s*\d)/i, (_m, pre: string) => {
    currency ??= "PHP";
    return pre;
  });
  s = s.replace(/\s+/g, "");

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/^[-−–]/.test(s)) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/'/g, "");
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s) || s.startsWith(",")) return null;

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  let intPart: string;
  let fracPart = "";
  if (hasDot && hasComma) {
    const dec = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    const thousands = dec === "." ? "," : ".";
    const idx = s.lastIndexOf(dec);
    intPart = s.slice(0, idx).split(thousands).join("");
    fracPart = s.slice(idx + 1);
    if (intPart.includes(dec) || fracPart.includes(thousands)) return null;
  } else if (hasComma) {
    if (/^\d+,\d{1,2}$/.test(s)) {
      const idx = s.lastIndexOf(",");
      intPart = s.slice(0, idx);
      fracPart = s.slice(idx + 1);
    } else if (/^\d{1,3}(,\d{2,3})+$/.test(s)) {
      intPart = s.split(",").join("");
    } else {
      return null;
    }
  } else if (hasDot) {
    const parts = s.split(".");
    if (parts.length > 2) {
      if (!parts.slice(1).every((p) => p.length === 3)) return null;
      intPart = parts.join("");
    } else {
      intPart = parts[0] ?? "";
      fracPart = parts[1] ?? "";
    }
  } else {
    intPart = s;
  }
  if (intPart === "") intPart = "0";
  if (!/^\d+$/.test(intPart) || (fracPart !== "" && !/^\d+$/.test(fracPart))) return null;
  intPart = intPart.replace(/^0+(?=\d)/, "");
  if (intPart.length > 13) return null;

  const frac2 = (fracPart + "00").slice(0, 2);
  let cents = Number(intPart) * 100 + Number(frac2);
  const extra = fracPart.slice(2);
  const fractional = /[1-9]/.test(extra);
  if (extra && Number(extra[0]) >= 5) cents += 1;
  return { cents: negative && cents !== 0 ? -cents : cents, currency, fractional };
}

/** Numeric spreadsheet cells: round to whole cents and say so when that dropped anything. */
export function moneyFromNumber(n: number): ParsedMoney | null {
  if (!Number.isFinite(n) || Math.abs(n) > 1e11) return null;
  const cents = Math.round(n * 100);
  const fractional = Math.abs(n * 100 - cents) > 1e-6 * Math.max(1, Math.abs(cents));
  return { cents: cents === 0 ? 0 : cents, currency: null, fractional };
}

/** "PHP 1,234.50", "-PHP 99.00". No float maths: split the integer cents. */
export function formatMoney(cents: number, currency?: string | null): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const body = `${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
  return `${neg ? "-" : ""}${currency ? currency + " " : ""}${body}`;
}

/** Display number for workbook cells; the exact integer stays the source of truth. */
export function centsToUnits(cents: number): number {
  return cents / 100;
}
