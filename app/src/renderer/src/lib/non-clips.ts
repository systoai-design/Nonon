import type { NonClipName } from "../assets/non/clips";
import type { NonState } from "./companion";

/**
 * Which Blender clip plays for each of Non's six states. `loop: false` clips play once and hold their last frame (it is the
 * resting pose again), then the parent's own state change brings the idle loop back.
 */
export const CLIP_FOR_STATE: Record<NonState, { clip: NonClipName; loop: boolean }> = {
  idle: { clip: "idle", loop: true },
  greeting: { clip: "wave", loop: false },
  listening: { clip: "tilt", loop: true },
  thinking: { clip: "think", loop: true },
  talking: { clip: "talk", loop: true },
  success: { clip: "celebrate", loop: false },
};

/** Below this size the quiet vector face is used: a 3D clip would be too small to read and costs a video decoder per avatar. */
export const CLIP_MIN_SIZE = 80;
