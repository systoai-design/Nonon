import { describe, expect, it } from "vitest";
import { countdown, previewPairing } from "../../../renderer/src/views/connections/pairingPreview";
import { encodePairing, newPairingSecret, shortCodeFor, type PairingPayload } from "./tokens";

describe("pairing preview shown to the person pasting a code", () => {
  const payload: PairingPayload = { v: 1, h: "192.168.1.20", p: 18765, f: "9f".repeat(32), s: newPairingSecret(), n: "Kyle's desk PC" };

  it("shows the same six digits the host shows, and the host's name and address", async () => {
    const preview = await previewPairing(`  ${encodePairing(payload)}\n`);
    expect(preview).toEqual({ hostName: "Kyle's desk PC", address: "192.168.1.20", port: 18765, shortCode: shortCodeFor(payload.f, payload.s) });
  });

  it("rejects text that is not a pairing code", async () => {
    expect(await previewPairing("hello")).toBeNull();
    expect(await previewPairing("https://192.168.1.20:18765")).toBeNull();
    expect(await previewPairing("nonon-pair-1.@@@")).toBeNull();
  });

  it("counts down in minutes and seconds and ends at zero", () => {
    const now = 1_000_000;
    expect(countdown(new Date(now + 272_000).toISOString(), now)).toBe("4:32");
    expect(countdown(new Date(now + 5_000).toISOString(), now)).toBe("0:05");
    expect(countdown(new Date(now - 1).toISOString(), now)).toBeNull();
  });
});
