import { readFileSync, readdirSync, statSync } from "node:fs";
import { connect as netConnect } from "node:net";
import { join } from "node:path";
import { connect as tlsConnect } from "node:tls";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { PairRequest, Task } from "../../../shared/contracts";
import { LOCAL, done, makeProc } from "../core/testkit";
import { makeLlm } from "../procedures/doc-common/llm";
import { connectPinned, pinnedRequest, type PinnedResponse } from "./pinned";
import { HostUnavailableError, PairedAuthError, PairingError } from "./errors";
import { FailureLimiter, isPrivateAddress } from "./limits";
import { MAX_BODY_BYTES } from "./protocol";
import { decodePairing, encodePairing, hashToken, newPairingSecret, shortCodeFor, splitToken, type PairingPayload } from "./tokens";
import { createLanService } from "./service";
import { fakeSecretStore, makeWorld, pairClient, waitFor, type World } from "./testkit";
import { createPairingVault } from "./vault";

/**
 * Integration tests: a real HTTPS host and a real pinned-TLS client talk over loopback inside this process.
 * The AI behind the host is a fake (marked), so these prove pairing, auth, limits and failure handling, not model quality.
 */

let world: World | null = null;
afterEach(async () => {
  await world?.cleanup();
  world = null;
});

const MESSAGES = [{ role: "user" as const, content: "hi" }];

async function readAll(res: PinnedResponse): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of res.body) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function raw(p: PairingPayload, method: "GET" | "POST", path: string, opts: { token?: string; body?: string } = {}) {
  const res = await pinnedRequest(
    { host: p.h, port: p.p, fingerprint: p.f },
    {
      method,
      path,
      ...(opts.token ? { headers: { authorization: `Bearer ${opts.token}` } } : {}),
      ...(opts.body !== undefined ? { body: opts.body } : {}),
    },
  );
  const text = await readAll(res);
  return { status: res.status, headers: res.headers, text, protocol: res.protocol };
}

function clientToken(w: World): string {
  const vault = createPairingVault(join(w.clientH.ctx.store.dir, "lan"), w.clientSecrets);
  return vault.load()!.token;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: false })
    .map(String)
    .map((f) => join(dir, f))
    .filter((f) => statSync(f).isFile());
}

describe("units", () => {
  it("pairing strings round-trip and reject tampering and junk", () => {
    const p: PairingPayload = { v: 1, h: "192.168.1.20", p: 18765, f: "a".repeat(64), s: newPairingSecret(), n: "Desk PC" };
    expect(decodePairing(encodePairing(p))).toEqual(p);
    expect(() => decodePairing("http://192.168.1.20:18765")).toThrow(PairingError);
    expect(() => decodePairing(encodePairing({ ...p, f: "xyz" }))).toThrow(PairingError);
    expect(() => decodePairing(encodePairing({ ...p, p: 70000 }))).toThrow(PairingError);
    expect(() => decodePairing(encodePairing({ ...p, s: "short" }))).toThrow(PairingError);
    expect(() => decodePairing("nonon-pair-1.%%%not-base64-json")).toThrow(PairingError);
  });

  it("pairing secrets are at least 128 bits and unique", () => {
    const a = newPairingSecret();
    expect(Buffer.from(a, "base64url").length * 8).toBeGreaterThanOrEqual(128);
    expect(newPairingSecret()).not.toBe(a);
  });

  it("short code is six digits and depends on both the fingerprint and the secret", () => {
    const f = "b".repeat(64);
    const s = newPairingSecret();
    expect(shortCodeFor(f, s)).toMatch(/^\d{3} \d{3}$/);
    expect(shortCodeFor(f, s)).toBe(shortCodeFor(f, s));
    expect(shortCodeFor("c".repeat(64), s)).not.toBe(shortCodeFor(f, s));
  });

  it("token hashes are salted per device", () => {
    expect(hashToken("t", "salt1")).not.toBe(hashToken("t", "salt2"));
    expect(splitToken("dev_0123456789abcdef.secretvalue")).toEqual({ id: "dev_0123456789abcdef", secret: "secretvalue" });
    expect(splitToken("nope")).toBeNull();
  });

  it("failure limiter blocks after 5 failures in a minute and releases after the window", () => {
    let t = 1000;
    const l = new FailureLimiter(5, 60_000, () => t);
    for (let i = 0; i < 4; i++) l.fail("ip");
    expect(l.blockedFor("ip")).toBe(0);
    l.fail("ip");
    expect(l.blockedFor("ip")).toBeGreaterThan(0);
    expect(l.blockedFor("other")).toBe(0);
    t += 61_000;
    expect(l.blockedFor("ip")).toBe(0);
  });

  it("only local-network addresses count as private", () => {
    for (const ok of ["127.0.0.1", "10.1.2.3", "192.168.0.9", "172.16.0.1", "172.31.255.1", "169.254.1.1", "::1", "fd00::1", "fe80::1", "::ffff:192.168.1.5"]) {
      expect(isPrivateAddress(ok), ok).toBe(true);
    }
    for (const no of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "1.1.1.1", "2001:4860:4860::8888", "not an ip", ""]) {
      expect(isPrivateAddress(no), no).toBe(false);
    }
  });
});

describe("pairing", () => {
  it("pairs after the host user approves, then chat streams tokens (fake AI behind the host)", async () => {
    world = await makeWorld();
    const w = world;
    await w.hostLan.startHost();
    const code = w.hostLan.createPairingCode();
    expect(code.shortCode).toMatch(/^\d{3} \d{3}$/);
    expect(new Date(code.expiresAt).getTime() - Date.now()).toBeGreaterThan(4 * 60_000);
    expect(new Date(code.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000);

    const pending = w.clientLan.pair(code.pairing, "Kyle's laptop");
    await waitFor(() => w.hostLan.status().host.pending.length === 1);
    const request = w.hostLan.status().host.pending[0]!;
    expect(request.deviceName).toBe("Kyle's laptop");
    expect(request.shortCode).toBe(code.shortCode);
    const event = w.hostH.events.find((e) => e.event === "lan:pair-request")?.payload as PairRequest;
    expect(event.id).toBe(request.id);
    // Nothing is issued until the person on the host says yes.
    expect(w.hostLan.listDevices()).toHaveLength(0);
    expect(w.clientLan.client()).toBeNull();

    w.hostLan.approve(request.id);
    const status = await pending;
    expect(status.state).toBe("connected");
    expect(status.hostName).toBe("Test Host");
    expect(w.hostLan.listDevices().map((d) => d.name)).toEqual(["Kyle's laptop"]);
    expect(w.hostLan.status().host.code).toBeNull();

    const client = w.clientLan.client()!;
    expect(client.location.ai).toBe("paired");
    const tokens: string[] = [];
    const res = await client.chat({ messages: MESSAGES, maxTokens: 50, temperature: 0.2, onToken: (t) => tokens.push(t) });
    expect(res.text).toBe("hello from the host");
    expect(tokens.join("")).toBe("hello from the host");
    expect(res.location.ai).toBe("paired");
    expect(res.promptTokens).toBe(3);
    expect(w.fake.calls[0]?.messages).toEqual(MESSAGES);
    expect(w.fake.calls[0]?.maxTokens).toBe(50);
  });

  it("host refuses to make a code until sharing is on (off by default)", async () => {
    world = await makeWorld();
    expect(world.hostLan.status().host.running).toBe(false);
    expect(() => world!.hostLan.createPairingCode()).toThrow(/Turn on sharing/);
    await expect(world.clientLan.clientStatus()).resolves.toMatchObject({ state: "not-paired" });
    expect(world.clientLan.client()).toBeNull();
  });

  it("denied: the client is told no, no device is stored, and the spent code cannot be retried", async () => {
    world = await makeWorld();
    const w = world;
    await w.hostLan.startHost();
    const code = w.hostLan.createPairingCode();
    const attempt = w.clientLan.pair(code.pairing, "Stranger");
    await waitFor(() => w.hostLan.status().host.pending.length === 1);
    w.hostLan.deny(w.hostLan.status().host.pending[0]!.id);
    await expect(attempt).rejects.toThrow(/did not allow/);
    expect(w.hostLan.listDevices()).toHaveLength(0);
    expect(w.clientLan.client()).toBeNull();
    await expect(w.clientLan.pair(code.pairing, "Stranger")).rejects.toThrow(PairingError);
    expect(w.hostLan.listDevices()).toHaveLength(0);
  });

  it("a wrong secret is refused, and three wrong secrets lock the code even for the right one", async () => {
    world = await makeWorld();
    const w = world;
    await w.hostLan.startHost();
    const code = w.hostLan.createPairingCode();
    const good = decodePairing(code.pairing);
    for (let i = 0; i < 3; i++) {
      await expect(w.clientLan.pair(encodePairing({ ...good, s: newPairingSecret() }), "Guesser")).rejects.toThrow(/did not accept/);
    }
    expect(w.hostLan.status().host.code).toBeNull();
    await expect(w.clientLan.pair(code.pairing, "Owner")).rejects.toThrow(/did not accept/);
    expect(w.hostLan.listDevices()).toHaveLength(0);
    expect(w.hostLan.status().host.pending).toHaveLength(0);
  });

  it("an expired code is refused", async () => {
    world = await makeWorld({ host: { limits: { codeTtlMs: 120 } } });
    const w = world;
    await w.hostLan.startHost();
    const code = w.hostLan.createPairingCode();
    await new Promise((r) => setTimeout(r, 250));
    await expect(w.clientLan.pair(code.pairing, "Late")).rejects.toThrow(/did not accept/);
    expect(w.hostLan.status().host.pending).toHaveLength(0);
  });

  it("a used code cannot be reused", async () => {
    world = await makeWorld();
    const w = world;
    await w.hostLan.startHost();
    const code = w.hostLan.createPairingCode();
    const first = w.clientLan.pair(code.pairing, "First");
    await waitFor(() => w.hostLan.status().host.pending.length === 1);
    w.hostLan.approve(w.hostLan.status().host.pending[0]!.id);
    await first;
    await expect(w.clientLan.pair(code.pairing, "Second")).rejects.toThrow(/did not accept/);
    expect(w.hostLan.listDevices().map((d) => d.name)).toEqual(["First"]);
  });

  it("a new code replaces the old one", async () => {
    world = await makeWorld();
    const w = world;
    await w.hostLan.startHost();
    const first = w.hostLan.createPairingCode();
    const second = w.hostLan.createPairingCode();
    expect(second.pairing).not.toBe(first.pairing);
    await expect(w.clientLan.pair(first.pairing, "Old")).rejects.toThrow(/did not accept/);
  });

  it("fingerprint mismatch is refused before any secret is sent", async () => {
    world = await makeWorld();
    const w = world;
    await w.hostLan.startHost();
    const code = w.hostLan.createPairingCode();
    const forged = encodePairing({ ...decodePairing(code.pairing), f: "0".repeat(64) });
    await expect(w.clientLan.pair(forged, "Laptop")).rejects.toThrow(/did not prove it is the one/);
    // The secret never left the client, so the real code still works afterwards.
    expect(w.hostLan.status().host.pending).toHaveLength(0);
    const pending = w.clientLan.pair(code.pairing, "Laptop");
    await waitFor(() => w.hostLan.status().host.pending.length === 1);
    w.hostLan.approve(w.hostLan.status().host.pending[0]!.id);
    await expect(pending).resolves.toMatchObject({ state: "connected" });
  });

  it("a paired client will not talk to a host whose certificate changed", async () => {
    world = await makeWorld();
    const p = await pairClient(world);
    await expect(connectPinned({ host: p.h, port: p.p, fingerprint: "f".repeat(64) })).rejects.toMatchObject({ reason: "identity" });
    const sock = await connectPinned({ host: p.h, port: p.p, fingerprint: p.f });
    expect(sock.getProtocol()).toMatch(/^TLSv1\.[23]$/);
    sock.destroy();
  });

  it("refuses to pair at all when this computer cannot encrypt saved sign-ins, and spends no code", async () => {
    world = await makeWorld({ client: { secrets: fakeSecretStore(false) } });
    const w = world;
    await w.hostLan.startHost();
    const code = w.hostLan.createPairingCode();
    await expect(w.clientLan.pair(code.pairing, "Laptop")).rejects.toThrow(/cannot protect saved sign-ins/);
    expect(w.hostLan.status().host.pending).toHaveLength(0);
    expect(w.hostLan.status().host.code).not.toBeNull();
    expect(w.clientLan.client()).toBeNull();
  });

  it("stores only a hash on the host and only ciphertext on the client", async () => {
    world = await makeWorld();
    const w = world;
    await pairClient(w);
    const token = clientToken(w);
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(Buffer.from(token.split(".")[1]!, "base64url").length * 8).toBeGreaterThanOrEqual(256);

    for (const dir of [w.hostH.ctx.store.dir, w.clientH.ctx.store.dir]) {
      for (const file of filesUnder(dir)) {
        const bytes = readFileSync(file);
        expect(bytes.includes(Buffer.from(token)), `${file} holds the token`).toBe(false);
        expect(bytes.includes(Buffer.from(token.split(".")[1]!)), `${file} holds the token secret`).toBe(false);
      }
    }
    const devices = JSON.parse(readFileSync(join(w.hostH.ctx.store.dir, "lan", "devices.json"), "utf8")) as Record<string, string>[];
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ name: "Laptop", hash: expect.stringMatching(/^[0-9a-f]{64}$/), salt: expect.any(String) });
    expect(devices[0]).not.toHaveProperty("token");
    const pairingFile = readFileSync(join(w.clientH.ctx.store.dir, "lan", "client-pairing.bin"));
    expect(() => JSON.parse(pairingFile.toString("utf8"))).toThrow();
    expect(filesUnder(join(w.hostH.ctx.store.dir, "lan")).some((f) => f.endsWith("host-key.pem"))).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(join(w.hostH.ctx.store.dir, "lan", "host-key.pem")).mode & 0o077).toBe(0);
    }
  });

  it("keeps the same identity across a host restart, so earlier codes still pin the right certificate", async () => {
    world = await makeWorld();
    const w = world;
    await w.hostLan.startHost();
    const a = decodePairing(w.hostLan.createPairingCode().pairing).f;
    await w.hostLan.stopHost();
    await w.hostLan.startHost();
    expect(decodePairing(w.hostLan.createPairingCode().pairing).f).toBe(a);
  });

  it("a host that was left on restarts at launch, and one that was turned off stays off", async () => {
    world = await makeWorld();
    const w = world;
    const deps = { secrets: w.hostSecrets, port: w.port, bindHost: "127.0.0.1", advertiseHost: () => "127.0.0.1" };
    await w.hostLan.startHost();
    await w.hostLan.dispose();
    const relaunched = createLanService(w.hostH.ctx, deps);
    await waitFor(() => relaunched.status().host.running, 4000, "host restart");
    await relaunched.stopHost();
    const offAgain = createLanService(w.hostH.ctx, deps);
    await new Promise((r) => setTimeout(r, 150));
    expect(offAgain.status().host.running).toBe(false);
  });
});

describe("transport", () => {
  it("rejects plain HTTP on the port without answering it", async () => {
    world = await makeWorld();
    const w = world;
    await w.hostLan.startHost();
    const received = await new Promise<string>((resolve) => {
      const s = netConnect({ host: "127.0.0.1", port: w.port }, () => s.write("GET /v1/status HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer abc\r\n\r\n"));
      let data = "";
      s.on("data", (d) => (data += d.toString("latin1")));
      s.on("close", () => resolve(data));
      s.on("error", () => resolve(data));
      setTimeout(() => (s.destroy(), resolve(data)), 3000);
    });
    expect(received).not.toContain("HTTP/1.");
    expect(received).not.toContain("401");
  });

  it("negotiates TLS 1.2 or newer and refuses older protocol versions", async () => {
    world = await makeWorld();
    const w = world;
    const p = await pairClient(w);
    const status = await raw(p, "GET", "/v1/status", { token: clientToken(w) });
    expect(status.protocol).toMatch(/^TLSv1\.[23]$/);

    const v12 = await new Promise<string | null>((resolve) => {
      const s = tlsConnect({ host: p.h, port: p.p, rejectUnauthorized: false, maxVersion: "TLSv1.2" }, () => {
        resolve(s.getProtocol());
        s.destroy();
      });
      s.on("error", () => resolve(null));
    });
    expect(v12).toBe("TLSv1.2");

    const v11 = await new Promise<string>((resolve) => {
      const s = tlsConnect({ host: p.h, port: p.p, rejectUnauthorized: false, minVersion: "TLSv1", maxVersion: "TLSv1.1" }, () => {
        resolve(`connected ${s.getProtocol()}`);
        s.destroy();
      });
      s.on("error", () => resolve("refused"));
    });
    expect(v11).toBe("refused");
  });
});

describe("authentication", () => {
  it("answers 401 with no detail to unpaired and wrong-token requests, on every route", async () => {
    // Raised failure limit: this test is about the 401 answers; the limiter has its own test below.
    world = await makeWorld({ host: { limits: { failMax: 1000 } } });
    const w = world;
    const p = await pairClient(w);
    const good = clientToken(w);
    const wrongs: (string | undefined)[] = [
      undefined,
      "x".repeat(40),
      `${good.split(".")[0]}.${"A".repeat(43)}`,
      `dev_${"0".repeat(16)}.${good.split(".")[1]}`,
    ];
    for (const token of wrongs) {
      for (const [method, path] of [
        ["GET", "/v1/status"],
        ["POST", "/v1/chat"],
        ["GET", "/"],
        ["GET", "/props"],
        ["POST", "/v1/completions"],
        ["GET", "/v1/files"],
      ] as const) {
        const r = await raw(p, method, path, { ...(token ? { token } : {}), ...(method === "POST" ? { body: JSON.stringify({ messages: MESSAGES }) } : {}) });
        expect(r.status, `${method} ${path}`).toBe(401);
        expect(r.text).toBe("");
      }
    }
    expect(w.fake.calls).toHaveLength(0);
  });

  it("exposes nothing but /v1/chat and /v1/status to a paired device", async () => {
    world = await makeWorld();
    const w = world;
    const p = await pairClient(w);
    const token = clientToken(w);
    const status = await raw(p, "GET", "/v1/status", { token });
    expect(status.status).toBe(200);
    expect(JSON.parse(status.text)).toMatchObject({ name: "Test Host", ready: true, busy: false, limits: { maxTokens: 4096 } });
    for (const [method, path] of [
      ["GET", "/v1/models"],
      ["POST", "/v1/completions"],
      ["POST", "/v1/chat/completions"],
      ["GET", "/props"],
      ["GET", "/v1/files"],
      ["GET", "/tasks"],
      ["GET", "/gmail"],
      ["POST", "/v1/pair-extra"],
    ] as const) {
      const r = await raw(p, method, path, { token, ...(method === "POST" ? { body: "{}" } : {}) });
      expect(r.status, `${method} ${path}`).toBe(404);
    }
  });

  it("rate-limits failed authentication per IP: the sixth failure in a minute gets 429", async () => {
    world = await makeWorld();
    const w = world;
    const p = await pairClient(w);
    const good = clientToken(w);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await raw(p, "GET", "/v1/status", { token: `wrong${i}-${"y".repeat(30)}` })).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    const blocked = await raw(p, "GET", "/v1/status", { token: good });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });
});

describe("limits", () => {
  it("runs one paired request at a time: the second gets 429 with Retry-After, and the first still finishes", async () => {
    world = await makeWorld({ client: { busyWaitMs: 0 } });
    const w = world;
    const p = await pairClient(w);
    const token = clientToken(w);
    w.fake.hold = true;
    const first = w.clientLan.client()!.chat({ messages: MESSAGES });
    await waitFor(() => w.fake.calls.length === 1);
    expect(w.hostLan.status().host.busy).toBe(true);

    const second = await raw(p, "POST", "/v1/chat", { token, body: JSON.stringify({ messages: MESSAGES }) });
    expect(second.status).toBe(429);
    expect(Number(second.headers["retry-after"])).toBeGreaterThan(0);
    await expect(w.clientLan.client()!.chat({ messages: MESSAGES })).rejects.toMatchObject({ reason: "busy" });
    expect(w.fake.calls).toHaveLength(1);

    w.fake.release();
    await expect(first).resolves.toMatchObject({ text: "hello from the host" });
    expect(w.hostLan.status().host.busy).toBe(false);
  });

  it("the host's own work keeps priority: paired requests wait while it is busy", async () => {
    let busy = true;
    world = await makeWorld({ host: { localBusy: () => busy } });
    const w = world;
    const p = await pairClient(w);
    const token = clientToken(w);
    const body = JSON.stringify({ messages: MESSAGES });
    expect((await raw(p, "POST", "/v1/chat", { token, body })).status).toBe(429);
    expect(JSON.parse((await raw(p, "GET", "/v1/status", { token })).text).busy).toBe(true);
    busy = false;
    expect((await raw(p, "POST", "/v1/chat", { token, body })).status).toBe(200);
  });

  it("caps request size, token count and message count, and forwards only the allowed fields", async () => {
    world = await makeWorld();
    const w = world;
    const p = await pairClient(w);
    const token = clientToken(w);
    const post = (obj: unknown) => raw(p, "POST", "/v1/chat", { token, body: JSON.stringify(obj) });

    const huge = await post({ messages: [{ role: "user", content: "x".repeat(MAX_BODY_BYTES + 10) }] });
    expect(huge.status).toBe(413);
    expect((await post({ messages: MESSAGES, maxTokens: 999_999 })).status).toBe(400);
    expect((await post({ messages: MESSAGES, maxTokens: 0 })).status).toBe(400);
    expect((await post({ messages: MESSAGES, maxTokens: 1.5 })).status).toBe(400);
    expect((await post({ messages: Array.from({ length: 65 }, () => MESSAGES[0]) })).status).toBe(400);
    expect((await post({ messages: [{ role: "tool", content: "x" }] })).status).toBe(400);
    expect((await post({ messages: MESSAGES, temperature: 9 })).status).toBe(400);
    expect((await raw(p, "POST", "/v1/chat", { token, body: "not json" })).status).toBe(400);
    expect(w.fake.calls).toHaveLength(0);

    expect((await post({ messages: MESSAGES, maxTokens: 4096 })).status).toBe(200);
    expect(w.fake.calls[0]?.maxTokens).toBe(4096);
    // No maxTokens means the cap, never "unlimited".
    expect((await post({ messages: MESSAGES })).status).toBe(200);
    expect(w.fake.calls[1]?.maxTokens).toBe(4096);
    // Extra fields (a model name, raw llama-server options) are dropped, not forwarded.
    expect((await post({ messages: MESSAGES, model: "other", n_predict: 99999, grammar: "root ::= x", stream: false })).status).toBe(200);
    expect(Object.keys(w.fake.calls[2]!).sort()).toEqual(["maxTokens", "messages", "onToken", "signal"]);
  });

  it("the client refuses to send an oversized request at all", async () => {
    world = await makeWorld();
    await pairClient(world);
    await expect(
      world.clientLan.client()!.chat({ messages: [{ role: "user", content: "x".repeat(MAX_BODY_BYTES + 10) }] }),
    ).rejects.toThrow(/too much text/);
    expect(world.fake.calls).toHaveLength(0);
  });
});

describe("revocation", () => {
  it("revoking ends access at once and aborts the request in flight", async () => {
    world = await makeWorld();
    const w = world;
    const p = await pairClient(w);
    const token = clientToken(w);
    w.fake.hold = true;
    const inflight = w.clientLan.client()!.chat({ messages: MESSAGES });
    const settled = inflight.then(
      () => "resolved",
      (e: unknown) => e,
    );
    await waitFor(() => w.fake.calls.length === 1);

    const deviceId = w.hostLan.listDevices()[0]!.id;
    w.hostLan.revoke(deviceId);
    const outcome = await settled;
    expect(outcome).toBeInstanceOf(PairedAuthError);
    await waitFor(() => w.fake.aborted === 1);
    expect(w.hostLan.listDevices()).toHaveLength(0);
    expect(w.hostLan.status().host.busy).toBe(false);

    expect((await raw(p, "GET", "/v1/status", { token })).status).toBe(401);
    expect(w.clientLan.client()).toBeNull();
    const st = w.clientLan.status().client;
    expect(st.state).toBe("unpaired");
    expect(st.detail).toMatch(/unpaired/i);
    expect(filesUnder(w.clientH.ctx.store.dir).some((f) => f.endsWith("client-pairing.bin"))).toBe(false);
  });

  it("a client that was revoked sees 'unpaired' on its next check, not 'unreachable'", async () => {
    world = await makeWorld();
    const w = world;
    await pairClient(w);
    expect((await w.clientLan.clientStatus()).state).toBe("connected");
    w.hostLan.revoke(w.hostLan.listDevices()[0]!.id);
    const after = await w.clientLan.clientStatus();
    expect(after.state).toBe("unpaired");
    expect(w.clientLan.client()).toBeNull();
  });

  it("unpair on the client forgets the token locally", async () => {
    world = await makeWorld();
    const w = world;
    await pairClient(w);
    expect(w.clientLan.unpair().state).toBe("not-paired");
    expect(w.clientLan.client()).toBeNull();
    expect(filesUnder(w.clientH.ctx.store.dir).some((f) => f.endsWith("client-pairing.bin"))).toBe(false);
  });

  it("a revoked device cannot pair its way back in with the old token", async () => {
    world = await makeWorld();
    const w = world;
    const p = await pairClient(w);
    const token = clientToken(w);
    w.hostLan.revoke(w.hostLan.listDevices()[0]!.id);
    const r = await raw(p, "POST", "/v1/chat", { token, body: JSON.stringify({ messages: MESSAGES }) });
    expect(r.status).toBe(401);
    expect(w.fake.calls).toHaveLength(0);
  });
});

describe("host loss", () => {
  it("a host that stops mid-request surfaces as HostUnavailableError, never a local fallback", async () => {
    world = await makeWorld();
    const w = world;
    await pairClient(w);
    w.fake.hold = true;
    const inflight = w.clientLan.client()!.chat({ messages: MESSAGES });
    const settled = inflight.then(
      () => "resolved",
      (e: unknown) => e,
    );
    await waitFor(() => w.fake.calls.length === 1);
    await w.hostLan.stopHost();
    const outcome = await settled;
    expect(outcome).toBeInstanceOf(HostUnavailableError);
    expect(["stopped", "dropped"]).toContain((outcome as HostUnavailableError).reason);
    expect(w.clientH.runtime.client.location.ai).toBe("local");
  });

  it("a host that is off is reported unreachable, and the pairing is kept", async () => {
    world = await makeWorld();
    const w = world;
    await pairClient(w);
    await w.hostLan.stopHost();
    const st = await w.clientLan.clientStatus();
    expect(st.state).toBe("unreachable");
    await expect(w.clientLan.client()!.chat({ messages: MESSAGES })).rejects.toMatchObject({ name: "HostUnavailableError", reason: "unreachable" });
    expect(w.clientLan.client()).not.toBeNull();
  });

  it("a task on the paired computer waits when the host goes away, keeps its checkpoints, and resumes when it returns", async () => {
    world = await makeWorld();
    const w = world;
    await pairClient(w);
    const { clientH } = w;
    w.fake.answer = (req) => JSON.stringify({ v: req.messages[req.messages.length - 1]!.content });

    const ws = clientH.ctx.svc.workspaces.create({ name: "Local only", folder: clientH.folder, pack: "general", policy: "local-only" });
    let openGate: () => void = () => {};
    let gateOpen = false;
    const gate = new Promise<void>((r) => (openGate = r));
    const shape = z.object({ v: z.string() });
    clientH.registry.set(
      "two-step",
      makeProc("two-step", async (ctx) => {
        const llm = makeLlm(ctx.ai, ctx.signal);
        let a = ctx.checkpoint<string>("a");
        if (a === undefined) {
          const r = await llm.json(shape, [{ role: "user", content: "one" }], "a");
          if (!r.ok) return { kind: "unsupported", reason: `could not read: ${r.error}` };
          a = r.value.v;
          ctx.saveCheckpoint("a", a);
        }
        if (!gateOpen) await gate;
        let b = ctx.checkpoint<string>("b");
        if (b === undefined) {
          const r = await llm.json(shape, [{ role: "user", content: "two" }], "b");
          if (!r.ok) return { kind: "unsupported", reason: `could not read: ${r.error}` };
          b = r.value.v;
          ctx.saveCheckpoint("b", b);
        }
        return done({ summary: `${a}-${b}` });
      }),
    );

    const started = await clientH.ctx.svc.tasks.start({ workspaceId: ws.id, procedureId: "two-step", ai: w.clientLan.client()! });
    expect(started.locations.ai).toBe("paired");
    await waitFor(() => w.fake.calls.length === 1);
    await waitFor(() => (clientH.ctx.svc.tasks.get(started.id)?.checkpoints as Record<string, unknown>).a === "one");

    await w.hostLan.stopHost();
    gateOpen = true;
    openGate();
    const waiting = await clientH.ctx.svc.tasks.settled(started.id);
    expect(waiting.state).toBe("waiting");
    expect(waiting.waitingOn).toBe("your other computer");
    expect(waiting.summary).toMatch(/cannot reach your other computer/);
    expect(waiting.checkpoints).toMatchObject({ a: "one" });
    expect(waiting.locations.ai).toBe("paired");
    // The local runtime on the client was never asked: no silent fallback.
    expect((clientH.runtime.client as unknown as { calls: unknown[] }).calls ?? []).toHaveLength(0);

    await w.hostLan.startHost();
    const resumed = await clientH.ctx.svc.tasks.resume(started.id);
    expect(resumed.state).not.toBe("failed");
    const end = await clientH.ctx.svc.tasks.settled(started.id);
    expect(end.state).toBe("complete");
    expect(end.summary).toBe("one-two");
    // Step one was not repeated: two model calls in total on the host.
    expect(w.fake.calls.map((c) => c.messages[0]?.content)).toEqual(["one", "two"]);
    expect(clientH.taskStates(started.id)).toContain("waiting");
    const states = (clientH.events.filter((e) => e.event === "task:updated").map((e) => (e.payload as Task).state));
    expect(states).not.toContain("failed");
  });
});

describe("location labels", () => {
  it("host passes the request to the runtime client and reports its location as paired to the caller", async () => {
    world = await makeWorld();
    const w = world;
    await pairClient(w);
    const r = await w.clientLan.client()!.chat({ messages: MESSAGES });
    expect(r.location).toEqual({ ai: "paired", files: "this-computer" });
    expect(w.hostH.runtime.client.location).toEqual(LOCAL);
  });
});
