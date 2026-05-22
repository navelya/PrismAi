# Characters Feature — Design

**Date:** 2026-05-21
**Status:** Approved (brainstorming), ready for implementation plan

## Summary

A **Character** is a reusable, named identity (a person/creature) that a user creates once and
reuses across generations to keep that subject visually consistent. Characters are created in a new
**Assets** section, referenced from chat via an **`@` mention** picker, and materialize on the
workflow canvas as a dedicated **`character` node** that feeds reference images into any
reference-aware generative model.

v1 ships the **lightweight tier** (reference images + description, no training), with the data model
and node deliberately prepared for a later **LoRA fine-tuning** upgrade.

### Industry grounding (2026)

Research into how leading tools (Midjourney Omni Reference / `--cref`, Sora cameos, Google Whisk,
Astria/PhotoAI) handle consistent characters informed two decisions:

- **Reference-image conditioning is the standard lightweight path** — no training, reliable for
  ~5–10 images before drift. This is v1.
- **Multiple reference angles materially improve consistency** — consensus sweet spot is ~3 images
  (front, three-quarter, full-body). So v1 supports **1–5 reference images**, not a single image.
- **LoRA** (10–20 images, 85–95% feature retention) is the gold standard for recurring identities —
  deferred to v1.1 as an opt-in upgrade.

## Decisions locked during brainstorming

| Question | Decision |
|---|---|
| Character depth | Tier 1+2 (reference images + description) first; LoRA-ready schema for later |
| Canvas representation | New dedicated `character` node plugin |
| Creation flow | Quick-add inline modal (with auto-describe) |
| Section location | New `/assets` page in the sidebar, tabbed (Characters live; Styles/Props later) |
| `@` mechanism | Chips + structured metadata (not contenteditable, not eager canvas injection) |
| Reference images | 1–5 per character, index 0 = primary |
| Brain integration | Client sends ids; server hydrates node config from DB by id (LLM never sees URLs) |

---

## Section 1 — Data model

New `characters` table, user-owned, soft-deletable, LoRA-prepared.

```sql
create table characters (
    id               uuid primary key default uuid_generate_v4(),
    user_id          uuid not null references auth.users(id) on delete cascade,
    name             text not null,                 -- shown in @ picker + on canvas
    description      text,                           -- optional, fed into prompts
    reference_images jsonb not null,                 -- array of { url, path }; index 0 = primary
    thumbnail_url    text,                           -- 256px square of primary, for @ picker speed
    weight           int not null default 70,        -- 0-100 reference strength (Midjourney --cw analog)
    -- v1.1 LoRA fields (nullable now, no migration later):
    lora_url         text,
    lora_status      text,                           -- null | 'training' | 'ready' | 'failed'
    lora_training_id text,
    -- bookkeeping:
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    deleted_at       timestamptz,                    -- soft delete so saved workflows survive
    last_used_at     timestamptz                     -- drives "top 5" recency in @ picker
);

create index on characters (user_id, deleted_at, last_used_at desc);
create index on characters (user_id, deleted_at, name);
```

**Key points:**
- **`reference_images` is a `jsonb` array** (1–5). Index 0 is the primary used for the thumbnail and
  the `@` picker.
- **Soft delete** keeps a referenced character resolvable; saved workflows and chat history still
  render. Hard-purge via the nightly cron, gated on "referenced by zero saved canvases."
- **`thumbnail_url`** cached separately (256px, generated server-side with Sharp from the primary)
  so the `@` picker is sub-100ms.
- **`weight`** stored on the character, copied into node config on use; forwarded to models that
  support a reference-strength input, ignored otherwise.
- **No category/tags** in v1 — flat list, search-by-name.
- **Storage:** a dedicated `characters` Supabase storage bucket (permanent, user-scoped RLS),
  parallel to `workflow-assets`.

**RLS:** `select/insert/update/delete where user_id = auth.uid()`.

---

## Section 2 — The `character` node plugin

New plugin at `lib/nodes/plugins/character/`, following the exact `media_input` file split
(`definition.ts`, `component.tsx`, `executor.server.ts`, `index.ts`), registered in the three
registries (shared/client/server) plus `EPHEMERAL_HANDLERS`.

**Config — a snapshot, not a live reference:**
```ts
interface CharacterConfig {
    characterId: string;        // FK back to characters table (for future "refresh")
    name: string;               // snapshot — survives rename/delete
    referenceImages: string[];  // snapshot URLs (1-5); index 0 = primary
    description?: string;        // snapshot
    weight?: number;            // snapshot, 0-100
}
```
Storing a **snapshot** matches the codebase's immutable-graph philosophy (`executions.graph_json` is
frozen at run start) — a saved workflow must still render after the character is edited or deleted.
`characterId` is retained so a future opt-in "this character changed — update node?" is possible.

**Handles — one output, `image_array`:**
```ts
handles: {
    inputs: [],
    outputs: [{ id: 'character_out', label: 'Character', dataType: 'image_array' }],
}
```
Outputs the reference images as an `image_array`, so it plugs straight into any reference-aware
model's image input (`input_image` on Flux Kontext, etc.) with **zero changes to `ai_generator`**.
The executor mirrors `media_input`'s — returns the reference images as `ImageObject`s.

**Description path:** the description needs to land in the model's *text prompt*, but the edge
carries an *image*. v1 resolution: **the chat brain injects the description into the prompt text at
workflow-generation time** (it authors the prompt anyway, and characters almost always arrive via
chat). The node displays the description for the user. A dedicated `description_out` text handle is a
clean v1.1 add.

**Canvas appearance:** primary thumbnail + name + truncated description; color `#a855f7` (purple,
distinct from media_input blue); icon `UserCircle`.

---

## Section 3 — Assets page + creation modal

**Routing & nav.** New route `/assets` (default tab `/assets/characters`). Add one entry to
`navItems` in `components/layout/Sidebar.tsx`: `{ name: 'Assets', path: '/assets', icon: UserCircle }`,
between Library and Nodes. Page header carries tabs: `Characters` (live) · `Styles` · `Props`
(disabled "Coming soon" chips, matching the existing Templates pattern in `ChatInput`).

**Characters grid.** Reuses the visual language of `WorkflowList`/`WorkflowCard`: responsive card
grid; each card = primary thumbnail + name + truncated description + hover menu (`Edit`, `Delete`,
`Add to canvas`). Name search box (same pattern as the Library page). Prominent `+ New Character`
button opening the modal.

**Quick-add modal (`CharacterModal`, used for create + edit):**
```
┌─ New Character ───────────────────────────┐
│  ┌────┐ ┌────┐ ┌────┐                      │
│  │ +  │ │img │ │img │   drag-drop, up to 5 │
│  └────┘ └────┘ └────┘   first = primary ★  │
│                                            │
│  Name*        [ Alice                    ] │
│  Description  [ red hair, freckles...    ] │
│               [ ✨ Auto-describe          ] │
│                                            │
│  Reference weight  [——●———] 70             │
│                                            │
│              [ Cancel ]  [ Save Character ]│
└────────────────────────────────────────────┘
```
- Multi-image drop (1–5), reorderable; index 0 is the starred primary. Uploads go through a
  `/api/upload`-style flow into the `characters` bucket; server generates the 256px `thumbnail_url`
  with Sharp from the primary.
- **`✨ Auto-describe`** sends the primary image to Gemini Vision (`GEMINI_API_KEY`) to draft the
  description.
- **Reference weight** slider (0–100) stored on the character.
- Validation: name required, ≥1 image required.

**API surface.** New `/api/characters` route group: `GET` (list, ordered by `last_used_at`), `POST`
(create), `PATCH /[id]` (edit), `DELETE /[id]` (soft delete). All user-scoped via `getAuthenticatedUser`
+ RLS. Typed client `charactersApi` added to `lib/api/client.ts`, consumed by a `useCharacters` hook
for the page and the `@` picker.

---

## Section 4 — `@` mention picker in chat

**Constraint.** `components/chat/ChatInput.tsx` is a plain `<textarea>` with delicate auto-height
logic (ghost-probe, multi-line detection). True inline rich chips require `contenteditable`, which
would mean rewriting that logic — high risk. **Not** going contenteditable.

**Approach: trigger in text, render as chips (reuses the attached-images pattern).**
1. User types `@`; detect via textarea `value` + caret position; open floating picker.
2. As they type (`@al…`), filter. Pick via click or keyboard (↑/↓ + `Enter`/`Tab`, `Esc` closes).
3. On selection, **strip the `@al…` fragment** from the textarea and add the character as a
   **removable chip** in the existing chip row (same row that renders `attachedImages`). Typed prompt
   stays clean.
4. Chips are the source of truth → `mentionedCharacterIds: string[]`, lifted into `ChatInterface`
   alongside `attachedImages`.

**Picker UI (`CharacterMentionPicker`)**, floating panel above the input:
```
┌──────────────────────────────┐
│ 🔍 @al                        │
├──────────────────────────────┤
│ [img] Alice    red hair, fre… │  ← top 5 by last_used_at when query empty;
│ [img] Albert   tall, glasses… │     filters by name (substring) as you type
│ [img] Alana    …              │
│ ─────────────────────────────│
│ + Create new character        │  → opens CharacterModal
└──────────────────────────────┘
```
- Empty query → top 5 most-recently-used. Typing filters, revealing more.
- Empty state ("no characters yet") → "Create your first character" CTA opening `CharacterModal`.
- Data from `useCharacters`, prefetched on chat mount (names + thumbnails only — lightweight) so the
  picker is instant.

**On send**, `ChatInterface` includes `mentionedCharacterIds` in the POST to `/api/chat/stream`
(alongside message + attachments). Chips clear after send, same lifecycle as `attachedImages`.

---

## Section 5 — Chat brain (LLM) integration

> Note: the chat brain is **Anthropic/Claude** (haiku/sonnet), not Gemini — `ARCHITECTURE.md` is
> stale on this point. Auto-describe (Section 3) uses Gemini Vision separately.

**Transport: mirror `nodeRefs`.** The route already validates/caps `nodeRefs` (via `MAX_NODE_REFS`,
`lib/utils/selection-refs.ts`) and feeds them to `runBrain`. Add a parallel **`characterRefs`** path:
`mentionedCharacterIds` → validated/capped (`MAX_CHARACTER_REFS`) in the route → resolved against the
DB → passed into `runBrain`.

**Server-side resolution (security boundary).** The route fetches the mentioned `characters` rows
scoped to the session's `user_id`, and builds a compact context block —
`{ characterId, name, description, weight }` plus image URLs held server-side. **The LLM never sees
or fabricates URLs**; it only sees names/descriptions/ids.

**Prompt instructions.** The brain's system prompt gains: *"The user referenced these characters:
Alice (id: …, "red hair, freckles…"), Bob (…). When a request involves a character, add a `character`
node for it and wire its `character_out` into the target generator's image input, and weave the
character's description into the generator's prompt text."*

**Tool layer — hydration, not fabrication.** The `add_node` handler (`lib/chat/tools/handlers.ts`)
gets a special case: when the emitted node type is `character`, the handler **hydrates** the node
config (`name`, `referenceImages`, `description`, `weight`) from the DB by `characterId` — only if
that id is in the request's `characterRefs` allow-list. The brain emits a thin
`{ type: 'character', characterId }`; the server fills the snapshot. Reuses the entire existing
patch/persist/stream pipeline; the node lands on canvas like any other generated node and survives
reload via `canvas_state`.

**Side effect:** bump `last_used_at` on referenced characters (fire-and-forget).

---

## Section 6 — Lifecycle & edge cases

- **Character edited after use.** Node configs are snapshots → editing the character does *not*
  retroactively change existing canvas nodes (correct, predictable). `characterId` enables a future
  opt-in refresh.
- **Character deleted (soft).** Row stays resolvable; saved workflows + `@`-history still render.
  Disappears from picker and grid. Hard-purge via the existing nightly `cleanup-sessions` cron,
  extended to purge soft-deleted characters referenced by **zero** `sessions.canvas_state` graphs.
- **`@` of a since-deleted character in old chat history.** The chip renders from persisted message
  metadata (name + thumbnail snapshot stored on the message), so history stays intact.
- **Model doesn't support reference images.** Handler skips the image edge but **still injects the
  description into the prompt**; node stays on canvas as documentation of intent.
- **Multiple characters in one message.** Each becomes its own `character` node; brain wires all into
  the generator's image input if it accepts an image array, else picks the primary and notes the
  others in the prompt. Capped at `MAX_CHARACTER_REFS`.
- **Auto-describe failure / no `GEMINI_API_KEY`.** `✨` degrades gracefully; description stays
  manually editable; save still works.
- **Thumbnail generation failure.** Falls back to the primary `reference_images[0].url`; never blocks
  creation.
- **Partial image-upload failure.** Save proceeds with what uploaded; modal shows a non-blocking
  "N images failed" notice.
- **RLS / ownership.** Every read/write is `user_id = auth.uid()`; brain hydration double-checks the
  id is in the request allow-list — one user can never reference another's character by guessing an
  id.

---

## Section 7 — Scope boundary

**Deferred to v1.1+ (schema/architecture already accommodates):**
- **LoRA training (Tier 3)** — columns exist; no training pipeline / async UX / creation credit cost
  yet. Later "Improve this character" upgrade.
- **`Styles` / `Props` asset tabs** — ship as disabled "Coming soon"; only `Characters` live.
- **"Save as character" from a generated output** — manual modal only in v1.
- **`description_out` text handle** on the node; **"character changed — update node?"** refresh.
- **Per-model reference-weight tuning** — value is stored/forwarded only.

**Not planned (YAGNI):**
- Sharing characters between users / marketplace.
- Character categories, tags, folders.
- Character versioning / history.
- `@` mentions inside node property fields (chat-only in v1).
- Video-specific character handling — reference images feed video models the same as image models.

---

## Files touched (anticipated)

**New:**
- `supabase/migrations/<ts>_characters.sql` — table, indexes, RLS, storage bucket
- `lib/nodes/plugins/character/{definition,component,executor.server,index}.ts`
- `app/assets/page.tsx` (+ `characters` tab) and `app/assets/layout` if needed
- `components/assets/CharacterCard.tsx`, `CharacterGrid.tsx`, `CharacterModal.tsx`
- `components/chat/CharacterMentionPicker.tsx`
- `app/api/characters/route.ts`, `app/api/characters/[id]/route.ts`
- `lib/hooks/use-characters.ts`
- `lib/utils/character-refs.ts` (mirror of `selection-refs.ts`)
- `app/api/characters/auto-describe/route.ts` (Gemini Vision)

**Edited:**
- `lib/nodes/core/{shared,client,server}-registry.ts` — register `character`
- `lib/workflow/handlers.ts` — add `character` to `EPHEMERAL_HANDLERS`
- `components/layout/Sidebar.tsx` — Assets nav item
- `components/chat/ChatInput.tsx` — `@` trigger + chip row reuse
- `components/chat/ChatInterface.tsx` — `mentionedCharacterIds` state + POST
- `app/api/chat/stream/route.ts` — `characterRefs` validation + resolution
- `lib/chat/*` (`runBrain`, system prompt, `tools/handlers.ts`) — character context + hydration
- `lib/api/client.ts` — `charactersApi`
- `app/api/cron/cleanup-sessions/route.ts` — purge orphaned soft-deleted characters
