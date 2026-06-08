# Assets gallery: multi-select + density slider

**Date:** 2026-06-08
**Status:** Approved design, pre-implementation
**Scope:** `app/assets` "Assets" tab only (the `AssetsGallery` component). The
"Characters" tab and the in-workflow `AssetsPanel` are untouched.

## Goal

On the full-page Assets gallery, let the user:

1. Select multiple assets at once via Ctrl/Cmd+click, Shift+click range, a corner
   checkbox, or a drag marquee (selection box) on the grid background.
2. Run bulk actions on the selection: **Download** (as a single zip) and
   **Add to character**.
3. Control grid density with a slider that sets columns-per-row from 3 (large
   cards) to 10 (small cards), persisted across reloads.

**Deferred (explicitly out of scope):** bulk **delete**. No DB migration is part
of this work.

## Current state

`components/assets/AssetsGallery.tsx` renders a self-contained client component:

- Queries `node_results` directly via the RLS-scoped browser Supabase client
  (`createClient()`), unpacks rows into per-URL `AssetItem`s with `unpackAssets`.
- Renders a fixed responsive grid (`grid-cols-2 md:grid-cols-3 lg:grid-cols-4`).
- `AssetCard` opens an `ImageLightbox` on click; video previews play on hover.

`AssetItem` (from `lib/assets/unpack.ts`) is one media URL with a stable `id`
(`"<rowId>:<index>"`), plus `source_result_id`, `result_type`, `result_url`.

Relevant existing infra:

- `uploadApi.uploadUrl(url, opts)` — copies a remote URL into storage, returns
  `{ publicUrl, path }`. This is how an asset URL becomes a `CharacterRefImage`.
- `CharacterModal` — create/edit a character; holds up to `MAX_IMAGES = 6`
  reference images; created via `charactersApi`/`useCharacters`.
- `jszip@^3.10.1` is already a dependency.

## Design

### Component breakdown

- **`AssetsGallery`** (existing, extended) — owns all new state and the data; the
  single source of truth for selection and column count. Renders the header
  controls, the grid, the marquee overlay, and the selection toolbar.
- **`AssetSelectionToolbar`** (new, `components/assets/AssetSelectionToolbar.tsx`)
  — presentational. Props: `count`, `onClear`, `onDownload`, `onAddToCharacter`,
  `downloading` (busy state), `imageCount` (to enable/disable Add-to-character).
  Keeps `AssetsGallery` focused.
- **`AssetCard`** (existing, extended) — receives `selected`, `onCardClick(e)`
  (decides lightbox vs toggle vs range from modifier keys), `onCheckboxToggle`,
  and registers its DOM node via a ref callback so the gallery can hit-test it
  for the marquee.
- **`CharacterModal`** (existing, extended) — accepts an optional
  `seedImages?: CharacterRefImage[]` prop; when `open` transitions true and seeds
  are present (create mode only), it initializes `images` from the seeds.

### 1. Density slider

- A range `<input type="range">` (or styled equivalent) in the gallery header,
  `min=3 max=10 step=1`, labeled with the current value.
- State `columns: number`, initialized from `localStorage["assets:gridColumns"]`
  (fallback `4`), written back on change. Guard `localStorage` access for SSR/
  read failures.
- The grid container drops the fixed Tailwind column classes and uses an inline
  style: `gridTemplateColumns: repeat(${columns}, minmax(0, 1fr))`. Cards stay
  `aspect-square`, so increasing `columns` shrinks them. `minmax(0,1fr)` prevents
  overflow on narrow viewports.
- The loading skeleton grid uses the same inline template so it matches.

### 2. Selection model

State in `AssetsGallery`:

- `selectedIds: Set<string>` — selected `AssetItem.id`s.
- `lastIndex: number | null` — anchor for Shift range selection, in
  `visibleAssets` order.

Interactions (all operate over the current `visibleAssets` array so indices match
what is on screen under the active type filter):

- **Plain click** on a card → open lightbox (unchanged).
- **Ctrl/Cmd+click** → toggle that card's id in `selectedIds`; set `lastIndex`.
- **Shift+click** → select every card between `lastIndex` and the clicked index
  (inclusive); if `lastIndex` is null, behaves like a single toggle-on.
- **Corner checkbox** → visible on hover and always when selected; click toggles
  selection and does **not** open the lightbox (`stopPropagation`). Set
  `lastIndex`.
- **Marquee** → `pointerdown` on the grid background (not on a card) starts a
  drag; an absolutely-positioned rectangle follows the pointer; on `pointermove`
  the gallery hit-tests each registered card rect against the marquee rect and
  sets `selectedIds` to the intersecting ids (replace semantics; holding Ctrl/Cmd
  could union, but v1 replaces). `pointerup` ends the drag. A small movement
  threshold (e.g. 4px) avoids hijacking clicks. Card rects come from ref-tracked
  DOM nodes via `getBoundingClientRect()`, offset by the grid container's rect.
- **Esc** or the toolbar **Clear** button → empty `selectedIds`, reset
  `lastIndex`.

Marquee hit-testing reads layout synchronously on pointermove; it's bounded by
the ≤200 visible cards, acceptable without virtualization.

### 3. Bulk-action toolbar

- Rendered sticky at the top of the gallery body when `selectedIds.size > 0`
  (a slide/fade in is fine; keep it cheap). Shows `"{n} selected"`, a Clear
  button, and two actions.
- **Download (zip):**
  - Resolve selected ids → their `AssetItem`s.
  - For each, `fetch(result_url)` → `blob()`; add to a `JSZip` instance under a
    filename derived from the url's extension and the id (ensure uniqueness).
  - `zip.generateAsync({ type: "blob" })` → object URL → anchor download named
    e.g. `assets-{count}.zip`. Revoke the object URL after.
  - Show a `downloading` busy state on the button; surface a soft error if any
    fetch fails (still zip the ones that succeeded; note failures).
- **Add to character:**
  - Filter selection to `result_type === "image"`; if none, the action is
    disabled with a tooltip. Cap at `MAX_IMAGES` (6); if more are selected, take
    the first 6 and note the cap in the toolbar/label.
  - For each chosen image, `uploadApi.uploadUrl(result_url, { filename })` →
    `{ url: publicUrl, path }` as a `CharacterRefImage`. Run with a busy state.
  - Open `CharacterModal` in create mode with `seedImages` set to the uploaded
    refs. The user names/saves as normal. On save the selection can be cleared.

### 4. No DB / API changes

Download and Add-to-character use existing client paths (`fetch`, `uploadApi`,
`charactersApi` via the modal). Delete is deferred, so the previously-considered
`node_results` DELETE RLS policy is **not** part of this work.

## Data flow

```
node_results (RLS SELECT)
  └─ unpackAssets → AssetItem[]  (assets)
       └─ typeFilter → visibleAssets
            ├─ render grid (columns from slider)
            ├─ selectedIds drives card highlight + checkbox + toolbar
            ├─ marquee → hit-test card rects → selectedIds
            ├─ Download → fetch blobs → JSZip → download .zip
            └─ Add to character → uploadUrl per image → CharacterModal(seedImages)
```

## Error handling

- `localStorage` reads/writes wrapped in try/catch; fall back to default columns.
- Download: per-file fetch failures don't abort the batch; the zip contains what
  succeeded, and the toolbar reports the failure count.
- Add to character: if any `uploadUrl` fails, report count; open the modal with
  whatever uploaded successfully (≥1) or show an error if none did.
- Marquee guards against a zero-size drag (treated as a click, not a selection).

## Testing (manual; repo has no test runner)

- `npx tsc --noEmit` clean (project-standard verification).
- Slider 3↔10 resizes the grid live and survives a hard refresh.
- Ctrl/Cmd, Shift-range, checkbox, and marquee each select as specified; plain
  click still opens the lightbox; Esc/Clear deselect.
- Download a mixed selection → one zip with all fetched files.
- Add-to-character with 1, 6, and >6 images selected (cap behavior); modal opens
  pre-seeded; saved character has the reference images.

## Out of scope / future

- Bulk delete (+ owner DELETE RLS policy on `node_results`).
- Per-item delete that rewrites `result_data` arrays.
- Selection/density on the in-workflow `AssetsPanel`.
- Keyboard select-all (Cmd+A), virtualization for very large galleries.
