# Character Generation Redesign — Cover + Sheet

**Date:** 2026-06-11
**Branch:** dev
**Status:** Approved design

## Problem

Today a character is a set of up to 6 reference images the user has to micro-manage:
generate a base + 4 poses + a face close-up, then manually mark which image is the
primary and which is the face. The character node outputs **all** of them as an
`image_array`, and the chat-brain hydration has a "reference budget" that juggles
which images to feed. This is fiddly to create and noisy to reason about.

## Goal

Collapse a character down to **two images**:

- **Character sheet** — the real artifact and the **only** thing the node outputs and
  the only thing fed to generators / the chat brain. A single *photographic contact
  sheet*:
  - **Top row:** four full-body photographs of the same person — facing camera,
    left-facing profile, right-facing profile, facing away.
  - **Bottom row:** three close-up photographic portraits — facing camera, left
    profile, right profile.
- **Cover** — an AI-generated hero portrait derived from the chosen sheet.
  **Display-only**: shown on the node and in galleries, **never referenced** by any
  generator.

All three creation paths (describe / upload-image / variant) produce **4 candidate
sheets** in a big view; the user picks one or regenerates; the pick drives the cover.

## Decisions (locked)

| Question | Decision |
| --- | --- |
| How is the cover produced? | **AI-generated portrait** — one extra Gemini call from the chosen sheet. |
| Existing DB characters? | **Migrate** — backfill `sheet_url ← reference_images[0]`, `cover_url ← thumbnail_url`. |
| Sheet contents? | **2-row photographic contact sheet** (4 full-body + 3 face close-ups, as above). |
| Candidates per attempt? | **4 candidates for all flows** (describe, upload, variant). |

## Data model

New migration on `public.characters`:

- Add `sheet_url TEXT`, `sheet_path TEXT`, `cover_url TEXT`, `cover_path TEXT`.
- Keep `weight`, `description`.
- `reference_images` / `thumbnail_url` remain for history but go vestigial in the new
  path.

Backfill so existing characters keep working:

```sql
UPDATE public.characters SET
  sheet_url  = reference_images->0->>'url',
  sheet_path = reference_images->0->>'path',
  cover_url  = COALESCE(thumbnail_url, reference_images->0->>'url'),
  cover_path = reference_images->0->>'path'
WHERE sheet_url IS NULL
  AND jsonb_typeof(reference_images) = 'array'
  AND jsonb_array_length(reference_images) > 0;
```

A migrated character's "sheet" is just its old front view — lower fidelity, but it
functions. New characters get a proper contact sheet.

## The character node

- `CharacterConfig` becomes `{ characterId, name, sheetUrl, coverUrl?, description?, weight? }`.
- **Component** (`lib/nodes/plugins/character/component.tsx`) shows the **cover**
  (fallback: sheet). Remove the "+N more" badge.
- **Executor** (`executor.server.ts`) outputs the **sheet** as a single-element
  `image_array` (keeps every downstream reference-aware wiring intact). **Falls back
  to the old `referenceImages` array** when a saved workflow snapshot predates this
  change — old graphs must not break.
- `aiSchema` unchanged (`{ characterId }`).
- **Chat-brain hydration** (`lib/chat/tools/handlers.ts`): the `CharacterSnapshot`
  gains `sheetUrl` (and `coverUrl`); each character hydrates to `referenceImages =
  [sheetUrl]`. The `multiCharacter` image-budget branch collapses to one image per
  character.

The node's output `dataType` stays `image_array` — only the contents change (exactly
one element, the sheet).

## Generation pipeline (`lib/characters/reference-set.ts` rewrite)

Each candidate is **one Gemini call producing one composite contact sheet** — not 6
separate poses. 4 candidates = 4 parallel calls, streamed as each lands.

Prompt builders, each tuned to its input source (final wording pending web research on
best-practice character/model-sheet prompts — see "Prompt research" below):

- `sheetFromDescriptionPrompt(desc)` — text→image. Builds the 2-row sheet of the
  described character.
- `sheetFromImagePrompt(changes?)` — image→image. Identity from the uploaded photo;
  applies the user's requested changes (e.g. "high-waisted pants, change hair color").
- `sheetVariantPrompt(changes)` — image→image off the **existing sheet**; applies
  changes while preserving identity.
- `coverPrompt()` — image→image; chosen sheet → a clean single hero portrait.

All sheet prompts bake in the exact 2-row layout, "the same person in every frame",
photographic realism, plain solid background, consistent studio lighting, centered,
no text / watermark / props — for repeatable, consistent output.

Removed: `conditionedPrompt`, `facePrompt`, `restyleBasePrompt`, `restyleFacePrompt`,
`streamPosesAndFace`, `CONDITIONED_POSES`, the pose/face indices.

### Prompt research

Before finalizing the four builders, research current best-practice prompts for
character reference sheets / model sheets / turnaround sheets and consistent-identity
image generation, and fold the strongest, most repeatable phrasing into the builders.
The from-image and from-description prompts must differ to match where the input comes
from.

## API routes

- `POST /api/characters/generate` — input `{ description }` **or**
  `{ baseImage, changes }`; streams **4 candidate sheets**.
- `POST /api/characters/[id]/variant` — input `{ changes }`; conditions on the source
  `sheet_url`; streams **4 candidate sheets**.
- **New** `POST /api/characters/cover` — input `{ sheetUrl }` → `{ url, path }`.

New stream protocol (`SheetSetEvent`):

```
| { type: 'start';  total: number }
| { type: 'sheet';  index: number; url: string; path: string }
| { type: 'sheet_failed'; index: number }
| { type: 'error';  message: string }
| { type: 'done' }
```

These calls use Gemini directly (`GEMINI_API_KEY`), not Replicate/credits — **no
billing changes**. Cost per attempt: 4 sheet calls + 1 cover call.

## UX — creation wizard (shared between create & variant)

A 3-step flow, with `CharacterModal` and `CharacterVariantModal` reusing the same
candidate grid + confirm step (extract `SheetCandidateGrid` and the confirm step into
shared components rather than duplicating):

1. **Method step**
   - *Describe* — a textarea, then "Generate sheets".
   - *Upload image* — file picker; after upload, show the preview + a **"changes"
     prompt box** ("make her pants high-waisted, change hair color…") + "Generate
     sheets".
   - *Variant* opens straight into this step, seeded with the source sheet + a changes
     box (no describe/upload sub-choice).
2. **Big candidate view** — 4 large sheets stream in as they land; **click to select**
   or **Regenerate** (new batch of 4).
3. **Confirm step** — the selected sheet shown large + a **cover preview** (generated
   in the background the moment a sheet is selected) + Name + Description (auto-describe
   re-pointed at the sheet/cover) + weight slider + **Save**.

The modal widens (`max-w-3xl`) for the candidate grid. Drafts: an in-progress new
character with a selected sheet can still be saved as a draft on dismiss.

Removed from the modal: primary/face role markers, the 6-slot image management,
`MAX_IMAGES`.

## Client API (`lib/api/client.ts`)

- `generateCharacterStream({ description?, baseImage?, changes? }, handlers)` — updated
  to the `sheet` events.
- `generateCharacterVariantStream(id, { changes }, handlers)` — updated.
- New `charactersApi.generateCover(sheetUrl) → { url, path }`.
- `CharacterInput` gains `sheetUrl`, `sheetPath`, `coverUrl`, `coverPath`; no longer
  requires `referenceImages`.
- `Character` type gains `sheet_url`, `cover_url` (+ paths).

## Backward compatibility

- **Old DB characters** — migrated (sheet = old primary, cover = thumbnail).
- **Old saved workflows** — character node executor falls back to `referenceImages`
  when `sheetUrl` is absent in the frozen config.
- **Downstream wiring** — node output stays `image_array` (now one element).

## Out of scope / YAGNI

- No LoRA training changes (`lora_*` columns untouched).
- No change to how characters are @-mentioned in chat (only the hydrated payload
  shrinks to one image).
- Not dropping `reference_images` / `thumbnail_url` columns (kept for history).

## Verification

`npx tsc --noEmit` (lint/build are unreliable here). In-app E2E: create from
description → pick a sheet → cover generates → save → node shows cover, run feeds the
sheet; repeat for upload-with-changes and variant-with-changes; confirm an old
migrated character still resolves.
