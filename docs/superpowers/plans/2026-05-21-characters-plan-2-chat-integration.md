# Characters Feature — Plan 2: Chat Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users reference characters from chat via `@`, and have the chat brain materialize them as `character` nodes wired into reference-aware generators — with character config hydrated server-side from the DB by id (the LLM never sees URLs).

**Architecture:** The `@` token in `ChatInput` opens a `CharacterMentionPicker`; selecting a character adds a removable chip (mirroring the attached-images pattern). On send, `mentionedCharacterIds` rides in the `/api/chat/stream` body next to `nodeRefs`. The route resolves those ids to snapshots (service client, scoped to the session owner), threads them into `runBrain` → `ToolHandlerState` (mirroring `aiModelHandles`), and the system prompt instructs the brain to emit thin `{ type: 'character', characterId }` nodes. `runAddNode` hydrates each character node's config from the snapshot map.

**Tech Stack:** Next.js, Anthropic SDK (chat brain), Zustand, React, Tailwind, Supabase service client.

**Verification note:** No test runner (per CLAUDE.md). Verify with `npx tsc --noEmit` + manual browser testing on `npm run dev`.

**Prerequisite:** Plan 1 (`2026-05-21-characters-plan-1-foundation.md`) must be complete — this plan depends on the `characters` table, the `character` node plugin + registries, `charactersApi`, and `useCharacters`.

**Reference spec:** `docs/superpowers/specs/2026-05-21-characters-feature-design.md` (§4 `@` picker, §5 brain integration).

---

## File Structure

**New files:**
- `lib/utils/character-refs.ts` — `CharacterRef` / `CharacterSnapshot` types + `MAX_CHARACTER_REFS` + sanitizer
- `components/chat/CharacterMentionPicker.tsx` — floating `@` picker

**Modified files:**
- `lib/chat/tools/handlers.ts` — `characterRefs` on `ToolHandlerState`; hydrate `character` nodes in `runAddNode`
- `lib/chat/brain.ts` — `characterRefs` on `BrainInput`; build snapshot map; pass to state + system prompt
- `lib/chat/prompt/system.ts` — `characterRefs` on `BuildSystemInput`; `formatCharacterMentionsBlock`
- `app/api/chat/stream/route.ts` — parse `mentionedCharacterIds`, resolve snapshots, pass to `runBrain`, bump `last_used_at`
- `components/chat/ChatInput.tsx` — `@` detection + picker + mention chip row
- `components/chat/ChatInterface.tsx` — lift `mentionedCharacters` state, render chips, pass to `handleSend`
- `lib/hooks/use-chat-messages.ts` — `handleSend` accepts + forwards `mentionedCharacterIds`

---

## Task 1: `character-refs` util (shared types + sanitizer)

**Files:**
- Create: `lib/utils/character-refs.ts`

- [ ] **Step 1: Write the util**

Mirror `lib/utils/selection-refs.ts`. `CharacterSnapshot` is what the server resolves and threads to the tool layer; `CharacterRef` is the lightweight client→server id payload.

```ts
/** What the client sends: just the ids the user @-mentioned this turn. */
export interface CharacterRef {
  id: string;
}

/** Server-resolved snapshot used to hydrate character node configs.
 *  Built from the DB (never fabricated by the LLM). */
export interface CharacterSnapshot {
  characterId: string;
  name: string;
  description: string | null;
  referenceImages: string[]; // URLs, 1-5; index 0 = primary
  weight: number;
}

/** Hard cap on @-mentions per message — guards the prompt + node count. */
export const MAX_CHARACTER_REFS = 8;

/** Sanitize a raw client payload into a capped list of unique id strings. */
export function sanitizeMentionedCharacterIds(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const id = typeof item === 'string' ? item : typeof item?.id === 'string' ? item.id : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id.slice(0, 128));
    if (out.length >= MAX_CHARACTER_REFS) break;
  }
  return out;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/utils/character-refs.ts
git commit -m "feat(characters): add character-refs shared types + sanitizer"
```

---

## Task 2: Tool layer — hydrate character nodes from snapshots

**Files:**
- Modify: `lib/chat/tools/handlers.ts`

- [ ] **Step 1: Add `characterRefs` to `ToolHandlerState`**

In `lib/chat/tools/handlers.ts`, add the import at the top:
```ts
import type { CharacterSnapshot } from '@/lib/utils/character-refs';
```
Extend the `ToolHandlerState` interface (after the `aiModelHandles` field):
```ts
  /**
   * Snapshots for characters the user @-mentioned this turn, keyed by
   * character id. Used to hydrate `character` node configs server-side so
   * the LLM only has to emit { type: 'character', characterId } — it never
   * sees or fabricates reference image URLs. Acts as an allow-list: a
   * character node whose id is absent here is rejected.
   */
  characterRefs?: Map<string, CharacterSnapshot>;
```

- [ ] **Step 2: Hydrate character nodes inside `runAddNode`**

In `runAddNode`, insert a hydration pass **after** the ELK layout block (after the `if (hasNodes) { ... }` that rewrites positions) and **before** the `validateNodeConfigAgainstRegistry` loop. This fills in the snapshot fields and rejects unknown ids:

```ts
  // Hydrate `character` nodes from server-resolved snapshots. The LLM emits a
  // thin { type: 'character', data: { config: { characterId } } }; we fill in
  // name/referenceImages/description/weight from the allow-list so URLs never
  // round-trip through the model. An id not in the map is rejected.
  for (const node of (args.nodes || [])) {
    if (node?.type !== 'character') continue;
    const characterId = node?.data?.config?.characterId;
    if (typeof characterId !== 'string' || characterId.length === 0) {
      return { success: false, error: 'character node requires data.config.characterId.' };
    }
    const snap = state.characterRefs?.get(characterId);
    if (!snap) {
      return { success: false, error: `character node references unknown or unmentioned characterId "${characterId}". Only characters the user @-mentioned this turn can be used.` };
    }
    node.data = node.data || {};
    node.data.config = {
      characterId: snap.characterId,
      name: snap.name,
      referenceImages: snap.referenceImages,
      description: snap.description ?? '',
      weight: snap.weight,
    };
    if (!node.data.label) node.data.label = snap.name;
  }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (The `character` node's aiSchema requires only `characterId`, so `validateNodeConfigAgainstRegistry` passes once hydration runs first.)

- [ ] **Step 4: Commit**

```bash
git add lib/chat/tools/handlers.ts
git commit -m "feat(characters): hydrate character node configs from snapshots in runAddNode"
```

---

## Task 3: System prompt — character mentions block

**Files:**
- Modify: `lib/chat/prompt/system.ts`

- [ ] **Step 1: Extend `BuildSystemInput`**

In `lib/chat/prompt/system.ts`, add to the `BuildSystemInput` interface (after `nodeRefs`):
```ts
  characterRefs?: import('@/lib/utils/character-refs').CharacterSnapshot[];
```

- [ ] **Step 2: Add the formatter**

Add this function after `formatSelectionFocusBlock`:

```ts
function formatCharacterMentionsBlock(
  refs: import('@/lib/utils/character-refs').CharacterSnapshot[] | undefined,
): string {
  if (!refs || refs.length === 0) return '';
  const list = refs
    .map((c) => `- ${c.name} (characterId: ${c.characterId})${c.description ? ` — ${c.description}` : ''}`)
    .join('\n');
  return `USER-MENTIONED CHARACTERS (the user typed @ to reference these this turn):
${list}

A "character" is a reusable subject the user wants to appear consistently. When the
request involves generating an image/video with one of these characters:
- Add a node of type "character" for each referenced character. Its ONLY config field
  is { "characterId": "<the id above>" } — do NOT invent name, images, or description;
  the server fills those in from the id.
- Wire the character node's "character_out" output into the target generator's image /
  reference input handle (use the model's image-type input handle id).
- Weave the character's description text into the generator's prompt so the textual
  identity is reinforced alongside the reference image.
- If the chosen model has no image/reference input, still add the character node and put
  the description into the prompt; skip the image edge.
- Multiple mentioned characters → one character node each; wire all into the generator
  when it accepts multiple image inputs, otherwise use the first and mention the others
  in the prompt.
Only use characterIds from the list above. Never use a character the user did not mention.`;
}
```

- [ ] **Step 3: Append the block in `buildSystemPrompt`**

In `buildSystemPrompt`, after the `selectionBlock` push, add:
```ts
  const characterBlock = formatCharacterMentionsBlock(input.characterRefs);
  if (characterBlock) blocks.push({ type: 'text', text: characterBlock });
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/chat/prompt/system.ts
git commit -m "feat(characters): add character-mentions block to system prompt"
```

---

## Task 4: Brain — thread `characterRefs` through

**Files:**
- Modify: `lib/chat/brain.ts`

- [ ] **Step 1: Extend `BrainInput`**

In `lib/chat/brain.ts`, add to the `BrainInput` interface (after `nodeRefs`):
```ts
  /** Characters the user @-mentioned this turn, resolved server-side from the
   *  DB. Threaded to the tool layer for node hydration and to the system
   *  prompt for wiring instructions. */
  characterRefs?: import('@/lib/utils/character-refs').CharacterSnapshot[];
```

- [ ] **Step 2: Build the snapshot map and put it on state**

In `runBrain`, after the `state` is constructed (`const state: ToolHandlerState = { ... }`), add:
```ts
  const characterRefMap = new Map<string, import('@/lib/utils/character-refs').CharacterSnapshot>();
  for (const c of input.characterRefs ?? []) {
    if (c && typeof c.characterId === 'string') characterRefMap.set(c.characterId, c);
  }
  state.characterRefs = characterRefMap;
```

- [ ] **Step 3: Pass refs to the system prompt**

In the `buildSystemPrompt({ ... })` call, add the field:
```ts
    characterRefs: input.characterRefs ?? [],
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/chat/brain.ts
git commit -m "feat(characters): thread characterRefs through runBrain to state + prompt"
```

---

## Task 5: Chat stream route — resolve mentions + bump recency

**Files:**
- Modify: `app/api/chat/stream/route.ts`

- [ ] **Step 1: Import the sanitizer + types**

At the top of `app/api/chat/stream/route.ts`, add:
```ts
import { sanitizeMentionedCharacterIds, type CharacterSnapshot } from '@/lib/utils/character-refs';
```

- [ ] **Step 2: Resolve mentioned characters in `handleWithNewBrain`**

In `handleWithNewBrain`, after `nodeRefs` is parsed from `body` (around the existing `nodeRefs` block) add the id parse, then resolve them after `supabase = createServiceClient()` is available and `sessionId` is known. Place this resolution block just before the `runBrain` call (inside the `waitUntil` is fine, but resolving before the stream starts is simplest — put it right after the `images`/`attachedImageUrls` block):

```ts
  // Resolve @-mentioned characters to server-side snapshots. We scope by the
  // session's owner so a user can only reference their own characters. The
  // LLM only ever sees names/descriptions/ids — never the storage URLs.
  const mentionedCharacterIds = sanitizeMentionedCharacterIds(body?.mentionedCharacterIds);
  let characterRefs: CharacterSnapshot[] = [];
  if (mentionedCharacterIds.length > 0 && sessionId) {
    const { data: sessionOwner } = await supabase
      .from('sessions')
      .select('user_id')
      .eq('id', sessionId)
      .single();
    if (sessionOwner?.user_id) {
      const { data: rows } = await supabase
        .from('characters')
        .select('id, name, description, reference_images, weight')
        .eq('user_id', sessionOwner.user_id)
        .is('deleted_at', null)
        .in('id', mentionedCharacterIds);
      characterRefs = (rows ?? []).map((r: any) => ({
        characterId: r.id,
        name: r.name,
        description: r.description ?? null,
        referenceImages: Array.isArray(r.reference_images)
          ? r.reference_images.map((img: any) => (typeof img === 'string' ? img : img?.url)).filter((u: any): u is string => typeof u === 'string')
          : [],
        weight: typeof r.weight === 'number' ? r.weight : 70,
      }));

      // Bump recency so the @ picker's "top 5" stays meaningful. Fire-and-forget.
      const ids = characterRefs.map((c) => c.characterId);
      if (ids.length > 0) {
        waitUntil(
          supabase.from('characters').update({ last_used_at: new Date().toISOString() }).in('id', ids).then(() => {})
        );
      }
    }
  }
```

> Note: `sessionId` and `supabase` are already in scope at this point in `handleWithNewBrain` (the function creates `supabase = createServiceClient()` near the top and reads `sessionId` from `body`). `waitUntil` is already imported.

- [ ] **Step 3: Pass `characterRefs` into `runBrain`**

In the `runBrain({ ... })` call inside the `ReadableStream` `start`, add the field next to `nodeRefs`:
```ts
          characterRefs,
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verify (server path, before UI exists)**

With `npm run dev` and a character created (Plan 1), POST directly from the browser console while logged in, using a real character id and session id:
```js
await fetch('/api/chat/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'generate a portrait of this character' }],
    sessionId: '<a real session id>',
    mentionedCharacterIds: ['<a real character id>'],
    selectedModel: 'sonnet',
  }),
}).then(r => r.text()).then(console.log)
```
Expected: a streamed NDJSON response; if the brain decides to build, a `tool` event with an `add_node` patch containing a `character` node whose config has `name`/`referenceImages` filled in (hydrated server-side). Also confirm the character's `last_used_at` updated in Supabase.

- [ ] **Step 6: Commit**

```bash
git add app/api/chat/stream/route.ts
git commit -m "feat(characters): resolve @-mentioned characters and pass to brain"
```

---

## Task 6: `CharacterMentionPicker` component

**Files:**
- Create: `components/chat/CharacterMentionPicker.tsx`

- [ ] **Step 1: Write the picker**

A floating panel rendered above the input. Top 5 by recency when the query is empty; substring-filtered as the user types. Keyboard nav (↑/↓/Enter/Tab/Esc) is handled by the parent (`ChatInput`) and passed via `activeIndex`; the picker is presentational + click selection.

```tsx
'use client';

import React from 'react';
import { UserCircle, Plus } from 'lucide-react';
import type { Character } from '@/lib/api/client';

interface CharacterMentionPickerProps {
    characters: Character[];
    query: string;
    activeIndex: number;
    onSelect: (c: Character) => void;
    onCreateNew: () => void;
}

const TOP_N = 5;

export function filterCharacters(characters: Character[], query: string): Character[] {
    const q = query.trim().toLowerCase();
    if (!q) return characters.slice(0, TOP_N); // already recency-ordered from the API
    return characters.filter((c) => c.name.toLowerCase().includes(q));
}

export default function CharacterMentionPicker({
    characters,
    query,
    activeIndex,
    onSelect,
    onCreateNew,
}: CharacterMentionPickerProps) {
    const results = filterCharacters(characters, query);

    return (
        <div className="absolute bottom-full left-0 mb-2 w-72 max-h-72 overflow-y-auto rounded-xl border border-stroke-subtle bg-surface-primary shadow-2xl z-50 p-1">
            {results.length === 0 ? (
                <div className="px-3 py-3 text-sm text-content-tertiary">
                    No characters match "{query}"
                </div>
            ) : (
                results.map((c, i) => (
                    <button
                        key={c.id}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); onSelect(c); }}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${
                            i === activeIndex ? 'bg-accent-primary/10' : 'hover:bg-interactive-hover'
                        }`}
                    >
                        <span className="w-8 h-8 rounded-md overflow-hidden bg-surface-tertiary flex-shrink-0 flex items-center justify-center">
                            {c.thumbnail_url || c.reference_images?.[0]?.url ? (
                                <img src={c.thumbnail_url || c.reference_images[0].url} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <UserCircle className="w-5 h-5 text-content-tertiary" />
                            )}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-content-primary truncate">{c.name}</span>
                            {c.description && (
                                <span className="block text-xs text-content-tertiary truncate">{c.description}</span>
                            )}
                        </span>
                    </button>
                ))
            )}
            <div className="h-px bg-stroke-subtle my-1" />
            <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onCreateNew(); }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-sm text-accent-primary hover:bg-interactive-hover"
            >
                <Plus className="w-4 h-4" /> Create new character
            </button>
        </div>
    );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/chat/CharacterMentionPicker.tsx
git commit -m "feat(characters): add @ mention picker component"
```

---

## Task 7: `ChatInput` — `@` detection, picker, mention chips

**Files:**
- Modify: `components/chat/ChatInput.tsx`

- [ ] **Step 1: Add props + imports**

In `components/chat/ChatInput.tsx`, import the picker, the filter helper, the hook, and the `Character` type at the top:
```tsx
import { useCharacters } from '@/lib/hooks/use-characters';
import CharacterMentionPicker, { filterCharacters } from './CharacterMentionPicker';
import type { Character } from '@/lib/api/client';
```
Add to `ChatInputProps` (after `hasMessages`):
```ts
    mentionedCharacters: Character[];
    onMentionCharacter: (c: Character) => void;
    onRemoveMentionedCharacter: (id: string) => void;
    onOpenCharacterCreate?: () => void;
```
Add the new props to the destructured params list (with a default for the optional one):
```ts
            mentionedCharacters,
            onMentionCharacter,
            onRemoveMentionedCharacter,
            onOpenCharacterCreate,
```

- [ ] **Step 2: Add mention-detection state + handlers**

Inside the component body (near the other `useState` hooks), add:
```tsx
        const { characters } = useCharacters();
        const [mentionQuery, setMentionQuery] = useState<string | null>(null); // null = picker closed
        const [mentionActiveIndex, setMentionActiveIndex] = useState(0);

        // Detect a trailing "@token" immediately before the caret. Returns the
        // query (text after @) or null if the caret isn't in a mention.
        const detectMention = useCallback((text: string, caret: number): string | null => {
            const upto = text.slice(0, caret);
            const at = upto.lastIndexOf('@');
            if (at === -1) return null;
            // @ must be at start or preceded by whitespace
            if (at > 0 && !/\s/.test(upto[at - 1])) return null;
            const frag = upto.slice(at + 1);
            if (/\s/.test(frag)) return null; // space ends a mention
            return frag;
        }, []);

        const handleTextChange = (next: string) => {
            onChange(next);
            const el = textareaRef.current;
            const caret = el ? el.selectionStart ?? next.length : next.length;
            const q = detectMention(next, caret);
            setMentionQuery(q);
            setMentionActiveIndex(0);
        };

        const insertCharacterMention = useCallback((c: Character) => {
            const el = textareaRef.current;
            const caret = el ? el.selectionStart ?? value.length : value.length;
            const upto = value.slice(0, caret);
            const at = upto.lastIndexOf('@');
            if (at !== -1) {
                // Strip the "@query" fragment from the textarea; the chip carries it.
                const next = value.slice(0, at) + value.slice(caret);
                onChange(next);
            }
            onMentionCharacter(c);
            setMentionQuery(null);
        }, [value, onChange, onMentionCharacter, textareaRef]);
```

- [ ] **Step 3: Wire the textarea**

Replace the textarea's `onChange` handler:
```tsx
                        onChange={(e) => handleTextChange(e.target.value)}
```
Replace the textarea's `onKeyDown` handler to give the picker first dibs on the navigation keys:
```tsx
                        onKeyDown={(e) => {
                            if (mentionQuery !== null) {
                                const results = filterCharacters(characters, mentionQuery);
                                if (e.key === 'ArrowDown') { e.preventDefault(); setMentionActiveIndex((i) => Math.min(i + 1, Math.max(0, results.length - 1))); return; }
                                if (e.key === 'ArrowUp') { e.preventDefault(); setMentionActiveIndex((i) => Math.max(i - 1, 0)); return; }
                                if ((e.key === 'Enter' || e.key === 'Tab') && results[mentionActiveIndex]) { e.preventDefault(); insertCharacterMention(results[mentionActiveIndex]); return; }
                                if (e.key === 'Escape') { e.preventDefault(); setMentionQuery(null); return; }
                            }
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                onSend();
                            }
                        }}
```

- [ ] **Step 4: Render the picker + mention chips**

Just inside the outer `<div className="relative flex flex-col ...">` (the input container), before the `attachedImages` block, render the picker when open:
```tsx
                    {mentionQuery !== null && (
                        <CharacterMentionPicker
                            characters={characters}
                            query={mentionQuery}
                            activeIndex={mentionActiveIndex}
                            onSelect={insertCharacterMention}
                            onCreateNew={() => { setMentionQuery(null); onOpenCharacterCreate?.(); }}
                        />
                    )}
```
And render the mention chips. Reuse the existing attached-images chip row styling — add this block right after the `attachedImages.length > 0` block:
```tsx
                    {mentionedCharacters.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 px-3 pt-3">
                            {mentionedCharacters.map((c) => (
                                <span key={c.id} className="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full bg-accent-primary/10 border border-accent-primary/20 text-xs text-content-primary">
                                    <span className="w-4 h-4 rounded-full overflow-hidden bg-surface-tertiary flex items-center justify-center">
                                        {c.thumbnail_url || c.reference_images?.[0]?.url
                                            ? <img src={c.thumbnail_url || c.reference_images[0].url} alt="" className="w-full h-full object-cover" />
                                            : null}
                                    </span>
                                    {c.name}
                                    <button type="button" onClick={() => onRemoveMentionedCharacter(c.id)} className="text-content-tertiary hover:text-accent-error">
                                        <X className="w-3 h-3" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
```
(`X` is already imported in `ChatInput.tsx`.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. Note: `textareaRef` is already defined in the component (`const textareaRef = (ref as ...) ?? internalTextareaRef`); the new callbacks use it.

- [ ] **Step 6: Commit**

```bash
git add components/chat/ChatInput.tsx
git commit -m "feat(characters): @ detection, picker, and mention chips in ChatInput"
```

---

## Task 8: `ChatInterface` — lift mention state, pass to send

**Files:**
- Modify: `components/chat/ChatInterface.tsx`

- [ ] **Step 1: Add mention state**

In `components/chat/ChatInterface.tsx`, near where `attachedImages` is managed, add:
```tsx
    const [mentionedCharacters, setMentionedCharacters] = useState<import('@/lib/api/client').Character[]>([]);
    const addMentionedCharacter = (c: import('@/lib/api/client').Character) =>
        setMentionedCharacters((prev) => (prev.some((p) => p.id === c.id) ? prev : [...prev, c]));
    const removeMentionedCharacter = (id: string) =>
        setMentionedCharacters((prev) => prev.filter((p) => p.id !== id));
```
(If `useState` isn't already imported, add it to the `react` import.)

- [ ] **Step 2: Pass mention props to `ChatInput`**

Update the `<ChatInput ... />` usage (currently around line 466) to add:
```tsx
                    mentionedCharacters={mentionedCharacters}
                    onMentionCharacter={addMentionedCharacter}
                    onRemoveMentionedCharacter={removeMentionedCharacter}
```

- [ ] **Step 3: Forward mention ids on send, then clear**

Find the `sendMessage(...)` call (around line 138). Pass the mentioned ids as a new trailing argument, and clear the chips after dispatch:
```tsx
        const mentionedIds = mentionedCharacters.map((c) => c.id);
        sendMessage(
            input.trim(),
            attachedBlobsRef.current,
            attachedImages,
            clearAttachments,
            setInput,
            undefined, // clarificationAnswerOverride
            undefined, // planAnswerOverride
            mentionedIds,
        );
        setMentionedCharacters([]);
```
> If the existing `sendMessage` call already passes clarification/plan overrides, keep those values instead of `undefined` — only the new trailing `mentionedIds` argument is added.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only about `handleSend`/`sendMessage` arity until Task 9 updates the hook signature. If so, proceed to Task 9 then re-run. (If you prefer a clean typecheck per task, do Task 9 Step 1 before this step's typecheck.)

- [ ] **Step 5: Commit**

```bash
git add components/chat/ChatInterface.tsx
git commit -m "feat(characters): lift mention state and forward ids on send"
```

---

## Task 9: `use-chat-messages` — accept + forward `mentionedCharacterIds`

**Files:**
- Modify: `lib/hooks/use-chat-messages.ts`

- [ ] **Step 1: Add the parameter to `handleSend`**

In `lib/hooks/use-chat-messages.ts`, add a trailing parameter to the `handleSend` signature (after `planAnswerOverride`):
```ts
        mentionedCharacterIds?: string[],
```

- [ ] **Step 2: Include it in the fetch body**

In the `fetch('/api/chat/stream', { ... body: JSON.stringify({ ... }) })` call, add the field next to `nodeRefs` (around line 322):
```ts
                    mentionedCharacterIds: mentionedCharacterIds && mentionedCharacterIds.length > 0 ? mentionedCharacterIds : undefined,
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (the `ChatInterface` call from Task 8 now matches the signature).

- [ ] **Step 4: Commit**

```bash
git add lib/hooks/use-chat-messages.ts
git commit -m "feat(characters): forward mentionedCharacterIds to chat stream API"
```

---

## Task 10: End-to-end chat integration verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Manual golden path**

`npm run dev`, with at least one character ("Alice") created (Plan 1):
1. In chat, type `@` → picker appears showing up to 5 recent characters + "Create new character".
2. Type `@al` → list filters to Alice. Press `Enter` (or click) → the `@al` text is stripped and an "Alice" chip appears above the input.
3. Type "generate a studio portrait of her" and send.
4. The chip clears on send. The brain builds a workflow containing a `character` node (purple, UserCircle, Alice's thumbnail) wired into the generator's image input.
5. Inspect the canvas node's config (via the editor/devtools) → `name: "Alice"`, `referenceImages` populated (hydrated server-side), `description` present.
6. In Supabase, confirm Alice's `last_used_at` advanced.

- [ ] **Step 3: Edge cases**

1. `@` then `Escape` → picker closes, no chip.
2. Mention a character, then delete the chip with its `✕` → not sent.
3. Mention two characters in one message → two `character` nodes appear (or one wired + others in prompt, depending on the model's image inputs).
4. New user with no characters: `@` shows only "Create new character" → clicking it opens the creation modal (requires `onOpenCharacterCreate` wired; if not wired in this surface, the option is a no-op — acceptable for v1).

- [ ] **Step 4: Security check**

Attempt to reference another user's character id directly via the console POST from Task 5 Step 5 using a *different* user's character id. Expected: the route's owner-scoped query returns no snapshot, so `runAddNode` rejects the character node with "unknown or unmentioned characterId" — no cross-user leak.

- [ ] **Step 5: Final commit (if stragglers)**

```bash
git status
# commit anything outstanding
```

---

## Self-review checklist (completed by plan author)

- **Spec coverage:** §4 `@` picker → Tasks 6–9. §5 brain integration (transport mirror of `nodeRefs`, server resolution, prompt instructions, hydrate-not-fabricate, `last_used_at` bump) → Tasks 1–5. §6 edge cases: unknown/cross-user id rejection (Task 2 + Task 10 Step 4), model without image input (Task 3 prompt rule), multiple mentions (Task 3 prompt rule), `@`-escape/remove (Task 7).
- **Placeholder scan:** every code step contains full code; no TODO/TBD.
- **Type consistency:** `CharacterSnapshot` (Task 1) used identically in Tasks 2/3/4/5; `Character` (from Plan 1's `lib/api/client.ts`) used in Tasks 6/7/8; `handleSend` gains exactly one trailing param (Task 9) matching the call site (Task 8); the hydrated node config keys (`characterId/name/referenceImages/description/weight`, Task 2) match `CharacterConfig` from Plan 1 Task 2.
- **Cross-plan dependency:** explicitly requires Plan 1 artifacts (table, node, registries, `charactersApi`, `useCharacters`); stated in the header.
- **Known v1 compromise:** the empty-state "Create new character" in the picker is wired via optional `onOpenCharacterCreate`; if the chat surface doesn't pass it, the option no-ops (Task 10 Step 3 case 4). Acceptable for v1 since `/assets` is the primary creation surface.
```
