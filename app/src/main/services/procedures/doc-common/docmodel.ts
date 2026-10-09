import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { OutputRef, ProcedureRunContext } from "../../../../shared/contracts";

/**
 * One small document model rendered twice: to an editable .docx and to a .md copy, so the two always match.
 * `highlight` marks things the reader must look at, such as "Missing: owner".
 */
export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  highlight?: boolean;
}
export type Run = string | Span;

export type Block =
  | { t: "title"; text: string }
  | { t: "h1" | "h2" | "h3"; text: string }
  | { t: "p"; runs: Run[] }
  | { t: "bullets"; items: Run[][] }
  | { t: "numbered"; items: Run[][] }
  | { t: "table"; header: string[]; rows: Run[][][] }
  | { t: "quote"; runs: Run[] }
  | { t: "note"; runs: Run[] };

const span = (r: Run): Span => (typeof r === "string" ? { text: r } : r);

export const p = (...runs: Run[]): Block => ({ t: "p", runs });
export const h1 = (text: string): Block => ({ t: "h1", text });
export const h2 = (text: string): Block => ({ t: "h2", text });
export const missing = (what: string): Span => ({ text: `Missing: ${what}`, bold: true, highlight: true });

function plain(runs: Run[]): string {
  return runs.map((r) => span(r).text).join("");
}

function mdRun(r: Run): string {
  const s = span(r);
  const raw = s.text.replace(/\r?\n/g, " ");
  const core = raw.trim();
  if (!core) return raw;
  let t = core;
  if (s.highlight) t = `==${t}==`;
  if (s.bold) t = `**${t}**`;
  if (s.italic) t = `*${t}*`;
  const at = raw.indexOf(core);
  return raw.slice(0, at) + t + raw.slice(at + core.length);
}
const mdRuns = (runs: Run[]) => runs.map(mdRun).join("");

export function renderMarkdown(blocks: Block[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.t) {
      case "title":
        out.push(`# ${b.text}`);
        break;
      case "h1":
        out.push(`## ${b.text}`);
        break;
      case "h2":
        out.push(`### ${b.text}`);
        break;
      case "h3":
        out.push(`#### ${b.text}`);
        break;
      case "p":
        out.push(mdRuns(b.runs));
        break;
      case "bullets":
        out.push(b.items.map((it) => `- ${mdRuns(it)}`).join("\n"));
        break;
      case "numbered":
        out.push(b.items.map((it, i) => `${i + 1}. ${mdRuns(it)}`).join("\n"));
        break;
      case "quote":
        out.push(`> ${mdRuns(b.runs)}`);
        break;
      case "note":
        out.push(`> **Note:** ${mdRuns(b.runs)}`);
        break;
      case "table": {
        const esc = (s: string) => s.replace(/\|/g, "\\|");
        const head = `| ${b.header.map(esc).join(" | ")} |`;
        const sep = `| ${b.header.map(() => "---").join(" | ")} |`;
        const rows = b.rows.map((r) => `| ${r.map((c) => esc(mdRuns(c))).join(" | ")} |`);
        out.push([head, sep, ...rows].join("\n"));
        break;
      }
    }
  }
  return `${out.join("\n\n")}\n`;
}

function textRuns(runs: Run[], extra: { italics?: boolean } = {}): TextRun[] {
  return runs.map((r) => {
    const s = span(r);
    return new TextRun({
      text: s.text,
      bold: s.bold ?? false,
      italics: (s.italic ?? false) || (extra.italics ?? false),
      ...(s.highlight ? { highlight: "yellow" as const } : {}),
    });
  });
}

export async function buildDocx(blocks: Block[]): Promise<Uint8Array> {
  const children: (Paragraph | Table)[] = [];
  let listInstance = 0;
  for (const b of blocks) {
    switch (b.t) {
      case "title":
        children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: b.text })] }));
        break;
      case "h1":
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 100 }, children: [new TextRun({ text: b.text })] }));
        break;
      case "h2":
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: b.text })] }));
        break;
      case "h3":
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: b.text })] }));
        break;
      case "p":
        children.push(new Paragraph({ spacing: { after: 120 }, children: textRuns(b.runs) }));
        break;
      case "bullets":
        for (const it of b.items) children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: textRuns(it) }));
        break;
      case "numbered": {
        listInstance += 1;
        for (const it of b.items) {
          children.push(new Paragraph({ numbering: { reference: "nonon-numbered", level: 0, instance: listInstance }, spacing: { after: 60 }, children: textRuns(it) }));
        }
        break;
      }
      case "quote":
        children.push(
          new Paragraph({
            indent: { left: 360 },
            spacing: { after: 100 },
            border: { left: { style: BorderStyle.SINGLE, size: 12, color: "9DB59A", space: 8 } },
            children: textRuns(b.runs, { italics: true }),
          }),
        );
        break;
      case "note":
        children.push(
          new Paragraph({
            spacing: { after: 120 },
            shading: { type: ShadingType.CLEAR, fill: "F1F4EC", color: "auto" },
            children: [new TextRun({ text: "Note: ", bold: true }), ...textRuns(b.runs)],
          }),
        );
        break;
      case "table": {
        const cols = b.header.length;
        const width = Math.floor(100 / Math.max(1, cols));
        const cell = (runs: Run[], header = false) =>
          new TableCell({
            width: { size: width, type: WidthType.PERCENTAGE },
            shading: header ? { type: ShadingType.CLEAR, fill: "E4EBDD", color: "auto" } : undefined,
            children: [new Paragraph({ children: header ? [new TextRun({ text: plain(runs), bold: true })] : textRuns(runs) })],
          });
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ tableHeader: true, children: b.header.map((h) => cell([h], true)) }),
              ...b.rows.map((r) => new TableRow({ children: r.map((c) => cell(c)) })),
            ],
          }),
          new Paragraph({ children: [] }),
        );
        break;
      }
    }
  }
  const titleBlock = blocks.find((b): b is Extract<Block, { t: "title" }> => b.t === "title");
  const titleText = titleBlock ? titleBlock.text : "NONON document";
  const doc = new Document({
    creator: "NONON",
    title: titleText,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    numbering: {
      config: [
        {
          reference: "nonon-numbered",
          levels: [{ level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.START }],
        },
      ],
    },
    sections: [{ children }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

/** Writes `<base>.docx` (editable) and `<base>.md` (plain copy) into the output folder. */
export async function writeDocPair(
  ctx: Pick<ProcedureRunContext, "writeOutput">,
  base: string,
  blocks: Block[],
  label: string,
): Promise<OutputRef[]> {
  const docx = await ctx.writeOutput(`${base}.docx`, await buildDocx(blocks), "docx", label);
  const md = await ctx.writeOutput(`${base}.md`, renderMarkdown(blocks), "md", `${label} (plain text copy)`);
  return [docx, md];
}
