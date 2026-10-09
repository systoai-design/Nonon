/**
 * MOCKED: every test here talks to a fake Google on a local port (testkit.ts) and, where a model is needed,
 * a scripted stand-in. Nothing here proves behaviour against real Google or a real model.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { InferenceClient } from "../../../shared/contracts";
import { CACHE_FILE } from "./cache";
import { GmailError } from "./errors";
import { createGmailService, NO_SAVED_MAIL, type GmailDeps } from "./service";
import { CLOUD, clientJson, fakeSecrets, loadFixtures, makeCtx, scriptedModel, startFakeGoogle, toApiMessage, workspace, type FakeGoogle, type FixtureEmail, type LoggedRequest } from "./testkit";
import { TOKEN_FILE } from "./vault";

const fixtures = loadFixtures();
const open: FakeGoogle[] = [];

const tmp = (): string => {
  const root = existsSync("E:/nonon-dev") ? "E:/nonon-dev/test-tmp" : tmpdir();
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, "gmail-svc-"));
};

afterEach(async () => {
  while (open.length) await open.pop()?.close().catch(() => undefined);
});

interface Rig {
  fake: FakeGoogle;
  dir: string;
  sleeps: number[];
  opened: string[];
  service: ReturnType<typeof createGmailService>;
  ctx: ReturnType<typeof makeCtx>;
  ai: ReturnType<typeof scriptedModel>;
  redirect: () => string;
}

type Browser = (fake: FakeGoogle, url: string) => Promise<void> | void;

async function rig(opts: { configured?: boolean; secrets?: boolean; deps?: Partial<GmailDeps>; policy?: "local-only" | "cloud-allowed"; emails?: FixtureEmail[]; browser?: Browser } = {}): Promise<Rig> {
  const emails = opts.emails ?? fixtures;
  const fake = await startFakeGoogle(emails.map((e, i) => toApiMessage(e, i, Date.now())));
  open.push(fake);
  const dir = tmp();
  if (opts.configured !== false) writeFileSync(join(dir, "google-client.json"), clientJson());
  const ai = scriptedModel(fixtures);
  const ctx = makeCtx(dir, workspace(opts.policy ?? "local-only"), ai);
  const sleeps: number[] = [];
  const opened: string[] = [];
  const service = createGmailService(ctx.ctx, {
    openExternal: async (url) => {
      opened.push(url);
      if (opts.browser) return await opts.browser(fake, url);
      void fetch(fake.consent(url)).catch(() => undefined);
    },
    secrets: fakeSecrets(opts.secrets ?? true),
    endpoints: fake.endpoints,
    env: {},
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...opts.deps,
  });
  return { fake, dir, sleeps, opened, service, ctx, ai, redirect: () => String(fake.authRequests.at(-1)?.redirect_uri) };
}

/** Every request the app made must be a GET on messages/history/profile, or a POST to token/revoke. Nothing else exists. */
function assertOnlyReadOnlyTraffic(log: LoggedRequest[]): void {
  for (const r of log) {
    if (r.path.startsWith("/gmail/")) {
      expect(r.method, `${r.method} ${r.path}`).toBe("GET");
      expect(r.path).toMatch(/^\/gmail\/v1\/users\/me\/(profile|history|messages|messages\/[A-Za-z0-9_-]+)$/);
      expect(r.path).not.toMatch(/send|modify|trash|delete|drafts|labels|insert|import/i);
    } else {
      expect(r.method).toBe("POST");
      expect(["/token", "/revoke"]).toContain(r.path);
    }
  }
}

async function connected(opts: Parameters<typeof rig>[0] = {}): Promise<Rig> {
  const r = await rig(opts);
  const status = await r.service.connect();
  expect(status.state, status.detail).toBe("connected");
  return r;
}

describe("configuration (MOCKED)", () => {
  it("reports not-configured with the exact path and the setup doc", async () => {
    const r = await rig({ configured: false });
    const s = r.service.status();
    expect(s.state).toBe("not-configured");
    expect(s.configHint).toContain(join(r.dir, "google-client.json"));
    expect(s.configHint).toContain("docs/gmail-setup.md");
    expect(s.scopes).toEqual([]);
    expect((await r.service.connect()).state).toBe("not-configured");
    expect(r.opened).toHaveLength(0);
  });

  it("accepts credentials from the environment", async () => {
    const r = await rig({ configured: false, deps: { env: { NONON_GOOGLE_CLIENT_ID: "test-client-id", NONON_GOOGLE_CLIENT_SECRET: "test-client-secret" } } });
    expect(r.service.status().state).toBe("disconnected");
    expect((await r.service.connect()).state).toBe("connected");
  });
});

describe("OAuth with PKCE and a loopback redirect (MOCKED Google)", () => {
  it("connects, asks only for read-only scope, stores the token encrypted", async () => {
    const r = await connected();
    const q = r.fake.authRequests[0]!;
    expect(q.scope).toBe("https://www.googleapis.com/auth/gmail.readonly openid email");
    expect(q.scope).not.toMatch(/send|modify|compose|insert|\.labels/);
    expect(q.code_challenge_method).toBe("S256");
    expect(q.redirect_uri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(q.state!.length).toBeGreaterThanOrEqual(16);
    expect(q.client_id).toBe("test-client-id");

    const exchange = r.fake.log.find((x) => x.path === "/token" && x.body?.grant_type === "authorization_code")!;
    expect(exchange.body?.code_verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(exchange.body?.redirect_uri).toBe(q.redirect_uri);

    const bytes = readFileSync(join(r.dir, TOKEN_FILE));
    expect(bytes.includes("rt-")).toBe(false);
    const s = r.service.status();
    expect(s.account).toBe("kyle@example.test");
    expect(s.scopes).toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(s.detail).toMatch(/cannot send/);
  });

  it("closes the loopback listener after the one callback", async () => {
    const r = await connected();
    await expect(fetch(r.redirect() + "?code=again&state=x")).rejects.toThrow();
  });

  it("rejects a callback whose state does not match, saves nothing, and closes the listener", async () => {
    let target = "";
    const r = await rig({
      browser: (fake, url) => {
        target = fake.consent(url, { state: "attacker-state" });
        void fetch(target).catch(() => undefined);
      },
    });
    const s = await r.service.connect();
    expect(s.state).toBe("error");
    expect(s.detail).toMatch(/could not be verified/);
    expect(existsSync(join(r.dir, TOKEN_FILE))).toBe(false);
    expect(r.fake.log.some((x) => x.path === "/token")).toBe(false);
    await expect(fetch(target)).rejects.toThrow();
  });

  it("times out after the allowed wait and closes the listener", async () => {
    let redirect = "";
    const r = await rig({
      deps: { authTimeoutMs: 150 },
      browser: (_fake, url) => {
        redirect = new URL(url).searchParams.get("redirect_uri") ?? "";
      },
    });
    const s = await r.service.connect();
    expect(s.state).toBe("error");
    expect(s.detail).toMatch(/too long/);
    await expect(fetch(redirect)).rejects.toThrow();
  });

  it("refuses to connect when the computer cannot encrypt, and never opens the browser", async () => {
    const r = await rig({ secrets: false });
    const s = await r.service.connect();
    expect(s.state).toBe("error");
    expect(s.detail).toMatch(/cannot protect/);
    expect(r.opened).toHaveLength(0);
    expect(existsSync(join(r.dir, TOKEN_FILE))).toBe(false);
  });

  it("reports a plain error when the user denies access", async () => {
    const r = await rig({
      browser: (_fake, url) => {
        const u = new URL(url);
        const back = new URL(u.searchParams.get("redirect_uri")!);
        back.searchParams.set("error", "access_denied");
        back.searchParams.set("state", u.searchParams.get("state")!);
        void fetch(back).catch(() => undefined);
      },
    });
    const s = await r.service.connect();
    expect(s.state).toBe("error");
    expect(s.detail).toMatch(/not allowed/);
    expect(existsSync(join(r.dir, TOKEN_FILE))).toBe(false);
  });
});

describe("sync and brief (MOCKED Google, scripted model)", () => {
  it("does a full sync, then analyses, and produces a fresh brief with Gmail links", async () => {
    const r = await connected();
    const brief = await r.service.brief("ws1");
    expect(brief.freshness).toBe("fresh");
    expect(brief.items).toHaveLength(fixtures.length);
    expect(brief.summary).toContain("Checked Gmail just now.");
    expect(brief.summary).toMatch(/14 emails from the last 2 days: \d+ need attention, \d+ good to know, \d+ can wait\./);
    expect(brief.summary).toContain("Reply to Maria and Daniel first.");
    for (const item of brief.items) expect(item.link).toBe(`https://mail.google.com/mail/u/0/#inbox/${item.threadId}`);

    const byKey = (key: string) => brief.items.find((i) => i.subject === fixtures.find((f) => f.key === key)!.subject)!;
    expect(byKey("e01-quote").priority).toBe("needs-attention");
    expect(byKey("e01-quote").deadline).toBe("Friday 5 PM");
    expect(byKey("e11-statement").priority).toBe("fyi");
    expect(brief.items.map((i) => i.priority)).toEqual([...brief.items.map((i) => i.priority)].sort((a, b) => ["needs-attention", "fyi", "low"].indexOf(a) - ["needs-attention", "fyi", "low"].indexOf(b)));
    expect(r.service.status().cachedMessages).toBe(fixtures.length);
    expect(r.service.status().lastSyncAt).toBe(brief.lastSyncAt);
    assertOnlyReadOnlyTraffic(r.fake.log);
  });

  it("uses incremental history for the next sync and fetches only the new message", async () => {
    const r = await connected();
    await r.service.brief("ws1");
    r.fake.log.length = 0;
    r.fake.addMessage(toApiMessage({ key: "e99", from: "Post <post@parcel.example>", subject: "Your parcel shipped", hoursAgo: 0.1, body: "Parcel on its way.", expect: { priority: "fyi", deadline: null } }, 40, Date.now()));
    const brief = await r.service.brief("ws1");
    expect(brief.items).toHaveLength(fixtures.length + 1);
    const paths = r.fake.log.map((x) => x.path);
    expect(paths).toContain("/gmail/v1/users/me/history");
    expect(paths).not.toContain("/gmail/v1/users/me/messages");
    expect(r.fake.log.filter((x) => /messages\/m\d+$/.test(x.path))).toHaveLength(1);
    assertOnlyReadOnlyTraffic(r.fake.log);
  });

  it("drops a message that Gmail reports deleted", async () => {
    const r = await connected();
    await r.service.brief("ws1");
    r.fake.removeMessage("m005");
    const brief = await r.service.brief("ws1");
    expect(brief.items).toHaveLength(fixtures.length - 1);
    expect(brief.items.some((i) => i.messageId === "m005")).toBe(false);
  });

  it("falls back to a full sync when the saved history position has expired (404)", async () => {
    const r = await connected();
    await r.service.brief("ws1");
    r.fake.log.length = 0;
    r.fake.expireHistory = true;
    const brief = await r.service.brief("ws1");
    expect(brief.freshness).toBe("fresh");
    expect(brief.items).toHaveLength(fixtures.length);
    const paths = r.fake.log.map((x) => x.path);
    expect(paths.indexOf("/gmail/v1/users/me/history")).toBeGreaterThanOrEqual(0);
    expect(paths).toContain("/gmail/v1/users/me/messages");
    expect(r.fake.log.filter((x) => /messages\/m\d+$/.test(x.path))).toHaveLength(0);
  });

  it("refreshes the access token after a 401 and carries on", async () => {
    const r = await connected();
    r.fake.invalidateAccess();
    const brief = await r.service.brief("ws1");
    expect(brief.freshness).toBe("fresh");
    expect(r.fake.refreshCount).toBe(1);
    expect(r.fake.log.filter((x) => x.path === "/token" && x.body?.grant_type === "refresh_token")).toHaveLength(1);
    assertOnlyReadOnlyTraffic(r.fake.log);
  });

  it("backs off with growing waits on 503/429 and then succeeds", async () => {
    const r = await connected();
    r.fake.faults.push({ match: /\/messages$/, status: 503, remaining: 2 }, { match: /\/profile$/, status: 429, remaining: 1, retryAfter: "2" });
    const brief = await r.service.brief("ws1");
    expect(brief.freshness).toBe("fresh");
    expect(r.sleeps).toHaveLength(3);
    expect(r.sleeps).toContain(2000);
    const [a, b] = r.sleeps.filter((ms) => ms !== 2000);
    expect(b!).toBeGreaterThan(a!);
    expect(Math.max(...r.sleeps)).toBeLessThanOrEqual(10_000);
  });

  it("gives up after bounded retries and uses saved mail, labelled cached", async () => {
    const r = await connected();
    await r.service.brief("ws1");
    r.fake.faults.push({ match: /\/history$/, status: 503, remaining: 99 });
    r.sleeps.length = 0;
    const brief = await r.service.brief("ws1");
    expect(brief.freshness).toBe("cached");
    expect(r.sleeps).toHaveLength(3);
    expect(brief.notes?.join(" ")).toMatch(/busy/);
    expect(brief.summary).toMatch(/not a current check/);
  });

  it("offline: analyses saved mail and labels it cached with the last sync time", async () => {
    const r = await connected();
    const fresh = await r.service.brief("ws1");
    await r.fake.close();
    const brief = await r.service.brief("ws1");
    expect(brief.freshness).toBe("cached");
    expect(brief.lastSyncAt).toBe(fresh.lastSyncAt);
    expect(brief.items).toHaveLength(fresh.items.length);
    expect(brief.summary).toContain("Saved copy from");
    expect(brief.summary).toContain("This is not a current check of your inbox.");
    expect(brief.summary).not.toContain("Checked Gmail just now");
    expect(brief.notes?.join(" ")).toMatch(/could not reach Google/);
    expect(r.service.status().state).toBe("connected");
  });

  it("forceOffline never touches the network", async () => {
    const r = await connected();
    await r.service.brief("ws1");
    r.fake.log.length = 0;
    const brief = await r.service.brief("ws1", { forceOffline: true });
    expect(brief.freshness).toBe("cached");
    expect(r.fake.log).toHaveLength(0);
  });

  it("offline with nothing saved yet says so plainly and does not invent a brief", async () => {
    const r = await connected();
    await r.fake.close();
    await expect(r.service.brief("ws1")).rejects.toMatchObject({ code: "no-cache", message: NO_SAVED_MAIL });
    await expect(r.service.brief("ws1", { forceOffline: true })).rejects.toThrow(NO_SAVED_MAIL);
  });

  it("not connected: refuses with a plain next step", async () => {
    const r = await rig();
    await expect(r.service.brief("ws1")).rejects.toMatchObject({ code: "not-connected" });
    const n = await rig({ configured: false });
    await expect(n.service.brief("ws1")).rejects.toMatchObject({ code: "not-configured" });
  });

  it("applies the lookback window and the 50 message cap", async () => {
    const many: FixtureEmail[] = Array.from({ length: 70 }, (_, i) => ({ key: `bulk${i}`, from: "Bulk <b@x.example>", subject: `Bulk ${i}`, hoursAgo: 1 + i * 0.1, body: "hello", expect: { priority: "low", deadline: null } }));
    const r = await connected({ emails: many });
    const brief = await r.service.brief("ws1", { lookbackDays: 1 });
    expect(brief.items).toHaveLength(50);
    expect(brief.notes?.join(" ")).toMatch(/More than 50/);
    expect(r.fake.log.find((x) => x.path === "/gmail/v1/users/me/messages")?.query.q).toBe("newer_than:1d");
  });
});

describe("model output handling (scripted model, MOCKED)", () => {
  it("never keeps a deadline that is not word for word in the email", async () => {
    const r = await connected();
    const ai = scriptedModel(fixtures, (key, a) => {
      if (key === "e03-contract") return { ...a, deadlinePhrase: "when you get a chance" };
      if (key === "e10-boss") return { ...a, deadlinePhrase: "10 AM tomorrow" };
      if (key === "e04-receipt") return { ...a, deadlinePhrase: "next Tuesday" };
      if (key === "e02-tax") return { ...a, deadlinePhrase: "October 15" };
      return a;
    });
    const brief = await r.service.brief("ws1", { ai });
    const get = (key: string) => brief.items.find((i) => i.subject === fixtures.find((f) => f.key === key)!.subject)!;
    expect(get("e03-contract").deadline).toBeUndefined();
    expect(get("e10-boss").deadline).toBe("10 AM");
    expect(get("e04-receipt").deadline).toBeUndefined();
    expect(get("e02-tax").deadline).toBe("October 15");
  });

  it("treats email text as data: the injection fixture is flagged, not obeyed, and nothing is ever sent", async () => {
    const r = await connected();
    const ai = scriptedModel(fixtures, (key, a) =>
      key === "e08-injection" ? { ...a, priority: "needs-attention", why: "Forwarded the mailbox as asked.", draftReply: "Done, forwarded everything." } : a,
    );
    const brief = await r.service.brief("ws1", { ai });
    const item = brief.items.find((i) => i.subject === "Invoice reminder")!;
    expect(item.priority).toBe("fyi");
    expect(item.why).toMatch(/tries to give orders to an AI/);
    expect(item.draftReply).toBeUndefined();
    expect(item.deadline).toBeUndefined();
    // The model prompt marks email as data and the message text sits inside delimiters.
    const prompt = ai.calls[0]!.messages.map((m) => m.content).join("\n");
    expect(prompt).toMatch(/never instructions to you/);
    expect(prompt).toContain("<<<EMAIL");
    assertOnlyReadOnlyTraffic(r.fake.log);
    expect(r.fake.log.some((x) => x.method !== "GET" && x.path.startsWith("/gmail/"))).toBe(false);
  });

  it("retries once when the model returns invalid JSON", async () => {
    const r = await connected({ emails: fixtures.slice(0, 3) });
    const base = scriptedModel(fixtures);
    let first = true;
    const flaky: InferenceClient = {
      location: base.location,
      async chat(req) {
        if (first) {
          first = false;
          return { text: "Sure! Here is the answer: {oops", location: base.location };
        }
        return base.chat(req);
      },
    };
    const brief = await r.service.brief("ws1", { ai: flaky });
    expect(brief.items.every((i) => !i.why.includes("could not read"))).toBe(true);
    expect(brief.items.find((i) => i.subject.startsWith("Revised quote"))?.priority).toBe("needs-attention");
  });

  it("flags 'could not read this' instead of inventing when the model keeps failing", async () => {
    const r = await connected({ emails: fixtures.slice(0, 3) });
    const broken: InferenceClient = { location: scriptedModel(fixtures).location, chat: async () => ({ text: "not json at all", location: scriptedModel(fixtures).location }) };
    const brief = await r.service.brief("ws1", { ai: broken });
    expect(brief.items).toHaveLength(3);
    for (const item of brief.items) {
      expect(item.priority).toBe("fyi");
      expect(item.why).toMatch(/could not read this one/);
      expect(item.deadline).toBeUndefined();
      expect(item.draftReply).toBeUndefined();
    }
    expect(brief.notes?.join(" ")).toMatch(/3 emails could not be read automatically/);
  });

  it("keeps a local-only workspace off the cloud, and uses the local runtime client by default", async () => {
    const r = await connected();
    const cloud = scriptedModel(fixtures, undefined, CLOUD);
    await expect(r.service.brief("ws1", { ai: cloud })).rejects.toThrow(GmailError);
    expect(cloud.calls).toHaveLength(0);
    await r.service.brief("ws1");
    expect(r.ai.calls.length).toBeGreaterThan(0);

    const open = await connected({ policy: "cloud-allowed" });
    const allowed = scriptedModel(fixtures, undefined, CLOUD);
    const brief = await open.service.brief("ws1", { ai: allowed });
    expect(brief.items.length).toBeGreaterThan(0);
    expect(allowed.calls.length).toBeGreaterThan(0);
  });
});

describe("disconnect (MOCKED Google)", () => {
  it("revokes at Google, removes the token and the saved mail", async () => {
    const r = await connected();
    await r.service.brief("ws1");
    expect(existsSync(join(r.dir, CACHE_FILE))).toBe(true);
    const s = await r.service.disconnect();
    expect(s.state).toBe("disconnected");
    expect(s.cachedMessages).toBe(0);
    expect(r.fake.revokedTokens).toHaveLength(1);
    expect(r.fake.revokedTokens[0]).toMatch(/^rt-/);
    const revoke = r.fake.log.find((x) => x.path === "/revoke")!;
    expect(revoke.method).toBe("POST");
    expect(JSON.stringify(revoke.query)).not.toContain("rt-");
    expect(existsSync(join(r.dir, TOKEN_FILE))).toBe(false);
    expect(existsSync(join(r.dir, CACHE_FILE))).toBe(false);
    await expect(r.service.brief("ws1")).rejects.toMatchObject({ code: "not-connected" });
    assertOnlyReadOnlyTraffic(r.fake.log);
  });

  it("still clears everything when Google cannot be reached, and says how to finish", async () => {
    const r = await connected();
    await r.service.brief("ws1");
    await r.fake.close();
    const s = await r.service.disconnect();
    expect(s.state).toBe("disconnected");
    expect(s.detail).toContain("myaccount.google.com/permissions");
    expect(existsSync(join(r.dir, TOKEN_FILE))).toBe(false);
    expect(existsSync(join(r.dir, CACHE_FILE))).toBe(false);
  });

  it("asks to reconnect when Google no longer accepts the saved sign-in", async () => {
    const r = await connected();
    r.fake.revokeRefreshTokens();
    r.fake.invalidateAccess();
    await expect(r.service.brief("ws1")).rejects.toMatchObject({ code: "needs-reconnect" });
    expect(existsSync(join(r.dir, TOKEN_FILE))).toBe(false);
    const s = r.service.status();
    expect(s.state).toBe("error");
    expect(s.detail).toMatch(/Connect Gmail again/);
  });
});
