import logo from "../../assets/brand/nonon-logo-stacked-color.svg";
import type { SettingsCtx } from "./types";

export function AboutSection({ ctx }: { ctx: SettingsCtx }) {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <img src={logo} alt="NONON" className="about-logo" />
      <div>
        <h2>About NONON</h2>
        <p className="m-0 mt-1 muted">Version {ctx.version} on {ctx.platform === "darwin" ? "macOS" : ctx.platform === "win32" ? "Windows" : ctx.platform}.</p>
      </div>
      <p className="m-0">
        NONON helps you finish everyday work with your own files. The built-in AI runs on this computer and works without the internet. Online AI like Claude is optional and off
        until you turn it on.
      </p>
      <section className="panel p-5" aria-label="Licences">
        <h3 className="mb-1">Licences</h3>
        <p className="m-0 text-[14.5px]">
          Built with llama.cpp (MIT), Qwen3.5 (Apache-2.0), Electron and React, and other open source software. NONON itself is released under the
          Apache-2.0 licence.
        </p>
      </section>
    </div>
  );
}
