import type { ChangeEdit, ChangeStatus, TaskState } from "../../../../shared/contracts";
import { baseName, plural } from "../lib";

export type ChipTone = "chip-ok" | "chip-attn" | "chip-red" | "chip-info" | "";

export const STATUS_CHIP: Record<ChangeStatus, { label: string; tone: ChipTone }> = {
  staged: { label: "Waiting for your OK", tone: "chip-info" },
  applying: { label: "Making the change", tone: "chip-info" },
  applied: { label: "Change made", tone: "chip-ok" },
  rejected: { label: "You said no", tone: "" },
  stale: { label: "File changed", tone: "chip-attn" },
  partial: { label: "Only partly done", tone: "chip-attn" },
  recovered: { label: "Undone", tone: "chip-ok" },
  failed: { label: "Did not work", tone: "chip-red" },
};

export const TASK_STATE_WORDS: Record<TaskState, string> = {
  inspecting: "Looking at your files",
  clarifying: "Needs a quick answer from you",
  running: "Working on it",
  validating: "Double-checking",
  review: "Ready for you to check",
  applying: "Making the change",
  complete: "Done",
  interrupted: "Stopped",
  waiting: "Waiting",
  "needs-attention": "Needs a look",
  rejected: "You said no",
  failed: "Something went wrong",
};

export function describeEdit(e: ChangeEdit): string {
  switch (e.op) {
    case "create-file":
      return `Create ${baseName(e.path)}`;
    case "csv-set-cells": {
      const extra = e.appendColumns?.length ? ` and add ${plural(e.appendColumns.length, "column")}` : "";
      return `Change ${plural(e.cells.length, "cell")}${extra}`;
    }
    case "xlsx-set-cells": {
      const extra = e.appendColumns?.length ? ` and add ${plural(e.appendColumns.length, "column")}` : "";
      return `Change ${plural(e.cells.length, "cell")} on sheet "${e.sheet}"${extra}`;
    }
    case "rename-move":
      return `Move ${baseName(e.from)} to ${baseName(e.to)}`;
  }
}

export function fileExt(path: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return m?.[1] ? m[1].toLowerCase() : "";
}

export function isNumeric(cell: string): boolean {
  return /^[\s₱$€£+-]*\(?[\d,]+(\.\d+)?\)?%?\s*$/.test(cell);
}
