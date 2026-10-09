import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import type { InferenceClient, InferenceRequest, Locations } from "../../../shared/contracts";
import { LOCAL, makeHarness, type Harness } from "../core/testkit";
import type { LanService } from "../types";
import { decodePairing, type PairingPayload } from "./tokens";
import { createLanService, type LanDeps } from "./service";
import type { SecretStore } from "./vault";

/** Test-only helpers for the LAN pairing tests. */

/** Real AES-GCM so "not plaintext on disk" is a meaningful check, with a switch to simulate a PC that cannot encrypt. */
export function fakeSecretStore(available = true): SecretStore {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => available,
    encryptString(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]);
    },
    decryptString(enc) {
      const d = createDecipheriv("aes-256-gcm", key, enc.subarray(0, 12));
      d.setAuthTag(enc.subarray(12, 28));
      return Buffer.concat([d.update(enc.subarray(28)), d.final()]).toString("utf8");
    },
  };
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

export async function waitFor(check: () => boolean, ms = 4000, what = "condition"): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

export interface FakeRuntime {
  client: InferenceClient;
  calls: InferenceRequest[];
  /** While true, chat() streams one token and then waits until released or aborted. */
  hold: boolean;
  release(): void;
  aborted: number;
  /** Text the fake answers with. */
  answer: (req: InferenceRequest) => string;
}

export function fakeRuntime(location: Locations = LOCAL): FakeRuntime {
  let release: () => void = () => {};
  const fake: FakeRuntime = {
    calls: [],
    hold: false,
    aborted: 0,
    answer: () => "hello from the host",
    release: () => release(),
    client: {
      location,
      async chat(req) {
        fake.calls.push(req);
        const text = fake.answer(req);
        req.onToken?.(text.slice(0, 5));
        if (fake.hold) {
          await new Promise<void>((resolve, reject) => {
            release = resolve;
            req.signal?.addEventListener(
              "abort",
              () => {
                fake.aborted += 1;
                reject(new Error("aborted"));
              },
              { once: true },
            );
          });
        }
        req.onToken?.(text.slice(5));
        return { text, location, promptTokens: 3, completionTokens: 4 };
      },
    },
  };
  return fake;
}

export interface World {
  hostH: Harness;
  clientH: Harness;
  hostLan: LanService;
  clientLan: LanService;
  fake: FakeRuntime;
  port: number;
  clientSecrets: SecretStore;
  hostSecrets: SecretStore;
  cleanup(): Promise<void>;
}

export async function makeWorld(opts: { host?: Partial<LanDeps>; client?: Partial<LanDeps>; port?: number } = {}): Promise<World> {
  const hostH = makeHarness();
  const clientH = makeHarness();
  const fake = fakeRuntime();
  hostH.runtime.client = fake.client;
  const port = opts.port ?? (await freePort());
  const hostSecrets = opts.host?.secrets ?? fakeSecretStore();
  const clientSecrets = opts.client?.secrets ?? fakeSecretStore();
  const hostLan = createLanService(hostH.ctx, {
    secrets: hostSecrets,
    hostName: "Test Host",
    port,
    bindHost: "127.0.0.1",
    advertiseHost: () => "127.0.0.1",
    autoStart: false,
    ...opts.host,
  });
  hostH.ctx.svc.lan = hostLan;
  const clientLan = createLanService(clientH.ctx, {
    secrets: clientSecrets,
    hostName: "Test Client",
    autoStart: false,
    ...opts.client,
  });
  clientH.ctx.svc.lan = clientLan;
  return {
    hostH,
    clientH,
    hostLan,
    clientLan,
    fake,
    port,
    clientSecrets,
    hostSecrets,
    async cleanup() {
      fake.release();
      await hostLan.dispose();
      await clientLan.dispose();
      hostH.cleanup();
      clientH.cleanup();
    },
  };
}

/** Full happy-path pairing: host on, code made, client pastes it, host user approves. Returns the decoded code. */
export async function pairClient(w: World, deviceName = "Laptop"): Promise<PairingPayload> {
  await w.hostLan.startHost();
  const code = w.hostLan.createPairingCode();
  const pending = w.clientLan.pair(code.pairing, deviceName);
  await waitFor(() => w.hostLan.status().host.pending.length === 1, 4000, "pairing request");
  w.hostLan.approve(w.hostLan.status().host.pending[0]!.id);
  await pending;
  return decodePairing(code.pairing);
}
