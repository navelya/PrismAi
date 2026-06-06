# Chat Composer — Hover Menus + Preferences Panel

**Date:** 2026-06-06
**Status:** Approved design, pending implementation plan

## Summary

Three changes to the chat composer (`components/chat/ChatInput.tsx` and friends):

1. The `+` (attachment) menu opens on **hover**, its trigger is **resized** to match the
   other action buttons, and its popover rows are re-skinned to match the shared
   `Select` option style.
2. A new **Preferences** button (also hover-open) opens a panel where the user picks a
   preferred image model, video model, aspect ratio, video duration, resolution, output
   count, and visual style. Every setting defaults to **Auto**.
3. Each non-Auto selection appears as a removable **chip** under the textarea and above
   the action buttons. The chosen preferences are sent to the chat brain as a dynamic
   system block; Auto settings are omitted entirely, so the brain behaves exactly as it
   does today for those.

The whole interaction matches the app's existing "custom selection input" — the shared
`Select` popover (`components/ui/Select.tsx`): `bg-surface-primary/80 backdrop-blur-3xl
border border-white/10 rounded-2xl shadow-2xl ring-1 ring-white/5`, 16px option icons,
title + subtitle, accent highlight on the active choice.

## Motivation

The composer's `+` menu requires a click and its trigger is slightly larger than the
mic/send buttons, and its rows don't match the rest of the app's dropdowns. Users also
have no fast way to express standing preferences ("always 16:9", "use Kling for video")
— today that intent has to be retyped into every message. A persistent, fast-to-set
preferences panel makes those defaults stick and quietly informs the brain.

## Components

### 1. Plus menu — `components/chat/ChatPlusMenu.tsx`

- **Hover-open:** open on `mouseenter` of the root, close on `mouseleave` after a
  ~150ms grace timer (cleared if the cursor re-enters), so moving from the trigger into
  the popover does not dismiss it. Click continues to toggle (touch + a11y). Existing
  outside-click + Escape close logic is preserved.
- **Size parity:** the `Plus` icon changes `w-5 h-5` → `w-4 h-4`. Padding (`p-2`) already
  matches the mic/send buttons.
- **Select-styled rows:** the popover container already mirrors the `Select` popover. The
  inner "Attach files" and "Auto-run" rows are re-skinned to match `RadixSelect.Item`
  (16px `OptionIcon`, title, subtitle/meta, `data-[highlighted]`-equivalent
  `hover:bg-white/5`). The Auto-run row keeps its `Switch` + Configure link.

### 2. Preferences button + panel — new `components/chat/ChatPreferencesMenu.tsx`

- A new icon button (`SlidersHorizontal` from lucide-react) sits immediately right of the
  `+` button in the left action group. Same chrome as the other action buttons
  (`p-2 rounded-lg ... w-4 h-4`), same hover-open behavior as the Plus menu (shared
  hover-popover behavior — factor the grace-timer logic into a small hook
  `lib/hooks/use-hover-popover.ts` so both menus stay consistent).
- The panel is a `Select`-styled popover anchored above the trigger (absolute, inside a
  `relative` root — same anchoring rationale as `ChatPlusMenu`: an ancestor's
  backdrop-blur must not hijack a fixed child's containing block). Width `w-[20rem]`,
  `max-h-[60vh]`, internal vertical scroll, scrollbar hidden.
- **Layout — all-visible chip rows.** Each setting is a section: a tiny uppercase label
  (matching the `SelectionPillRow` "Editing" label: `text-[10px] font-semibold uppercase
  tracking-wider text-content-tertiary`) above a `flex flex-wrap gap-1.5` row of
  selectable chips. Chips:
  - Selected: `bg-accent-primary/15 border border-accent-primary/40 text-content-primary`
  - Unselected: `bg-white/5 border border-white/10 text-content-secondary hover:bg-white/10`
  - "Auto" is the default-selected chip in every section. Single-select per section
    (selecting a value replaces the prior; selecting "Auto" clears the preference).
  - Model chips render the provider logo (when present) as a leading 14px icon, label =
    `display_name`.

**Sections and options:**

| Setting          | Store key       | Options |
|------------------|-----------------|---------|
| Image model      | `imageModelId`  | Auto + every active model whose primary output handle `type === 'image'` |
| Video model      | `videoModelId`  | Auto + every active model whose primary output handle `type === 'video'` |
| Aspect ratio     | `aspectRatio`   | Auto / 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 21:9 |
| Video duration   | `videoDuration` | Auto / 5s / 10s / 15s |
| Resolution       | `quality`       | Auto / 480p / 720p / 1080p |
| Outputs          | `outputs`       | Auto / 1 / 2 / 4 |
| Visual style     | `style`         | Auto / Photorealistic / Cinematic / Illustration / Anime / 3D |

Model classification is data-driven: read `model.outputs_schema?.handles?.[0]?.type`
from the store's `models` list (`useAppStore(s => s.models)`). Models with no
recognizable image/video output are excluded from both lists. The model and video model
sections may be long; they scroll with the rest of the panel (acceptable per the
requirement that "scrolling inside is ok" as long as everything is reachable without
switching views).

### 3. Selected-preference chips row — within `ChatInput.tsx`

A new row rendered inside the composer card, beneath the textarea and above the action
row (adjacent to the existing mention/selection pill rows). It renders **only non-Auto**
preferences as removable pills, styled like the existing mentioned-character pills
(`inline-flex items-center gap-1.5 ... rounded-full bg-accent-primary/10 border
border-accent-primary/20 text-xs`). Each pill shows the human label (model → its
`display_name`; aspect/duration/quality/outputs/style → the value, e.g. `16:9`,
`1080p`, `2 outputs`, `Cinematic`) and a trailing `X` button that resets that key to
Auto. When all settings are Auto, the row renders nothing (returns null).

To keep this isolated from the composer's hot path (the same concern that produced
`SelectionPillRow`), the chip row is its own self-subscribing leaf component
(`ChatPreferenceChips`) that reads `chatPreferences` + `models` from the store, so a
preference change re-renders only the row, not the conversation.

## Data flow

### State + persistence

- New store field on the UI slice:
  ```ts
  type PrefValue = string | 'auto';
  interface ChatPreferences {
    imageModelId: string;   // model id as string, or 'auto'
    videoModelId: string;
    aspectRatio: string;    // '16:9' | ... | 'auto'
    videoDuration: string;  // '5s' | '10s' | '15s' | 'auto'
    quality: string;        // '480p' | '720p' | '1080p' | 'auto'
    outputs: string;        // '1' | '2' | '4' | 'auto'
    style: string;          // 'Photorealistic' | ... | 'auto'
  }
  ```
  Default: every key `'auto'`. Setter `setChatPreference(key, value)` (a single value is
  replaced; passing `'auto'` clears it). Lives in `lib/store/slices/ui-slice.ts` +
  `lib/store/types.ts`.
- **Persist across sessions**, mirroring `autoRunEnabled`:
  - Hydrate from `profile.preferences.chatPreferences` in
    `components/theme/ThemeProvider.tsx` `syncProfile()` (merge over defaults so a
    missing/partial object is safe).
  - On every change, `void persistPrefs({ chatPreferences: nextPrefs })`
    (`lib/user/preferences.ts` already merges over existing prefs).
  - Add `chatPreferences` to the persisted localStorage slice in
    `lib/store/app-store.ts` for an instant warm rehydrate before the profile round-trip
    lands (stale-while-revalidate; the profile is the source of truth).

### Sending to the AI

- `handleSend` (`ChatInterface.tsx`) → `sendMessage` (`lib/hooks/use-chat-messages.ts`)
  reads `chatPreferences` from the store at send time and includes a `preferences`
  object in the `/api/chat/stream` POST body. Only **non-Auto** keys are included; model
  keys are resolved to `{ id, display_name }` from the store's `models` list so the
  server need not re-look-them-up. Auto keys are omitted.
- `app/api/chat/stream/route.ts` parses + validates `body.preferences` (defensive: drop
  unknown keys, coerce to strings, cap lengths) into a typed `ChatPreferencesPayload`
  and threads it into `buildSystemPrompt` via `commonInput`.
- `lib/chat/prompt/system.ts` gains `formatPreferencesBlock(prefs)` and appends its
  output as a **dynamic** (uncached) `SystemBlock`, after the character block. This keeps
  the 1h-cached stable block untouched (per CLAUDE.md: per-turn context goes in the
  dynamic block).

### Preference → brain semantics

The block frames preferences by strength:

- **Strong directives** (model, aspect ratio, video duration, resolution): "The user has
  set these as standing preferences. Apply them unless the user's current message
  explicitly asks for something different." For a preferred model: "When you add an
  image/video `ai_generator`, prefer `model_id <N>` (<display_name>)." For aspect ratio /
  duration / resolution: "Set the chosen model's matching config key
  (`aspect_ratio` / duration / resolution) when that model exposes one."
- **Soft hints** (outputs, visual style): "Lean toward these when nothing in the user's
  request dictates otherwise" — outputs maps to the model's output-count config key when
  present; style biases prompt craft.

The block explicitly notes that any setting the user left on Auto is simply absent and
carries no preference.

## Error handling / edge cases

- A persisted `imageModelId`/`videoModelId` may reference a model that no longer exists
  (deactivated). The chip row and panel resolve labels from the live `models` list; an
  unresolved id is treated as Auto (chip hidden, not sent to the brain) rather than
  shown as a dangling id.
- Partial/legacy `profile.preferences.chatPreferences` (missing keys) is merged over the
  all-Auto default during hydration.
- The preferences payload is validated server-side; a malformed body degrades to "no
  preferences" rather than erroring the turn.
- Hover-open is pointer-driven; on touch devices the click toggle remains the primary
  path (mouseenter still fires but the grace-close on mouseleave is harmless).

## Out of scope

- Enforcing preferences as hard node config at apply time (they are brain hints only).
- Per-session preference overrides distinct from the persisted defaults.
- Surfacing preferences anywhere outside the chat composer (e.g. the account modal).

## Testing

No automated test runner in this repo. Verify with `npx tsc --noEmit` (lint/build are
unreliable here per project memory), then manual E2E:

1. Hover the `+` button → menu opens; move into it → stays; move away → closes after
   grace. Icon matches mic/send size. Rows match Select styling.
2. Hover Preferences → panel opens; pick a non-Auto value in each section → a chip
   appears under the textarea; `X` on a chip → resets to Auto and chip disappears.
3. Reload the page → preferences survive (localStorage warm, then profile confirms).
4. Send a message with a preferred video model + 16:9 + 10s set → confirm (via
   `[chat]` server logs / the produced workflow) the brain used that `model_id` and set
   the aspect/duration config keys; set all to Auto → behaves as before.
