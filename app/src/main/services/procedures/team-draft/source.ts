import type { SourceDoc } from "../doc-common/extract";

/** The smallest AI this runs on has a short memory, and review reads source + spec + draft at once. */
export const MAX_SOURCE_CHARS = 8000;

export interface TeamSource {
  doc: SourceDoc;
  /** Lines as "[12] text" (blank lines skipped) so every stage can point at them. */
  numbered: string;
  /** 1-based line numbers that have text. */
  valid: Set<number>;
  lineCount: number;
  chars: number;
}

export function prepareSource(doc: SourceDoc): TeamSource {
  const valid = new Set<number>();
  const out: string[] = [];
  doc.lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    valid.add(i + 1);
    out.push(`[${i + 1}] ${line}`);
  });
  const numbered = out.join("\n");
  return { doc, numbered, valid, lineCount: doc.lines.length, chars: numbered.length };
}

export function lineText(src: TeamSource, line: number): string {
  return (src.doc.lines[line - 1] ?? "").trim();
}
