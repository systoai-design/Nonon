import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CloudPolicy, ProviderId, RoleName } from "../../../../shared/contracts";
import { ProviderError } from "../../providers/types";
import type { ArtifactRecord, StageRunRequest, StageRunResult } from "../../providers/stages";
import type { TeamDraftHost } from "./host";

/** Test helpers only. */

export const SAMPLE_BRIEF = resolve(__dirname, "../../../../../resources/samples/general/product-brief.md");
export const sampleText = (): string => readFileSync(SAMPLE_BRIEF, "utf8");

/** 1-based line number of the first line containing `needle`, so tests never hard-code positions. */
export function lineOf(text: string, needle: string): number {
  const i = text.split(/\r\n|\r|\n/).findIndex((l) => l.includes(needle));
  if (i < 0) throw new Error(`"${needle}" is not in the sample`);
  return i + 1;
}

export type RoleMap = Partial<Record<RoleName, ProviderId | "local">>;
export type Reply = string | object | ((req: StageRunRequest, n: number) => string | object);

export interface FakeHost {
  host: TeamDraftHost;
  calls: StageRunRequest[];
  roles: RoleMap;
  setRoleCalls: { role: RoleName; provider: ProviderId | "local" | null }[];
  store: ArtifactRecord[];
  policy: { value: CloudPolicy };
  /** Replies per role, used in order; the last one repeats. */
  replies: Partial<Record<RoleName, Reply[]>>;
  /** Make the next call for a role fail with this error instead. */
  failNext: Partial<Record<RoleName, Error>>;
  maxRunning(): number;
}

export function fakeHost(roles: RoleMap, replies: FakeHost["replies"], policy: CloudPolicy = "cloud-allowed"): FakeHost {
  const calls: StageRunRequest[] = [];
  const used: Record<string, number> = {};
  let running = 0;
  let peak = 0;
  let tick = 0;
  const fake: FakeHost = {
    calls,
    roles,
    setRoleCalls: [],
    store: [],
    policy: { value: policy },
    replies,
    failNext: {},
    maxRunning: () => peak,
    host: {
      deps: {
        roles: (workspaceId) => ({ workspaceId, roles: { ...fake.roles } }),
        async run(req): Promise<StageRunResult> {
          calls.push(req);
          running += 1;
          peak = Math.max(peak, running);
          try {
            await new Promise((r) => setTimeout(r, 2));
            const failure = fake.failNext[req.role];
            if (failure) {
              delete fake.failNext[req.role];
              throw failure;
            }
            const list = fake.replies[req.role] ?? [];
            const n = used[req.role] ?? 0;
            used[req.role] = n + 1;
            const pick = list[Math.min(n, list.length - 1)];
            if (pick === undefined) throw new Error(`no scripted reply for ${req.role}`);
            const out = typeof pick === "function" ? pick(req, n) : pick;
            return { text: typeof out === "string" ? out : JSON.stringify(out), proposals: [], warnings: [] };
          } finally {
            running -= 1;
          }
        },
        load: () => fake.store,
        save: (_w, records) => {
          fake.store = records;
        },
        now: () => new Date(Date.UTC(2026, 9, 9, 12, 0, tick++)),
      },
      policy: () => fake.policy.value,
      setRole: (workspaceId, role, provider) => {
        fake.setRoleCalls.push({ role, provider });
        if (provider === null) delete fake.roles[role];
        else fake.roles[role] = provider;
        return { workspaceId, roles: { ...fake.roles } };
      },
    },
  };
  return fake;
}

export const cloudFailure = (provider: ProviderId = "claude") =>
  new ProviderError(provider, "timeout", `${provider === "claude" ? "Claude" : provider} took too long and was stopped.`);

/** Known-good replies for the sample brief. Line numbers are looked up in the sample, never hard-coded. */
export function goodReplies(text: string) {
  const budget = lineOf(text, "Budget for the first version");
  const deadline = lineOf(text, "before the Saturday market");
  const noAccounts = lineOf(text, "does not want customer accounts");
  const sells = lineOf(text, "about 120 loaves");
  const spec = {
    audience: "A freelance web builder who will quote and build the site.",
    purpose: "Explain what the bakery needs from a first online ordering page.",
    sections: [
      { heading: "The bakery", covers: "Who the shop is and how orders work today.", sourceLines: [sells] },
      { heading: "What the site must do", covers: "The three things Maria wants.", sourceLines: [lineOf(text, "A page that lists")] },
      { heading: "Limits", covers: "Budget, date and what to leave out.", sourceLines: [budget, deadline, noAccounts] },
    ],
    keyPoints: [
      { point: "Budget is 1,500 USD for the first version.", sourceLines: [budget] },
      { point: "Must be live before the Saturday market on 14 November.", sourceLines: [deadline] },
    ],
    constraints: ["Plain language.", "No customer accounts or loyalty scheme."],
  };
  const draft = {
    title: "Harbor Lane Bakery: first online ordering page",
    sections: [
      { heading: "The bakery", paragraphs: ["Harbor Lane Bakery is a neighbourhood bakery with one shop and four staff. The shop sells about 120 loaves and 60 pastries on a normal weekday."] },
      { heading: "What the site must do", paragraphs: ["- List the daily bread and pastries with prices.", "- Let customers choose a pickup time and pay in the shop.", "- Email the shop for each order."] },
      { heading: "Limits", paragraphs: ["The budget for the first version is 1,500 USD in total. The site must go live before the Saturday market on 14 November. There are no customer accounts or loyalty scheme in this version."] },
    ],
  };
  const review = {
    verdict: "ready",
    summary: "The draft follows the plan and matches the source.",
    findings: [] as unknown[],
  };
  return { spec, draft, review };
}
