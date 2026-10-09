import type { PackId, ProcedureDef } from "../../../shared/contracts";
import type { AppCtx, ProcedureRegistry } from "../types";
import { BUILTIN_PROCEDURES } from "./builtins";

export function createProcedureRegistry(_ctx: AppCtx): ProcedureRegistry {
  const defs = new Map<string, ProcedureDef>(BUILTIN_PROCEDURES.map((d) => [d.id, d]));
  return {
    // The general pack's procedures are offered in every workspace.
    list: (pack?: PackId) => [...defs.values()].filter((d) => !pack || d.pack === pack || d.pack === "general"),
    get: (id) => defs.get(id),
    register: (def) => {
      defs.set(def.id, def);
    },
  };
}
