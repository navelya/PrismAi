# Character Assets Isolation + Character Variants — Design

**Date:** 2026-05-23
**Status:** Approved (pending spec review)

Two related changes to the Characters feature:

1. **Bug fix:** character reference images leak into the user's global "All assets" and "Last runs" lists (with duplicates). They should belong only to their character.
2. **Feature:** a "Create variant" button on each character that restyles the look from a prompt and produces a new standalone character.

---

## Goal 1 — Stop character images leaking into Assets / Last runs

### Root cause

The `character` node is **non-generative**, so `isEphemeralNode()` returns true
([lib/nodes/core/server-registry.ts:31](../../../lib/nodes/core/server-registry.ts)) and the node is
executed via the ephemeral executor, which writes its reference-image URLs into `node_results`
as `result_type: 'image'` ([lib/workflow/ephemeral-executor.ts:96-125](../../../lib/workflow/ephemeral-executor.ts)).

However, the character node lacks the **`meta.ephemeral: true`** flag. That flag — distinct from
`isEphemeralNode()` — drives two things:

- **Finalization cleanup** ([lib/workflow/orchestrator.ts:377-386](../../../lib/workflow/orchestrator.ts)) deletes
  `node_results` rows (and ephemeral-bucket storage) for flagged nodes after a run reaches a terminal state.
- **Live-window asset filter** ([components/editor/AssetsPanel.tsx:36-45](../../../components/editor/AssetsPanel.tsx)) hides
  flagged nodes' outputs while a run is in flight.

Because `character` is unflagged, its rows are never cleaned up and never hidden. Every workflow run
that contains a character node re-writes the same ~6 reference URLs into `node_results`, so they
accumulate in both asset views — hence the duplicates.

Character **generation** itself does NOT leak: `/api/characters/generate` uploads to storage and the
client persists URLs into the `characters` table only. The leak is exclusively the canvas character node.

### Decision: flag the character node as ephemeral

Add `meta.ephemeral: true` to the character node's shared definition
([lib/nodes/plugins/character/definition.ts](../../../lib/nodes/plugins/character/definition.ts)).

This reuses the exact machinery already proven for blur/levels/compositor:

- After each run, `cleanupEphemeralResults` deletes the character node's `node_results` rows.
- The live filter hides them during the run.
- Storage cleanup only lists/deletes under the **ephemeral bucket** keyed by `executionId`
  ([orchestrator.ts:393-395](../../../lib/workflow/orchestrator.ts)). Character images live in the
  `chat-assets` bucket under `{userId}/characters/...`, so they are **untouched** — the character record
  keeps all its images.

**Safety of deleting character rows (verified):** the execution start route's backward BFS always
re-includes ephemeral ancestors in the execution set and re-runs them
([app/api/executions/start/route.ts:168-179](../../../app/api/executions/start/route.ts)). A character node
is an ephemeral ancestor, so its result is regenerated on every run (full or partial). Deleting its row
after a run can never starve a downstream node on a later run.

**Verification step (must confirm during implementation):** check that flagging `character` ephemeral
does not change anything in `lib/workflow/persist-node.ts` or the node's own rendering. `meta.ephemeral`
is only read in `AssetsPanel.tsx` and `orchestrator.ts` (confirmed by grep), and the character node renders
its thumbnails from `config.referenceImages`, not from `node_results` — so no preview regression is expected.
Confirm before claiming done.

### Decision: one-time cleanup of existing leaked rows

Add `scripts/cleanup-character-assets.js` (run once, service-role, like other `scripts/*.js`). It deletes
`node_results` rows where `result_type = 'image'` and any element of `result_data` contains the
`/characters/` storage path segment — the path `/api/characters/generate` uploads to
([app/api/characters/generate/route.ts:114](../../../app/api/characters/generate/route.ts)). This is precise:
only character reference images live under that path.

The script must:

- Page through `node_results` (image rows) rather than loading all at once.
- Match on the `/characters/` segment in any `result_data` URL.
- Print a dry-run count first, then delete when run with an explicit `--apply` flag.

### Scope

- **Characters only.** `media_input` is intentionally left as-is (user keeps uploaded media in assets).
- No schema migration. No change to the global `AssetsGallery` query — once rows are cleaned up and the
  ephemeral flag prevents new ones, the global gallery is clean (it only ever shows finalized rows).

### Out of scope

- Reworking the two overlapping "ephemeral" concepts (`isEphemeralNode()` family check vs. `meta.ephemeral`).
  Noted as a latent footgun but not touched here.

---

## Goal 2 — "Create variant" with a new style

Produce a **new standalone character** that keeps the original's facial identity but restyles the look
(outfit / art-style / palette) from a text prompt, regenerating all positions.

### User flow

1. User clicks **Create variant** (wand icon) on a character card.
2. A modal opens: source thumbnail, a **style prompt** textarea, a **name** field (prefilled
   `"{originalName} (variant)"`).
3. User clicks Generate. Images stream into slots (same progressive UI as `CharacterModal`).
4. **Review then save:** when generation finishes, the user sees the 6 images + editable name and clicks
   **Save**, which creates a new character via the existing `createCharacter` path. The new card appears
   immediately (the `useCharacters` hook prepends it).

### Generation pipeline

New streaming endpoint `POST /api/characters/[id]/variant`, mirroring the NDJSON event protocol of
`/api/characters/generate` (`start` / `image` / `pose_failed` / `error` / `done`). Steps:

1. Auth + load source character by id (RLS-scoped). Resolve its **base** image (`reference_images[0]`)
   and its **face** image (the entry with `role === 'face'`, falling back to the base).
2. **Restyle the base** — fetch the source base URL → base64, then image→image with a restyle prompt:
   *"Generate the EXACT SAME character — identical face, hair, and body proportions — but restyled as:
   {style}. Change the outfit, art-style, and color palette to match; full-body head-to-toe front A-pose,
   plain white background, studio lighting, no text/props."* → new index 0, upload, stream.
3. **Poses 1-4** conditioned on the **new** base (reuse the existing `conditionedPrompt`), in parallel.
4. **Face** restyled from the source **face** image (identity anchor) with the new style, in parallel.
5. `done`.

Identity preservation comes from conditioning every step on the original's own base/face images.

### Refactor (focused, serves this feature)

`/api/characters/generate/route.ts` and the variant route share ~80% of their logic. Extract the common
parts into a small `lib/characters/` module:

- **Prompt builders** (`basePrompt`, `conditionedPrompt`, `facePrompt`, new `restyleBasePrompt(style)`,
  `restyleFacePrompt(style)`).
- **Gemini helpers** (`firstImagePart`, `uploadCharacterImage`, new `fetchImageAsBase64(url)`).
- **The streaming pipeline**: a helper that takes a "produce base" strategy + a face source + an optional
  style suffix, then generates/uploads/streams poses 1-4 + face conditioned on the base. `generate` passes
  a text/photo base strategy; `variant` passes a restyle-from-source-base strategy.

Both route files become thin wrappers. This keeps the two flows from diverging and keeps each file small.

### Client

- `lib/api/client.ts`: add `generateCharacterVariantStream(characterId, { style }, handlers)` that POSTs to
  `/api/characters/[id]/variant` and reuses the same NDJSON line-reader as `generateCharacterStream`
  (extract the shared reader if convenient).
- New component `components/assets/CharacterVariantModal.tsx`: reuses the slot-rendering UI pattern from
  `CharacterModal` (skeleton tiles → images stream in), plus the style textarea, name field, and a
  Save button wired to `createCharacter`.

### Button placement (both surfaces)

- **Full-page `/assets`** — [components/assets/CharacterCard.tsx](../../../components/assets/CharacterCard.tsx):
  add a wand button to the hover overlay next to Edit/Delete; wire an `onVariant(character)` prop up through
  the grid and the assets page to open the variant modal.
- **In-editor side panel** — the inline card in
  [components/editor/CharactersPanel.tsx](../../../components/editor/CharactersPanel.tsx): add the same wand
  button to its hover overlay (it currently only supports click/drag-to-canvas), opening the variant modal
  hosted by the panel. Stop propagation so clicking the button does not also drop a node on the canvas.

### Data model

No schema change. The variant is a normal standalone row in `characters` (user chose standalone, not a
linked/parent-child model). Name defaults to `"{originalName} (variant)"` but is user-editable before save.

---

## Testing / verification

There is no test runner in this repo; verification is manual + ad-hoc scripts.

- **Goal 1:** with a character node on the canvas, run a workflow; confirm the character images do **not**
  appear in "All assets" or "Last runs" after the run finalizes, and that re-running does not create
  duplicates. Run the cleanup script (dry-run, then `--apply`) and confirm existing dupes disappear.
  Confirm downstream generators still receive the character's reference images during a run.
- **Goal 2:** create a variant from an existing character; confirm the 6 images stream in, identity is
  preserved with the new style, and Save produces a new card. Confirm the variant's images do **not** leak
  into assets (same ephemeral path as any character node).
- Type-check with `npx tsc --noEmit` (the reliable check in this repo; `npm run lint`/`build` are flaky here).
