import { useEffect, useState } from "react";
import type { OutputPreview } from "../../../shared/contracts";
import { api } from "../lib/bridge";
import { plainError } from "../lib/format";

export type PreviewState = { status: "loading" } | { status: "ready"; preview: OutputPreview } | { status: "error"; message: string };

const cache = new Map<string, OutputPreview>();
const MAX_CACHED = 40;

const keyOf = (path: string, version: string, maxRows: number | undefined) => `${path}|${version}|${maxRows ?? ""}`;

/**
 * Loads a file's in-app preview. `version` (the task's updatedAt) makes a re-run show fresh content,
 * and finished tasks reopen instantly from the cache.
 */
export function usePreview(path: string | null, version: string, maxRows?: number): PreviewState & { reload: () => void } {
  const [state, setState] = useState<PreviewState>(() => {
    const hit = path ? cache.get(keyOf(path, version, maxRows)) : undefined;
    return hit ? { status: "ready", preview: hit } : { status: "loading" };
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!path) return;
    const key = keyOf(path, version, maxRows);
    const hit = nonce === 0 ? cache.get(key) : undefined;
    if (hit) {
      setState({ status: "ready", preview: hit });
      return;
    }
    let live = true;
    setState({ status: "loading" });
    api.call("output:preview", { path, maxRows }, { silent: true }).then(
      (preview) => {
        if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string);
        cache.set(key, preview);
        if (live) setState({ status: "ready", preview });
      },
      (e) => {
        if (live) setState({ status: "error", message: plainError(e) });
      },
    );
    return () => {
      live = false;
    };
  }, [path, version, maxRows, nonce]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}

/** First file worth showing: the first output the viewer can render, else the first one. */
export function primaryOutput<T extends { path: string }>(outputs: T[]): T | undefined {
  const showable = /\.(xlsx|csv|md|markdown|txt|docx|json)$/i;
  return outputs.find((o) => showable.test(o.path)) ?? outputs[0];
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Some Electron contexts refuse the async clipboard; the selection route still works.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}
