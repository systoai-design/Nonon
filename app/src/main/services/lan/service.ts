import { hostname } from "node:os";
import { join } from "node:path";
import type { InferenceClient, LanClientStatus, LanStatus } from "../../../shared/contracts";
import { UserError } from "../core/errors";
import type { AppCtx, LanService } from "../types";
import { checkHost, createPairedClient, requestPairing } from "./client";
import { createLanHost, type DeviceStorage, type StoredDevice } from "./host";
import type { HostLimits } from "./protocol";
import { decodePairing } from "./tokens";
import { NO_PROTECTION_MESSAGE, createPairingVault, type ClientPairing, type SecretStore } from "./vault";

export interface LanDeps {
  /** Same shape as Electron's safeStorage; tests pass a fake. Pairing is refused when it cannot encrypt. */
  secrets: SecretStore;
  hostName?: string;
  port?: number;
  bindHost?: string;
  advertiseHost?: () => string | null;
  /** True while this computer is doing its own AI work, so paired requests wait their turn. */
  localBusy?: () => boolean;
  /** Reports whether the local AI is ready, for the status a paired computer sees. */
  ready?: () => boolean;
  limits?: Partial<HostLimits>;
  /** Restart sharing at launch if the user left it on. Default true. */
  autoStart?: boolean;
  busyWaitMs?: number;
}

interface LanConfig {
  hostEnabled: boolean;
  port?: number;
}

const DEVICES_FILE = "lan/devices.json";
const CONFIG_FILE = "lan/config.json";
const UNPAIRED_NOTE = "This computer was unpaired from the other computer. Pair it again to keep using its AI.";

/** Everything except Electron wiring lives here, so the whole service runs under vitest with a fake SecretStore and a fake runtime. */
export function createLanService(ctx: AppCtx, deps: LanDeps): LanService {
  const lanDir = join(ctx.store.dir, "lan");
  const vault = createPairingVault(lanDir, deps.secrets);
  const config = (): LanConfig => ctx.store.read<LanConfig>(CONFIG_FILE, { hostEnabled: false });
  const saveConfig = (patch: Partial<LanConfig>) => ctx.store.write(CONFIG_FILE, { ...config(), ...patch });

  const storage: DeviceStorage = {
    load: () => ctx.store.read<StoredDevice[]>(DEVICES_FILE, []),
    save: (list) => ctx.store.write(DEVICES_FILE, list),
  };

  let pairing: ClientPairing | null = vault.load();
  let clientStatus: LanClientStatus | null = null;

  const publish = () => ctx.emit("lan:updated", svc.status());

  const host = createLanHost({
    certDir: lanDir,
    storage,
    chatClient: () => ctx.svc.runtime.client(),
    hostName: deps.hostName ?? hostname(),
    port: deps.port ?? config().port,
    ...(deps.bindHost ? { bindHost: deps.bindHost } : {}),
    ...(deps.advertiseHost ? { advertiseHost: deps.advertiseHost } : {}),
    ...(deps.localBusy ? { localBusy: deps.localBusy } : {}),
    ready: deps.ready ?? (() => ctx.svc.runtime.isReady()),
    ...(deps.limits ? { limits: deps.limits } : {}),
    log: (m) => ctx.log(m),
    onChange: publish,
    onPairRequest: (request) => ctx.emit("lan:pair-request", request),
  });

  function dropPairing(note: string): void {
    const from = pairing?.hostName;
    vault.clear();
    pairing = null;
    clientStatus = { state: "unpaired", ...(from ? { hostName: from } : {}), checkedAt: new Date().toISOString(), detail: note };
    publish();
  }

  const pairedClient = createPairedClient({
    pairing: () => pairing,
    onUnpaired: () => dropPairing(UNPAIRED_NOTE),
    ...(deps.busyWaitMs !== undefined ? { busyWaitMs: deps.busyWaitMs } : {}),
  });

  function currentClient(): LanClientStatus {
    if (pairing) {
      const base = {
        hostName: pairing.hostName,
        address: pairing.host,
        deviceName: pairing.deviceName,
        pairedAt: pairing.pairedAt,
      };
      if (clientStatus && (clientStatus.state === "connected" || clientStatus.state === "unreachable")) return { ...clientStatus, ...base };
      return { state: "unreachable", ...base, detail: "Checking..." };
    }
    return clientStatus?.state === "unpaired" ? clientStatus : { state: "not-paired" };
  }

  const svc: LanService = {
    status(): LanStatus {
      return { host: host.state(), client: currentClient() };
    },

    async startHost() {
      try {
        await host.start();
      } catch (e) {
        saveConfig({ hostEnabled: false });
        throw e;
      }
      saveConfig({ hostEnabled: true });
      return svc.status();
    },

    async stopHost() {
      await host.stop();
      saveConfig({ hostEnabled: false });
      return svc.status();
    },

    createPairingCode: () => host.createPairingCode(),
    listDevices: () => host.devices(),

    approve(requestId) {
      host.approve(requestId);
      return svc.status();
    },
    deny(requestId) {
      host.deny(requestId);
      return svc.status();
    },
    revoke(deviceId) {
      host.revoke(deviceId);
      return svc.status();
    },

    async pair(pairingString, deviceName) {
      const payload = decodePairing(pairingString);
      // Checked before contacting the host: once it approves, a token exists on its side that we could not then keep.
      if (!deps.secrets.isEncryptionAvailable()) throw new UserError(NO_PROTECTION_MESSAGE);
      const result = await requestPairing(payload, deviceName);
      vault.save(result);
      pairing = result;
      clientStatus = { state: "connected", checkedAt: new Date().toISOString(), detail: "Connected." };
      publish();
      return currentClient();
    },

    async clientStatus() {
      if (!pairing) return currentClient();
      const check = await checkHost(pairing);
      if (check.state === "unpaired") {
        dropPairing(UNPAIRED_NOTE);
        return currentClient();
      }
      clientStatus = { state: check.state, checkedAt: new Date().toISOString(), detail: check.detail };
      publish();
      return currentClient();
    },

    unpair() {
      vault.clear();
      pairing = null;
      clientStatus = null;
      publish();
      return currentClient();
    },

    client(): InferenceClient | null {
      return pairing ? pairedClient : null;
    },

    async dispose() {
      await host.stop();
    },
  };

  if (config().hostEnabled && deps.autoStart !== false) {
    host.start().catch((e) => ctx.log(`could not restart sharing at launch: ${e instanceof Error ? e.message : String(e)}`));
  }
  return svc;
}
