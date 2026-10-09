import type { SourceDoc } from "./extract";

export interface Chunk {
  index: number;
  startLine: number;
  endLine: number;
  /** Lines as "[12] text" so the model can point at them. Blank lines are skipped. */
  text: string;
  chars: number;
}

/**
 * Split a document into prompt-sized pieces. 6,000 characters is roughly 1,700 tokens, which keeps
 * every prompt (instructions + excerpt + reply budget) far under the ~6,000-token ceiling of the small local model.
 */
export function chunkDoc(doc: SourceDoc, maxChars = 6000): Chunk[] {
  const chunks: Chunk[] = [];
  let buf: string[] = [];
  let chars = 0;
  let start = 0;
  let end = 0;

  const flush = () => {
    if (buf.length === 0) return;
    chunks.push({ index: chunks.length, startLine: start, endLine: end, text: buf.join("\n"), chars });
    buf = [];
    chars = 0;
  };

  doc.lines.forEach((raw, i) => {
    const n = i + 1;
    const line = raw.trim();
    if (!line) return;
    for (const piece of splitLong(line, Math.max(500, maxChars - 200))) {
      const entry = `[${n}] ${piece}`;
      if (chars + entry.length + 1 > maxChars && buf.length > 0) flush();
      if (buf.length === 0) start = n;
      buf.push(entry);
      chars += entry.length + 1;
      end = n;
    }
  });
  flush();
  return chunks;
}

function splitLong(line: string, max: number): string[] {
  if (line.length <= max) return [line];
  const out: string[] = [];
  let rest = line;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(". ", max);
    if (cut < max * 0.4) cut = rest.lastIndexOf(" ", max);
    if (cut < 1) cut = max;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Upper bound on excerpts per run so a huge folder of text cannot keep the model busy for hours. */
export const MAX_CHUNKS = 40;
