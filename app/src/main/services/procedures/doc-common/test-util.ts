import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import type {
  InferenceClient,
  InferenceRequest,
  InferenceResult,
  OutputRef,
  PackId,
  ProcedureRunContext,
  Task,
  Workspace,
} from "../../../../shared/contracts";
import { createOpenAiCompatClient } from "../../runtime/llama-client";

/** Test helpers only. Not imported by product code. */

export interface FakeAi extends InferenceClient {
  calls: InferenceRequest[];
}

/** A scripted stand-in for the model. Tests using it are MOCKED and say so. */
export function fakeAi(handler: (req: InferenceRequest, n: number) => unknown): FakeAi {
  const calls: InferenceRequest[] = [];
  return {
    calls,
    location: { ai: "local", files: "this-computer" },
    async chat(req: InferenceRequest): Promise<InferenceResult> {
      calls.push(req);
      const out = handler(req, calls.length - 1);
      const text = typeof out === "string" ? out : JSON.stringify(out);
      return { text, location: { ai: "local", files: "this-computer" } };
    },
  };
}

/** Text of the last user message, for handlers that branch on the prompt. */
export const lastUser = (req: InferenceRequest): string => [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";

export function realBaseUrl(): string | null {
  const file = "E:\\nonon-dev\\llm-url.txt";
  try {
    if (!existsSync(file)) return null;
    const url = readFileSync(file, "utf8").trim();
    return url || null;
  } catch {
    return null;
  }
}

export function realClient(): InferenceClient | null {
  const url = realBaseUrl();
  return url ? createOpenAiCompatClient(url) : null;
}

export interface TestCtx {
  ctx: ProcedureRunContext;
  dir: string;
  outputDir: string;
  steps: string[];
  outputs: OutputRef[];
  cleanup(): Promise<void>;
}

export async function makeTestCtx(opts: {
  ai: InferenceClient;
  pack?: PackId;
  files?: Record<string, string[]>;
  text?: Record<string, string>;
  answers?: Record<string, string>;
  folder?: string | null;
  procedureId?: string;
}): Promise<TestCtx> {
  const dir = await mkdtemp(join(tmpdir(), "nonon-doc-"));
  const outputDir = join(dir, "NONON Output");
  await mkdir(outputDir, { recursive: true });
  const steps: string[] = [];
  const outputs: OutputRef[] = [];
  const now = new Date().toISOString();
  const workspace: Workspace = {
    id: "ws_test",
    name: "Test",
    folder: opts.folder === undefined ? dir : opts.folder,
    pack: opts.pack ?? "general",
    policy: "local-only",
    autoApply: false,
    createdAt: now,
  };
  const task = {
    id: "task_test",
    workspaceId: workspace.id,
    procedureId: opts.procedureId ?? "test",
    procedureRevision: "1",
    title: "Test",
    state: "running",
    createdAt: now,
    updatedAt: now,
    inputs: {},
    text: opts.text ?? {},
    answers: opts.answers ?? {},
    questions: [],
    steps: [],
    checkpoints: {},
    outputs: [],
    proposalIds: [],
    checks: [],
    locations: opts.ai.location,
  } as Task;
  const checkpoints = new Map<string, unknown>();

  const ctx: ProcedureRunContext = {
    task,
    workspace,
    outputDir,
    files: opts.files ?? {},
    text: opts.text ?? {},
    answers: opts.answers ?? {},
    ai: opts.ai,
    signal: new AbortController().signal,
    step: (label, detail) => {
      steps.push(detail ? `${label}: ${detail}` : label);
    },
    checkpoint: <T>(key: string) => checkpoints.get(key) as T | undefined,
    saveCheckpoint: (key, value) => {
      checkpoints.set(key, value);
    },
    async writeOutput(name, data, kind, label) {
      const ext = extname(name);
      const stem = basename(name, ext);
      let path = join(outputDir, name);
      let n = 1;
      while (existsSync(path)) {
        n += 1;
        path = join(outputDir, `${stem} (${n})${ext}`);
      }
      await writeFile(path, data);
      const ref: OutputRef = { path, label: label ?? name, kind };
      outputs.push(ref);
      return ref;
    },
  };
  return { ctx, dir, outputDir, steps, outputs, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
