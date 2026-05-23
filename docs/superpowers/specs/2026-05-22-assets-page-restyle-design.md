# Assets Page Restyle + Real Assets Tab — Design

Date: 2026-05-22

## Problem

The standalone Assets page (`app/assets/page.tsx`) doesn't match the rest of the
app's visual language. It uses the heavy `bg-gradient-premium` pill button, which
is an outlier — editor/settings surfaces use a subtle glassy button
(`bg-white/5 hover:bg-white/10 border border-white/10`) and the sidebar/AssetsPanel
use soft-accent fills (`accent-primary/10`). The page also carries two disabled,
placeholder tabs (`Styles`, `Props`) and only ever shows Characters. There is no
way to browse the user's actual generated results from this page, even though the
workflow `AssetsPanel` already implements exactly that browse + type-filter UX.

## Goals

1. Restyle the page so it reads as part of the app (drop the gradient button for the
   app's subtle action style; remove placeholder tabs).
2. Add a real **Assets** tab that shows the user's generated results across *all*
   sessions, with the same type filtering as the in-workflow assets side panel.

## Non-goals

- Drag-to-canvas on the page (there is no canvas here).
- Download / "use in new workflow" actions on assets (deferred).
- Real-time subscription on the page gallery (it's a browse view with a refresh
  button; the panel keeps real-time for live runs).
- Styles / Props features (removed, not reimplemented).

## Design

### Tabs (`app/assets/page.tsx`)
- Tabs reduced to **Assets** (default) and **Characters**. Remove `Styles`/`Props`
  and the "soon" badges. Keep the existing underline tab style — it already fits.

### Style pass
- Replace `bg-gradient-premium` "New Character" button (page header + `CharacterGrid`
  empty state) with the soft-accent action style used by the sidebar active state /
  AssetsPanel chips: `bg-accent-primary/10 border border-accent-primary/20
  text-accent-primary hover:bg-accent-primary/15`, `px-4 py-2 rounded-lg`.
- The "New Character" button is contextual — only rendered on the Characters tab,
  not in the always-on page header.
- Search input already matches the app pattern; unchanged.

### New Assets tab — `components/assets/AssetsGallery.tsx` (new)
- Queries `node_results` for the user's completed image/video/audio/3d results,
  newest first, `limit(200)`, no `session_id` filter — RLS scopes to the user
  (mirrors the panel's "all" scope query).
- Type filter identical to the panel: All / Images / Videos / Audio / 3D.
- Wide responsive grid (`grid-cols-2 md:grid-cols-3 lg:grid-cols-4`), like
  `CharacterGrid`.
- Click a result to preview via the existing `ImageLightbox`.
- Loading skeletons + empty state styled consistently with the panel.
- A refresh button to refetch.

### Shared logic — `lib/assets/unpack.ts` (new)
- Move the pure `unpackAssets` helper and the `AssetType` / `TYPE_META` / `ALL_TYPES`
  constants out of `AssetsPanel.tsx` into a shared module. Both `AssetsPanel` and the
  new `AssetsGallery` import them. Pure-function move; no behavior change to the panel.

## Files touched

- `lib/assets/unpack.ts` — new shared util (types, constants, `unpackAssets`).
- `components/assets/AssetsGallery.tsx` — new page gallery.
- `components/editor/AssetsPanel.tsx` — import shared util (remove local copies).
- `app/assets/page.tsx` — tabs, default tab, button restyle, contextual button,
  render gallery.
- `components/assets/CharacterGrid.tsx` — restyle empty-state button.

## Verification

`npx tsc --noEmit` (the reliable check in this repo; `npm run lint`/`build` are
unreliable here).
