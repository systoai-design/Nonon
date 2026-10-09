import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

/** Software rendering (no GPU) cannot blur a full-window backdrop at 60 fps, so CSS drops the blur and keeps the fade. */
function markSoftwareRendering(): void {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    const name = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    if (!gl || /swiftshader|software|llvmpipe|basic render/i.test(name)) document.documentElement.dataset.softGpu = "1";
  } catch {
    document.documentElement.dataset.softGpu = "1";
  }
}

async function boot(): Promise<void> {
  markSoftwareRendering();
  // CSS reads this to leave room for the macOS traffic lights in the title strip.
  document.documentElement.dataset.platform = typeof window.nonon !== "undefined" ? window.nonon.platform : /Mac/.test(navigator.userAgent) ? "darwin" : "win32";
  // Plain browser (pnpm dev:web) has no preload bridge: load the labelled demo bridge on demand.
  // Electron always has window.nonon, so this chunk is never fetched there.
  if (typeof window.nonon === "undefined") {
    const { installMockBridge } = await import("./lib/mockBridge");
    installMockBridge();
  }
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
