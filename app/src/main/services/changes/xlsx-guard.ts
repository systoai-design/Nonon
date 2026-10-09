import JSZip from "jszip";
import { EditError, XLSX_SUGGESTION } from "./errors";

/**
 * exceljs rewrites the whole workbook, so anything it cannot round-trip would vanish silently.
 * Each rule below names something real Excel files contain that we would lose; finding one refuses the edit.
 */
const PART_RULES: { test: RegExp; what: string }[] = [
  { test: /^xl\/vbaproject\.bin$/i, what: "macros (VBA code)" },
  { test: /^xl\/charts\//i, what: "charts" },
  { test: /^xl\/drawings\/[^/]*\.xml$/i, what: "charts, shapes or images" },
  { test: /^xl\/media\//i, what: "images" },
  { test: /^xl\/embeddings\//i, what: "embedded objects" },
  { test: /^xl\/(ctrlprops|activex)\//i, what: "form controls" },
  { test: /^xl\/pivot(tables|cache)\//i, what: "pivot tables" },
  { test: /^xl\/externallinks\//i, what: "links to other workbooks" },
  { test: /^xl\/(slicers|slicercaches|timelines|timelinecaches)\//i, what: "slicers or timelines" },
  { test: /^xl\/(threadedcomments|persons)\//i, what: "threaded comments" },
  { test: /^xl\/(connections\.xml|querytables\/)/i, what: "external data connections" },
  { test: /^xl\/metadata\.xml$/i, what: "dynamic-array formulas" },
  { test: /^xl\/richdata\//i, what: "pictures placed in cells" },
];

const SHEET_RULES: { test: RegExp; what: string }[] = [
  // Some writers emit an empty <sheetProtection/>; only an enabled one (or one with a password) is real protection.
  { test: /<sheetProtection\s[^>]*(\bsheet="(1|true)"|\b(password|hashValue)="[^"]+")/i, what: "sheet protection" },
  { test: /<conditionalFormatting[\s>]/i, what: "conditional formatting" },
  { test: /<x14:conditionalFormatting[\s>]/i, what: "conditional formatting" },
  { test: /<x14:sparklineGroup[\s>]/i, what: "sparklines" },
  { test: /<x14:dataValidation[\s>]/i, what: "advanced data validation" },
  { test: /<drawing\s/i, what: "charts, shapes or images" },
  { test: /<picture\s/i, what: "a background picture" },
  { test: /<oleObjects[\s>]/i, what: "embedded objects" },
];

const MACRO_EXT = /\.(xlsm|xltm|xlam)$/i;

export async function detectXlsxFeatures(bytes: Buffer, fileName: string): Promise<string[]> {
  const found = new Set<string>();
  if (MACRO_EXT.test(fileName)) found.add("macros (VBA code)");

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new EditError(`${fileName} is not a valid .xlsx file.`, { unsupported: true });
  }

  for (const name of Object.keys(zip.files)) {
    if (zip.files[name]?.dir) continue;
    for (const rule of PART_RULES) if (rule.test.test(name)) found.add(rule.what);
  }

  const ct = await zip.file("[Content_Types].xml")?.async("string");
  if (ct && /macroEnabled/i.test(ct)) found.add("macros (VBA code)");

  const workbook = await zip.file("xl/workbook.xml")?.async("string");
  // openpyxl writes an empty <workbookProtection/> on ordinary files, so match only a lock or a password.
  if (workbook && /<workbookProtection\s[^>]*(\block(Structure|Windows|Revision)="(1|true)"|\b(workbookPassword|workbookHashValue)="[^"]+")/i.test(workbook)) {
    found.add("workbook protection");
  }

  for (const name of Object.keys(zip.files)) {
    if (!/^xl\/worksheets\/[^/]+\.xml$/i.test(name)) continue;
    const xml = await zip.file(name)?.async("string");
    if (!xml) continue;
    for (const rule of SHEET_RULES) if (rule.test.test(xml)) found.add(rule.what);
    for (const tag of xml.match(/<dataValidation\s[^>]*>/gi) ?? []) {
      const type = /\stype="([^"]*)"/i.exec(tag)?.[1] ?? "none";
      if (type !== "list" && type !== "none") found.add("data validation rules other than simple lists");
    }
  }
  return [...found];
}

/** Throws an EditError naming everything NONON would lose, with the way out. */
export async function assertXlsxSupported(bytes: Buffer, fileName: string): Promise<void> {
  const found = await detectXlsxFeatures(bytes, fileName);
  if (found.length === 0) return;
  throw new EditError(`${fileName} contains ${found.join(", ")}, which NONON cannot keep when it saves changes.`, {
    suggestion: XLSX_SUGGESTION,
    unsupported: true,
  });
}
