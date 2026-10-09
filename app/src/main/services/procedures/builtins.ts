import type { ProcedureDef } from "../../../shared/contracts";
import { procedures as general } from "./general";
import { procedures as gmailBrief } from "./gmail-brief";
import { procedures as meeting } from "./meeting-followup";
import { procedures as spreadsheet } from "./spreadsheet-compare";
import { procedures as study } from "./study-packet";
import { procedures as teamDraft } from "./team-draft";

/** Every supported procedure. Each folder exports `procedures`; adding a folder here is the only registration step. */
export const BUILTIN_PROCEDURES: ProcedureDef[] = [...spreadsheet, ...meeting, ...study, ...general, ...gmailBrief, ...teamDraft];
