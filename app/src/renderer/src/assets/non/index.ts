import rest from "./non-rest.webp";
import success from "./non-success.webp";
import wave from "./non-wave.webp";

/** The only place that names Non's static pose files (brand pack renders with the baked edge shadow faded to transparent). */
export const NON_ART = { rest, wave, success } as const;
export type NonPose = keyof typeof NON_ART;
