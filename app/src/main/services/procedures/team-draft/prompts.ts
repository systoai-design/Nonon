import type { RoleName } from "../../../../shared/contracts";
import { DATA_RULES, fenceDocument, PLAIN_WRITING } from "../doc-common/llm";
import type { TeamSource } from "./source";

/** Part of every stage's task text, so changing a prompt makes older results stale. */
export const PROMPT_REVISION = "team-draft-2";

export const SYSTEM: Record<RoleName, string> = {
  design:
    `You plan a document before anyone writes it. You get the person's goal and a source text whose lines are numbered like [12]. Write the plan only, not the document. ${DATA_RULES} ${PLAIN_WRITING}\n` +
    'Reply with only one JSON object: {"audience": string, "purpose": string, "sections": [{"heading": string, "covers": string, "sourceLines": [numbers]}], "keyPoints": [{"point": string, "sourceLines": [numbers]}], "constraints": [string]}.\n' +
    "sourceLines are the [n] numbers of the source lines a section or point comes from; use only numbers that appear in the source. In constraints, put anything the goal or source says about tone, length, deadlines or what to leave out. Do not add facts that are not in the source.",
  implement:
    `You write a document. Follow only the specification from the earlier step and the source text; nothing else. ${DATA_RULES} ${PLAIN_WRITING}\n` +
    "Write one section for every section of the plan, in the same order and with the same headings, and cover every key point and constraint in it. Do not invent names, dates, numbers, prices or promises. If the specification asks for something the source does not cover, write one short paragraph that says the source does not cover it.\n" +
    'Reply with only one JSON object: {"title": string, "sections": [{"heading": string, "paragraphs": [string]}]}. Each paragraph is one string with no line breaks. Start a paragraph with "- " to make it a bullet.',
  review:
    `You check a draft against its specification and its source. Do not rewrite the draft. ${DATA_RULES} ${PLAIN_WRITING}\n` +
    "List real problems only, each with a kind: unsupported-claim (the draft says something the source does not support; copy that sentence exactly into draftQuote), missing-point (a specification point the draft left out), contradiction (the draft disagrees with the source; give sourceLines and copy the source words exactly into sourceQuote), spec-deviation (the draft ignores the specification), unclear (hard to understand).\n" +
    'Reply with only one JSON object: {"verdict": "ready" or "needs-changes", "summary": string, "findings": [{"kind": string, "issue": string, "draftQuote": string, "sourceLines": [numbers], "sourceQuote": string}]}. Use "" or [] for a field that does not apply. sourceLines must be [n] numbers that appear in the source. If there are no problems, findings is [] and verdict is "ready".',
};

/** Each stage's own task text. This is all a stage sees besides the earlier results it needs. */
export function stageTasks(goal: string, source: TeamSource): Record<RoleName, string> {
  const doc = fenceDocument(source.doc.name, source.numbered);
  return {
    design: `[${PROMPT_REVISION}] Step 1 of 3: plan the document.\nGoal: ${goal}\n\n${doc}`,
    implement: `[${PROMPT_REVISION}] Step 2 of 3: write the document the specification describes.\n\n${doc}`,
    review: `[${PROMPT_REVISION}] Step 3 of 3: check the draft in the earlier steps against the specification and this source.\n\n${doc}`,
  };
}

export const MAX_TOKENS: Record<RoleName, number> = { design: 900, implement: 1600, review: 1100 };
