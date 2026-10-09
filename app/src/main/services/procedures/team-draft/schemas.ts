import { z } from "zod";

const lines = (max: number) => z.array(z.number().int().min(1)).max(max);

export const SpecSchema = z.object({
  audience: z.string().max(240),
  purpose: z.string().max(300),
  sections: z.array(z.object({ heading: z.string().max(80), covers: z.string().max(300), sourceLines: lines(12) })).min(2).max(8),
  keyPoints: z.array(z.object({ point: z.string().max(300), sourceLines: lines(8) })).min(1).max(12),
  constraints: z.array(z.string().max(200)).max(8),
});
export type Spec = z.infer<typeof SpecSchema>;

export const DraftSchema = z.object({
  title: z.string().max(120),
  sections: z.array(z.object({ heading: z.string().max(80), paragraphs: z.array(z.string().max(700)).min(1).max(8) })).min(1).max(10),
});
export type Draft = z.infer<typeof DraftSchema>;

export const FINDING_KINDS = ["unsupported-claim", "missing-point", "contradiction", "spec-deviation", "unclear"] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export const ReviewSchema = z.object({
  verdict: z.enum(["ready", "needs-changes"]),
  summary: z.string().max(300),
  findings: z
    .array(
      z.object({
        kind: z.enum(FINDING_KINDS),
        issue: z.string().max(300),
        draftQuote: z.string().max(300),
        sourceLines: lines(6),
        sourceQuote: z.string().max(300),
      }),
    )
    .max(10),
});
export type Review = z.infer<typeof ReviewSchema>;
export type Finding = Review["findings"][number];
