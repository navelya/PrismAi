# Blur-up loading for node media previews

## Problem

Image and video previews inside workflow nodes load with the browser's default
top-to-bottom raster reveal. We want a blur-up UX: media appears blurry first,
then fades in sharp once decoded.

A shared `BlurryImage` component (CSS blur → sharp fade via Framer Motion)
already does this and is used by `ai_generator`, `blur`, and `levels`. Three
surfaces still use raw `<img>`/`<video>` with no blur-up, and videos have no
blur-up treatment anywhere.

## Decisions

- **Technique:** reuse the existing CSS-blur fade pattern. No LQIP/blurhash, no
  DB/storage changes.
- **Scope:** all raw `<img>`/`<video>` previews in DOM-rendered nodes. The
  compositor's Konva canvas renderer is out of scope (separate rendering model).

## Components

### `components/ui/blur-reveal.ts` (new, shared)
Extract the identical Framer Motion config so image and video components share it:
- `initial`: `filter: blur(20px)`, `opacity: 0.3`
- `animate` (loaded): `blur(0)`, `opacity 1`, `scale 1`; (not loaded): `blur(20px)`,
  `opacity 0.5`, `scale 1.05`
- `transition`: `duration` (default 0.8), `ease [0.4, 0, 0.2, 1]`

### `components/ui/BlurryVideo.tsx` (new)
Video sibling of `BlurryImage`.
- `React.forwardRef` to the underlying `<video>` (callers need the ref for
  hover-play and metadata math).
- Blur-fade driven by an `isLoaded` flag flipped on the video's `onLoadedData`
  event (first frame decoded).
- Resets `isLoaded` when `src` changes.
- Passes through all video props (`muted`, `loop`, `playsInline`, `preload`,
  `width`, `className`, `onLoadedMetadata`, mouse handlers) so existing behavior
  is preserved.
- Glass placeholder backdrop (`bg-white/5 backdrop-blur-sm`) while `!isLoaded`.

### `components/ui/BlurryImage.tsx` (edit)
Consume the shared `blur-reveal` config (no behavior change).

## Wiring

| Location | Change |
|---|---|
| `media_input` single `<img>` | → `BlurryImage` (object-contain) |
| `media_input` single `<video>` | → `BlurryVideo` (keep `videoRef`, hover play) |
| `media_input` grid `<img>` thumb | → `BlurryImage` (`object-cover w-full h-full`) |
| `media_input` grid `<video>` thumb | → `BlurryVideo` (`object-cover`) |
| `character` primary `<img>` | → `BlurryImage` (`object-cover w-full h-full`) |
| `ai_generator` `<video>` | → `BlurryVideo` (keep `videoRef`, handlers, `preload="auto"`, `width={320}`) |
| `blur` `<video>` | → `BlurryVideo` (keep `previewVideoRef`, `onLoadedMetadata`, `preload="metadata"`) |

## Notes / risks

- `cn` uses `twMerge`, so `object-cover` overrides `BlurryImage`'s default
  `object-contain` cleanly.
- `BlurryImage`/`BlurryVideo` wrap media in their own `w-full h-full` div, so
  grid/character cells keep aspect/rounding from the parent.
- `AnimatePresence` keyed on `src` re-triggers blur-in on media swap (desired).
- Video ref survives the keyed remount via `forwardRef` (hover-play keeps working).

## Verification

`npx tsc --noEmit` (lint/build are unreliable in this repo). Manual visual check
of each node type's preview load.
