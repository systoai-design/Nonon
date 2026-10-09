import { z } from "zod";
import { chunkDoc, MAX_CHUNKS, type Chunk } from "./chunk";
import type { SourceDoc } from "./extract";
import { DATA_RULES, fenceDocument, PLAIN_WRITING, type Llm } from "./llm";
import { verifyQuote } from "./quote";
import { looksLikeInjection, normalizeText } from "./text";

export interface DocChunk {
  doc: SourceDoc;
  chunk: Chunk;
}

/** All excerpts across the inputs, capped so one run stays bounded. */
export function prepareChunks(docs: SourceDoc[], maxChars = 6000): { chunks: DocChunk[]; truncated: boolean } {
  const all: DocChunk[] = [];
  for (const doc of docs) for (const chunk of chunkDoc(doc, maxChars)) all.push({ doc, chunk });
  return { chunks: all.slice(0, MAX_CHUNKS), truncated: all.length > MAX_CHUNKS };
}

export interface VerifiedPoint {
  id: number;
  point: string;
  quote: string;
  doc: SourceDoc;
  line: number;
  endLine: number;
}

const PointsSchema = z.object({
  points: z.array(z.object({ point: z.string().max(400), quote: z.string().max(500) })).max(10),
});

export interface PointsResult {
  points: VerifiedPoint[];
  dropped: { text: string; reason: string }[];
  excerpts: number;
  failedExcerpts: number;
  truncated: boolean;
}

/**
 * Map step: for each excerpt, ask for the important facts with an exact quote each; keep only those whose
 * quote is really in the file. The reduce step then works from this short verified list, not the whole text.
 */
export async function extractKeyPoints(
  llm: Llm,
  docs: SourceDoc[],
  opts: { purpose: string; perExcerpt?: number; onExcerpt?: (i: number, n: number) => void },
): Promise<PointsResult> {
  const { chunks, truncated } = prepareChunks(docs);
  const per = opts.perExcerpt ?? 6;
  const found: VerifiedPoint[] = [];
  const dropped: { text: string; reason: string }[] = [];
  const seen = new Set<string>();
  let failed = 0;

  for (const [i, { doc, chunk }] of chunks.entries()) {
    opts.onExcerpt?.(i + 1, chunks.length);
    const res = await llm.json(
      PointsSchema,
      [
        {
          role: "system",
          content: `You read one excerpt of a document and list the important facts: requests, deadlines, amounts, names, decisions and key claims. ${DATA_RULES} ${PLAIN_WRITING}`,
        },
        {
          role: "user",
          content:
            `Purpose: ${opts.purpose}\n` +
            `List up to ${per} important points from this excerpt. For each, give a short "point" in your own words and a "quote" copied exactly, word for word, from the excerpt (one or two sentences, without the [number] markers).\n\n` +
            fenceDocument(doc.name, chunk.text),
        },
      ],
      `points ${doc.name} ${i + 1}/${chunks.length}`,
    );
    if (!res.ok) {
      failed += 1;
      continue;
    }
    for (const p of res.value.points) {
      if (looksLikeInjection(p.quote) || looksLikeInjection(p.point)) {
        dropped.push({ text: p.point, reason: "this reads like an order to an AI, so it was ignored" });
        continue;
      }
      const m = verifyQuote(doc, p.quote);
      if (!m.found || m.startLine === undefined) {
        dropped.push({ text: p.point, reason: m.reason ?? "the supporting words are not in the file" });
        continue;
      }
      const key = `${doc.name}|${normalizeText(p.quote)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ id: 0, point: p.point.trim(), quote: p.quote.trim(), doc, line: m.startLine, endLine: m.endLine ?? m.startLine });
    }
  }
  const order = new Map(docs.map((d, i) => [d, i] as const));
  found.sort((a, b) => (order.get(a.doc) ?? 0) - (order.get(b.doc) ?? 0) || a.line - b.line);
  found.forEach((p, i) => (p.id = i + 1));
  return { points: found, dropped, excerpts: chunks.length, failedExcerpts: failed, truncated };
}
