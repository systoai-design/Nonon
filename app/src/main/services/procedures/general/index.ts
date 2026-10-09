import type { ProcedureDef } from "../../../../shared/contracts";
import { documentDraft } from "./draft";
import { organizeFolderReview } from "./organize";

export const procedures: ProcedureDef[] = [documentDraft, organizeFolderReview];
