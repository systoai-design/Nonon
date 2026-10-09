# Non: artwork provenance

Non is the original Pragma mascot Pip, shown in NONON under the name Non. Kyle's official brand pack
(`brand/NONON-brand-pack-v1/`, prepared 2026-10-09) supplies these files; they replace the earlier stand-ins.

## Static poses

Source in Pragma: `D:\New Claude\Pragma\Videos\pragma-usecases\bring-companions\assets\`
The brand pack's `mascots/*.png` are byte-for-byte copies of the Pragma renders (560 x 560, RGBA, no pixel editing). The
originals carry faint shadow pixels that reach the image edge and draw a square on light backgrounds, so NONON ships
the fitted copies made from them (`brand/derived/non-*-fit.webp`: the same pixels, outer shadow faded to alpha 0 at every
edge, all three cropped to ONE shared 325 x 461 frame with the character centred at x 163 and the feet at y 392, WebP). The originals stay untouched in `brand/NONON-brand-pack-v1/mascots/`.

| File here | Derived from | Pragma original | sha256 of the untouched original |
| --- | --- | --- | --- |
| `non-rest.webp` | `mascots/non-rest.png` | `pip-rest.png` | `9ae29cae0b2e9da97f2e06922a630fc5e24da65b1bf1dea138ff2e562a0b674c` |
| `non-wave.webp` | `mascots/non-wave.png` | `pip-wave.png` | `fd4e177bfad42dd288ec5ff6938c005108d3a4ef0251d903d4c9fcf068de992d` |
| `non-success.webp` | `mascots/non-success.png` | `pip-cele.png` | `309a685c05f3b2794c6f374f3fe81d69f05bf7e4cbf6bfdbf425a8c22cbff39c` |

`NonArt` in `components/Non.tsx` sizes its box from the 325:461 frame and centres the image (`object-fit: contain`); the `avatar` variant is a square window onto the character for small sizes. Because the frame is shared, changing pose never moves the character.

## Animated companion (native 2D vector, from the brand pack `motion/` folder)

`components/Non.tsx` holds the face from `motion/non-idle.svg` as React markup (the six state files differ only in
their `data-state` and label), the animation rules from `motion/non-motion.css` live in `styles.css`, and
`lib/non-controller.ts` is a TypeScript port of `motion/non-controller.js` with the same behaviour (unsupported state
names rejected, paused while the document is hidden, reduced motion honoured, listeners removed on dispose).
These are 2D vector motions, not a 3D rig and not lip-sync.

## Brand logos

`assets/brand/` holds `nonon-logo-horizontal-color.svg`, `nonon-logo-stacked-color.svg` and `nonon-mark-color.svg`,
copied unchanged from the brand pack `logos/` folder (wordmark outlined from Nunito 1000, no font needed).

Redistribution terms of the Pragma artwork still need to be confirmed before public release.

## Animated clips (Blender renders of the Pip model)

`clips/*.webm` are Pip animations rendered in Blender from the Pip model in Pragma (`Videos/pip/out/pip.blend`, clips built
by `Videos/cast/pip_timeline.py` and encoded by `Videos/cast/encode_pip.sh`), copied unchanged from Pragma's onboarding assets
(`public/onboarding/pip/`): VP9 with alpha, 560 x 560, 60 fps. NONON uses ten of them: `idle`, `wave`, `hop`, `excited`,
`celebrate`, `talk`, `think`, `tilt`, `nod`, `oops`, plus the still `rest.webp` (the first frame of `idle`) for reduced motion.
The state map is in `lib/non-clips.ts` (idle to idle, greeting to wave, listening to tilt, thinking to think, talking to talk,
success to celebrate). The renders carry a faint baked ground shadow that touches the frame edge (alpha up to 19), so the
component crops to the character (`CLIP_VIEW` in `clips.ts`) and fades the picture out with an elliptical mask: the measured
difference from the panel background at the clip's outer edge is 0 levels.