import { afterEach, describe, expect, it, vi } from "vitest";
import { createNonController } from "./non-controller";

type Listener = () => void;

/** A tiny stand-in for the two browser objects the controller touches (mocked: no real DOM in the node test environment). */
function fakeBrowser(hidden = false, prefersReduced = false) {
  const docListeners = new Set<Listener>();
  const mediaListeners = new Set<Listener>();
  const doc = {
    hidden,
    addEventListener: (_: string, l: Listener) => docListeners.add(l),
    removeEventListener: (_: string, l: Listener) => docListeners.delete(l),
  };
  const media = {
    matches: prefersReduced,
    addEventListener: (_: string, l: Listener) => mediaListeners.add(l),
    removeEventListener: (_: string, l: Listener) => mediaListeners.delete(l),
  };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", { matchMedia: () => media });
  const svg = { dataset: {} as Record<string, string> } as unknown as SVGElement;
  return { doc, media, svg, docListeners, mediaListeners };
}

afterEach(() => vi.unstubAllGlobals());

describe("createNonController (port of the brand pack controller)", () => {
  it("sets supported states and rejects unknown ones", () => {
    const { svg } = fakeBrowser();
    const c = createNonController(svg);
    c.setState("thinking");
    expect(svg.dataset.state).toBe("thinking");
    expect(() => c.setState("dancing" as never)).toThrow(/Unsupported Non state/);
    expect(svg.dataset.state).toBe("thinking");
    c.stop();
    expect(svg.dataset.state).toBe("idle");
  });

  it("pauses while the document is hidden and resumes when it is shown", () => {
    const { doc, svg, docListeners } = fakeBrowser();
    createNonController(svg);
    expect(svg.dataset.paused).toBe("false");
    doc.hidden = true;
    docListeners.forEach((l) => l());
    expect(svg.dataset.paused).toBe("true");
    doc.hidden = false;
    docListeners.forEach((l) => l());
    expect(svg.dataset.paused).toBe("false");
  });

  it("follows the reduced motion preference and the app setting", () => {
    const { media, svg, mediaListeners } = fakeBrowser();
    const c = createNonController(svg);
    expect(svg.dataset.reducedMotion).toBe("false");
    media.matches = true;
    mediaListeners.forEach((l) => l());
    expect(svg.dataset.reducedMotion).toBe("true");
    media.matches = false;
    c.setReducedMotion(true);
    expect(svg.dataset.reducedMotion).toBe("true");
    c.setReducedMotion(false);
    expect(svg.dataset.reducedMotion).toBe("false");
    const forced = fakeBrowser().svg;
    createNonController(forced, { reducedMotion: true });
    expect(forced.dataset.reducedMotion).toBe("true");
  });

  it("removes every listener on dispose and ignores later calls", () => {
    const { svg, docListeners, mediaListeners } = fakeBrowser();
    const c = createNonController(svg);
    expect(docListeners.size).toBe(1);
    expect(mediaListeners.size).toBe(1);
    c.dispose();
    expect(docListeners.size).toBe(0);
    expect(mediaListeners.size).toBe(0);
    expect(svg.dataset.paused).toBe("true");
    c.setState("talking");
    expect(svg.dataset.state).toBeUndefined();
  });
});
