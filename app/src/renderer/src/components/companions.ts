import type { CompanionCharacter } from "../../../shared/contracts";

/** Characters a person can pick. One ships today; add an entry (and its art) here to offer another. */
export const COMPANIONS: { id: CompanionCharacter; name: string; blurb: string }[] = [{ id: "non", name: "Non", blurb: "Your helper in NONON." }];

export const DEFAULT_COMPANION = COMPANIONS[0]!;
