import celebrate from "./clips/celebrate.webm";
import excited from "./clips/excited.webm";
import hop from "./clips/hop.webm";
import idle from "./clips/idle.webm";
import nod from "./clips/nod.webm";
import oops from "./clips/oops.webm";
import poster from "./clips/rest.webp";
import talk from "./clips/talk.webm";
import think from "./clips/think.webm";
import tilt from "./clips/tilt.webm";
import wave from "./clips/wave.webm";

/**
 * Non's animated clips: Pip rendered in Blender (see PROVENANCE.md), 560 x 560, 60 fps, transparent VP9.
 * `poster` is the first frame of `idle`, shown instead of any clip when motion is off.
 */
export const NON_CLIPS = { idle, wave, hop, excited, celebrate, talk, think, tilt, nod, oops } as const;
export type NonClipName = keyof typeof NON_CLIPS;
export const NON_CLIP_POSTER = poster;

/** The part of each 560 x 560 frame that holds the character with room for the jump and the ground shadow (measured). */
export const CLIP_VIEW = { top: 20, right: 60, bottom: 0, left: 60 } as const;
export const CLIP_ASPECT = (560 - CLIP_VIEW.left - CLIP_VIEW.right) / (560 - CLIP_VIEW.top - CLIP_VIEW.bottom);
