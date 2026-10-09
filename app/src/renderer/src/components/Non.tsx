import { useEffect, useRef } from "react";
import { NON_ART, type NonPose } from "../assets/non";
import { useAppState } from "../lib/bridge";
import type { NonState } from "../lib/companion";
import { useLayers } from "../lib/motion";
import { createNonController, type NonController } from "../lib/non-controller";

// Warm the image cache so the onboarding pose swap (wave, rest, success) never flashes an empty frame.
if (typeof Image !== "undefined") {
  for (const src of Object.values(NON_ART)) {
    const img = new Image();
    img.src = src;
  }
}

function NonFace({ state, size, still, replayKey, className }: { state: NonState; size: number; still: boolean; replayKey: number; className: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const reducedSetting = useAppState()?.settings.reducedMotion === true;

  // One controller per mounted animated face. It listens to visibility and the system reduced motion preference, and
  // the effect cleanup removes both listeners, so nothing survives an unmount.
  const controller = useRef<NonController | null>(null);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || still) return;
    const c = createNonController(svg, { reducedMotion: reducedSetting });
    controller.current = c;
    return () => {
      c.dispose();
      controller.current = null;
    };
  }, [replayKey, still, reducedSetting]);
  useEffect(() => {
    controller.current?.setState(state);
  }, [state, replayKey, still, reducedSetting]);

  return (
    <svg
      ref={svgRef}
      className={`non-fig non-layer ${className}`}
      viewBox="0 -14 256 272"
      width={size}
      height={size}
      data-state={still ? "idle" : state}
      data-reduced-motion={still ? "true" : undefined}
      focusable="false"
    >
      <g className="non-body-group">
        <ellipse cx="128" cy="210" rx="119" ry="38" fill="#F47B32" />
        <path d="M26 201C34 148 48 98 76 68C89 52 108 43 128 43C150 43 169 52 183 69C209 101 222 153 230 201Q128 235 26 201Z" fill="#111111" />
        <ellipse cx="156" cy="27" rx="16" ry="33" transform="rotate(40 156 27)" fill="#F47B32" />
        <ellipse className="non-eye" cx="93" cy="139" rx="11" ry="22" fill="#FFFFFF" />
        <ellipse className="non-eye" cx="165" cy="139" rx="11" ry="22" fill="#FFFFFF" />
        <path className="non-smile" d="M118 175Q128 187 139 175" fill="none" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" />
        <ellipse className="non-talk-mouth" cx="128" cy="178" rx="10" ry="12" fill="#FFFFFF" />
      </g>
      <g className="non-thought-dots" fill="#A84208">
        <circle cx="104" cy="245" r="4" />
        <circle cx="128" cy="245" r="4" />
        <circle cx="152" cy="245" r="4" />
      </g>
    </svg>
  );
}

/**
 * Non, the companion: the brand pack's native 2D vector face (motion/non-idle.svg), animated by the rules in styles.css
 * and driven through the controller port in lib/non-controller.ts. The face is inline markup written here, never loaded
 * from user data. `still` shows the quiet face with no motion at all (small avatars beside past messages).
 * `replayKey` restarts a one-shot (greeting, success) when the same state fires twice in a row.
 * When the state changes the old face fades out while the new one fades in, so nothing pops.
 */
export function Non({
  state = "idle",
  size = 48,
  still = false,
  label,
  replayKey = 0,
}: {
  state?: NonState;
  size?: number;
  still?: boolean;
  /** Accessible name. Omit or pass "" when a visible name sits next to the avatar. */
  label?: string;
  replayKey?: number;
}) {
  const layers = useLayers(state, 220, `${state}:${replayKey}`);
  return (
    <span className="non" data-still={still ? "true" : undefined} style={{ width: size, height: size }} role={label ? "img" : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : true}>
      {layers.map((l) => (
        <NonFace key={l.id} state={l.value} size={size} still={still} replayKey={replayKey} className={l.leaving ? "is-leaving" : l.id > 0 ? "is-entering" : ""} />
      ))}
    </span>
  );
}

// The fitted renders share one 325 x 461 frame (character centred at x 163, feet at y 392, soft shadow fading to nothing at
// every edge), so switching pose never moves the character. See assets/non/PROVENANCE.md.
// Rest pose, measured: body spans x 76..258 and y 171..387 in the frame, so its centre is (167, 279).
const FRAME = { w: 325, h: 461, cx: 167, cy: 279 };

/**
 * Non's static full-body art. Decorative: the name is always shown in words.
 * `full` shows the whole frame at the given width, centred. `avatar` is a square window onto the character for small
 * sizes, so the figure fills the box instead of being a tiny figure in a tall frame.
 */
export function NonArt({ pose = "rest", size = 160, variant = "full" }: { pose?: NonPose; size?: number; variant?: "full" | "avatar" }) {
  const layers = useLayers(pose, 220);
  const avatar = variant === "avatar";
  // Avatar window: a 270 frame px square centred on the resting character (it fills about 80% of the height, with room for
  // the ground shadow to fade out at the bottom edge).
  const win = 270;
  const k = size / win;
  return (
    <span className={`non-art ${avatar ? "non-art-avatar" : ""}`} style={{ width: size, height: avatar ? size : (size * FRAME.h) / FRAME.w }} aria-hidden="true">
      {layers.map((l) => (
        <span key={l.id} className={`non-art-layer ${l.leaving ? "is-leaving" : l.id > 0 ? "is-entering" : ""}`}>
          <img
            src={NON_ART[l.value]}
            alt=""
            draggable={false}
            style={avatar ? { width: FRAME.w * k, height: FRAME.h * k, left: -(FRAME.cx - win / 2) * k, top: -(FRAME.cy - win / 2) * k } : undefined}
          />
        </span>
      ))}
    </span>
  );
}
