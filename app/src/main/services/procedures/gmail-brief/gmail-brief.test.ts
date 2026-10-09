/** MOCKED Google and scripted model, as in gmail.mocked.test.ts. Exercises the procedure wrapper, outputs and outcomes. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EmailBrief, OutputRef, ProcedureOutcome, ProcedureRunContext, Task } from "../../../../shared/contracts";
import { createGmailService } from "../../gmail/service";
import { clientJson, fakeSecrets, loadFixtures, makeCtx, scriptedModel, startFakeGoogle, toApiMessage, workspace, type FakeGoogle } from "../../gmail/testkit";
import { WAITING_FOR_CONNECTIVITY, bindGmailService, briefToMarkdown, gmailBrief, procedures } from "./index";

const fixtures = loadFixtures();
const open: FakeGoogle[] = [];
afterEach(async () => {
  bindGmailService(null);
  while (open.length) await open.pop()?.close().catch(() => undefined);
});

const tmp = (): string => {
  const root = existsSync("E:/nonon-dev") ? "E:/nonon-dev/test-tmp" : tmpdir();
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, "gmail-proc-"));
};

async function setup(opts: { configured?: boolean; connect?: boolean } = {}) {
  const fake = await startFakeGoogle(fixtures.map((e, i) => toApiMessage(e, i, Date.now())));
  open.push(fake);
  const dir = tmp();
  if (opts.configured !== false) writeFileSync(join(dir, "google-client.json"), clientJson());
  const ai = scriptedModel(fixtures);
  const ctx = makeCtx(dir, workspace("local-only"), ai);
  const service = createGmailService(ctx.ctx, {
    openExternal: async (url) => void fetch(fake.consent(url)).catch(() => undefined),
    secrets: fakeSecrets(true),
    endpoints: fake.endpoints,
    env: {},
    sleep: async () => undefined,
  });
  bindGmailService(service);
  if (opts.connect !== false && opts.configured !== false) expect((await service.connect()).state).toBe("connected");

  const outDir = join(dir, "NONON Output");
  mkdirSync(outDir, { recursive: true });
  const written: OutputRef[] = [];
  const steps: string[] = [];
  const runCtx = (text: Record<string, string> = {}): ProcedureRunContext => ({
    task: {} as Task,
    workspace: workspace("local-only"),
    outputDir: outDir,
    files: {},
    text,
    answers: {},
    ai,
    signal: new AbortController().signal,
    step: (label) => void steps.push(label),
    checkpoint: () => undefined,
    saveCheckpoint: () => undefined,
    async writeOutput(name, data, kind, label) {
      const path = join(outDir, name);
      writeFileSync(path, data);
      const ref: OutputRef = { path, label: label ?? name, kind };
      written.push(ref);
      return ref;
    },
  });
  return { fake, dir, service, ai, written, steps, runCtx };
}

const done = (o: ProcedureOutcome) => {
  if (o.kind !== "done") throw new Error(`expected done, got ${JSON.stringify(o)}`);
  return o;
};

describe("gmail-brief procedure definition", () => {
  it("is registered as a business-pack procedure at revision 1 with one optional text input", () => {
    expect(procedures).toEqual([gmailBrief]);
    expect(gmailBrief).toMatchObject({ id: "gmail-brief", pack: "business", revision: "1" });
    expect(gmailBrief.inputs).toEqual([expect.objectContaining({ key: "lookbackDays", kind: "text", optional: true })]);
    expect(gmailBrief.limits.join(" ")).toMatch(/never sends/);
  });
});

describe("gmail-brief run (MOCKED)", () => {
  it("writes Email brief <date>.md and .docx and reports done with the brief", async () => {
    const t = await setup();
    const outcome = done(await gmailBrief.run(t.runCtx()));
    expect(outcome.proposals).toEqual([]);
    expect(outcome.outputs.map((o) => o.kind)).toEqual(["md", "docx"]);
    const [md, docx] = outcome.outputs;
    expect(md!.path).toMatch(/Email brief \d{4}-\d{2}-\d{2}\.md$/);
    expect(docx!.path).toMatch(/Email brief \d{4}-\d{2}-\d{2}\.docx$/);
    expect(readFileSync(docx!.path).subarray(0, 2).toString()).toBe("PK");

    const text = readFileSync(md!.path, "utf8");
    expect(text).toContain("https://mail.google.com/mail/u/0/#inbox/t001");
    expect(text).toContain("Deadline (copied from the email): Friday 5 PM");
    expect(text).toContain("a draft only, nothing was sent");
    expect(text).not.toContain("\u2014");

    const report = outcome.report as EmailBrief;
    expect(report.freshness).toBe("fresh");
    expect(outcome.summary).toBe(report.summary);
    expect(outcome.checks.find((c) => c.id === "freshness")?.status).toBe("pass");
    expect(outcome.checks.find((c) => c.id === "connectivity")?.status).toBe("pass");
    expect(t.steps).toContain("Checking Gmail");
  });

  it("offline with saved mail: done, but freshness warns and the last sync time is stated", async () => {
    const t = await setup();
    await gmailBrief.run(t.runCtx());
    await t.fake.close();
    const outcome = done(await gmailBrief.run(t.runCtx()));
    const report = outcome.report as EmailBrief;
    expect(report.freshness).toBe("cached");
    expect(outcome.checks.find((c) => c.id === "freshness")).toMatchObject({ status: "warn" });
    expect(outcome.checks.find((c) => c.id === "freshness")?.detail).toMatch(/saved copy from/);
    expect(outcome.checks.find((c) => c.id === "connectivity")?.status).toBe("warn");
    const text = readFileSync(outcome.outputs[0]!.path, "utf8");
    expect(text).toContain("Saved copy.");
    expect(text).toContain("not a current check of your inbox");
    expect(briefToMarkdown(report)).toContain("Saved copy");
  });

  it("offline with nothing saved: unsupported, worded as waiting for connectivity", async () => {
    const t = await setup();
    await t.fake.close();
    const outcome = await gmailBrief.run(t.runCtx());
    expect(outcome.kind).toBe("unsupported");
    if (outcome.kind === "unsupported") {
      expect(outcome.reason.startsWith(WAITING_FOR_CONNECTIVITY)).toBe(true);
      expect(outcome.suggestion).toMatch(/internet/);
    }
    expect(t.written).toHaveLength(0);
  });

  it("not set up: unsupported with the exact config step", async () => {
    const t = await setup({ configured: false });
    const outcome = await gmailBrief.run(t.runCtx());
    expect(outcome.kind).toBe("unsupported");
    if (outcome.kind === "unsupported") {
      expect(outcome.suggestion).toContain(join(t.dir, "google-client.json"));
      expect(outcome.suggestion).toContain("docs/gmail-setup.md");
    }
  });

  it("not connected: unsupported with the connect step", async () => {
    const t = await setup({ connect: false });
    const outcome = await gmailBrief.run(t.runCtx());
    expect(outcome).toMatchObject({ kind: "unsupported", suggestion: expect.stringMatching(/Connect Gmail/) });
  });

  it("reads lookbackDays, and asks again when it is not a number from 1 to 14", async () => {
    const t = await setup();
    done(await gmailBrief.run(t.runCtx({ lookbackDays: "1" })));
    expect(t.fake.log.find((x) => x.path === "/gmail/v1/users/me/messages")?.query.q).toBe("newer_than:1d");
    for (const bad of ["abc", "0", "30", "1.5"]) {
      const o = await gmailBrief.run(t.runCtx({ lookbackDays: bad }));
      expect(o.kind, bad).toBe("needs-input");
    }
  });

  it("sends nothing: only GETs on read endpoints reached Google", async () => {
    const t = await setup();
    await gmailBrief.run(t.runCtx());
    for (const r of t.fake.log.filter((x) => x.path.startsWith("/gmail/"))) expect(r.method).toBe("GET");
    expect(t.fake.log.filter((x) => x.method === "POST").every((x) => x.path === "/token")).toBe(true);
  });
});
