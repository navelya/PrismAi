# Chat Brain Rework — Design

**Date:** 2026-05-07
**Status:** Draft, pending user review
**Sub-project:** A (Brain rework). First of a planned series; B (plan-and-approve), C (cost preview), D (file uploads), E (suggestion chips), F (advanced workflow control) are deferred to their own specs.
**Approach:** Approach 1 — refactor in place. Lift-and-shift to Anthropic Claude Sonnet 4.6, modularize the chat brain, fix real image vision, split the 1,436-line `ChatInterface.tsx`.

---

## Goal

Replace the current Gemini-based chat with an Anthropic Claude Sonnet 4.6 implementation that produces fluent, professional responses, exposes its reasoning when it's working hard, actually sees the user's attached images (today it does not), and is built on a modular foundation that future sub-projects can plug into without rewriting.

## Non-goals (deferred sub-projects, not for this spec)

- Plan-and-approve flow (B)
- Cost preview before run (C)
- File uploads beyond images (D)
- Clickable suggestion chips (E)
- Advanced workflow control: positioning, edge rewiring, grouping, conditional logic (F)
- Cross-session memory / preferences
- Diff preview of pending workflow patches
- Search over past chat sessions
- Provider abstraction layer (we commit to Anthropic only; second adapter, if ever needed, is extracted then)

## Scope summary

In scope:
- Switch chat provider from Google Gemini to Anthropic Claude Sonnet 4.6.
- Rewrite the system prompt as a parameterized module (`lib/chat/prompt/*`).
- Adopt a "concise senior collaborator" voice with concrete rules.
- Always-on extended thinking with a fixed 2.5k token budget; no classifier.
- Stream thinking deltas to the UI as a new event type; persist final thinking in `messages.metadata.thinking`.
- Fix image vision: pass attached images as Anthropic vision content blocks (today they are mentioned only as text).
- Refactor `app/api/chat/stream/route.ts` (~415 lines) down to a thin handler (~80 lines).
- Split `components/chat/ChatInterface.tsx` (~1,436 lines) into focused components (~350 lines each at most).
- Add a collapsible `ThinkingPanel` component.
- Introduce `usage` and `done` events to the NDJSON streaming protocol.
- Validate tool-call configs against `aiSchema` before applying patches.

DB schema changes: none. We use the existing `messages.metadata` JSONB column for thinking persistence.

---

## Section 1 — Architecture

Three layers, each replaceable without breaking the others.

```
┌──────────────────────────────────────────────────────────┐
│  UI Layer (components/chat/*)                            │
│  ChatInterface ─ MessageList ─ ChatInput                 │
│       │                  │                               │
│  ThinkingPanel    MessageRenderer    AttachmentGallery   │
└──────────────────────────────────────────────────────────┘
                           ▲
                           │  NDJSON stream over fetch
                           ▼
┌──────────────────────────────────────────────────────────┐
│  API Edge (app/api/chat/stream/route.ts)                 │
│  Thin wrapper: auth, body parse, persist, delegate to    │
│  brain, pipe NDJSON back. ~80 lines.                     │
└──────────────────────────────────────────────────────────┘
                           ▲
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│  Brain (lib/chat/*)                                      │
│  prompt ──────► build(workflow, registry) → system text  │
│  provider ────► Anthropic Sonnet 4.6 + tool schemas      │
│  tools ───────► add_node, update_node, remove_node       │
│  streaming ───► protocol types + NDJSON encoder          │
└──────────────────────────────────────────────────────────┘
```

Invariants:
- The route handler owns nothing but I/O. All decisions live in `lib/chat/*`.
- The brain is composed of pure functions where possible: given (messages, workflow, registry) it returns a stream of events.
- Existing tools (`add_node` / `update_node` / `remove_node`) and patch logic in `lib/workflow/workflow-patch.ts` are unchanged.
- DB schema is unchanged. `sessions.canvas_state`, `messages.images`, `messages.metadata` keep their roles. Thinking persists into `messages.metadata.thinking`.

Future-proofing:
- Plan-and-approve (B) plugs in as a new tool + a new event type — no rewiring.
- Cost preview (C) consumes the existing `usage` event we're adding now.
- File uploads (D) extend the attachment pipeline without touching the brain.

---

## Section 2 — Module structure

```
lib/chat/
├── index.ts                     NEW   barrel export, public API
├── brain.ts                     NEW   orchestrator: build prompt → stream
├── prompt/
│   ├── system.ts                NEW   master prompt builder
│   ├── voice.ts                 NEW   tone rules
│   ├── registry-context.ts      NEW   formats node + ai_models registry
│   ├── workflow-context.ts      NEW   summarizes current canvas_state
│   └── examples.ts              NEW   2 small few-shot examples
├── provider/
│   └── anthropic.ts             NEW   wraps Anthropic SDK + thinking config
├── tools/
│   ├── definitions.ts           NEW   add_node / update_node / remove_node schemas
│   └── handlers.ts              NEW   apply tool calls → patches; validate aiSchema
└── streaming/
    ├── protocol.ts              NEW   StreamEvent union type
    └── encoder.ts               NEW   NDJSON line writer + reader helpers

app/api/chat/stream/route.ts     EDIT  ~415 → ~80 lines, delegates to brain.ts

components/chat/
├── ChatInterface.tsx            EDIT  ~1,436 → ~350 lines (orchestrator only)
├── MessageList.tsx              NEW   extracted: scroll pinning, render loop
├── Message.tsx                  NEW   per-message wrapper
├── ChatInput.tsx                NEW   extracted: input, voice, send, drop zone
├── AttachmentGallery.tsx        NEW   extracted: image preview strip
├── ThinkingPanel.tsx            NEW   collapsible reasoning display
├── MessageActions.tsx           NEW   copy / edit / revert buttons
├── MessageRenderer.tsx          KEEP  no changes needed
└── hooks/
    ├── use-chat-messages.ts     EDIT  consume new 'thinking' / 'usage' / 'done' events
    ├── use-chat-realtime.ts     KEEP  unchanged
    └── use-file-upload.ts       KEEP  unchanged

lib/workflow/workflow-patch.ts   KEEP  unchanged
lib/billing/cost.ts              KEEP  out of scope here (sub-project C wires it in)
```

Sizing targets (discipline, not hard limits):
- No new file over 300 lines.
- `ChatInterface.tsx` after the split: ~350 lines.
- `route.ts` after the split: ~80 lines.
- `lib/chat/brain.ts`: ~150 lines.
- `prompt/system.ts`: ~250 lines including the prompt body as a tagged template.

Deliberate omissions:
- No `lib/chat/intent/` — classification dropped; see Section 5.
- No global `lib/chat/types.ts` — types live next to the module that owns them.
- No abstract `Provider` interface — `anthropic.ts` exports concrete functions.

Hooks colocation: chat hooks stay under `components/chat/hooks/` because they are UI-coupled.

Thinking persistence: stored in `messages.metadata.thinking` (existing JSONB column). No DB migration.

---

## Section 3 — Streaming protocol

Today's NDJSON shape: `{type:'text'|'tool'|'error', ...}`. We extend it cleanly without breaking existing consumers.

```ts
// lib/chat/streaming/protocol.ts

export type StreamEvent =
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; text: string }
  | { type: 'thinking_end' }
  | { type: 'text'; text: string }                    // existing, unchanged
  | { type: 'tool'; patch: WorkflowPatch }            // existing, unchanged
  | { type: 'usage'; inputTokens: number;
                     outputTokens: number;
                     thinkingTokens: number;
                     costUsd: number }                // NEW
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'done' }                                  // NEW: explicit terminator
```

Why an explicit `done`: today the client infers end-of-stream from the fetch reader closing. That works until a proxy buffers and we time out. An explicit terminator removes a class of bug.

Why a `usage` event now: sub-project C (cost preview) needs it. Adding it now is free; the UI ignores it until C ships. It sets the seam.

Order guarantee per turn:
```
[thinking_start]
[thinking_delta]*
[thinking_end]
[text]*
[tool]*       ← tool calls flush AFTER all text + thinking
[usage]
[done]
```

`text` and `tool` events can interleave in the upstream Anthropic stream. The brain serializes them: text deltas pass through immediately; tool calls accumulate and flush as a single merged patch at the end (same as today).

Error semantics:
- `recoverable: true` — token limit, transient API error → UI shows inline retry, conversation state preserved.
- `recoverable: false` — auth, malformed request, RLS reject → UI surfaces error toast, message marked `status: 'error'` in DB.
- Errors do not abort accumulated thinking/text — those are persisted up to the failure point.

Client-side reducer (`use-chat-messages.ts`): one `switch` on event type, ~40 lines, mutates the in-flight assistant message `{thinking, text, patch, usage, status}`.

---

## Section 4 — Image vision flow

Current bug: the route accepts `attachedImages` as data-URIs but only mentions them in the system prompt as `"USER ATTACHED IMAGES: the user attached N image(s)..."` — the LLM never sees pixels. We replace this with real Anthropic vision content blocks.

Lifecycle:
```
User drops images in ChatInput
        ↓
use-file-upload converts to WebP (existing)
        ↓
Stored in chat-local state as { id, dataUrl, mediaType, sizeBytes }
        ↓
On send: included in request body as base64 image data
        ↓
brain.ts attaches them as content blocks on the user message
        ↓
Anthropic Sonnet 4.6 sees pixels
```

Anthropic message shape:
```ts
{
  role: 'user',
  content: [
    { type: 'image',
      source: { type: 'base64', media_type: 'image/webp', data: '...' } },
    { type: 'image',
      source: { type: 'base64', media_type: 'image/webp', data: '...' } },
    { type: 'text', text: 'put this person on a beach' }
  ]
}
```

Active-attachment policy:
- Images stay **active until the user removes them** from the gallery (matches Claude.ai / ChatGPT mental model).
- Hard cap: **4 active**. Adding a 5th evicts the oldest with a UI toast: "Removed photo 1 — chat keeps the 4 most recent images active."
- No regex-based "is this image referenced?" heuristic. Simpler is more predictable.
- Persistence: data-URIs continue to be saved in `messages.images` per existing schema.

Out of scope (deferred to D): PDFs, CSVs, docs, Supabase Storage migration, OCR.

---

## Section 5 — No intent classifier

Earlier drafts of this design proposed a regex-based intent classifier (`qa` / `modify` / `create` / `fix`) that gated thinking and tool exposure. We considered, then rejected, two replacements:

1. **Regex classifier** — fails on non-English input (Hebrew, Spanish, etc.), typos, and ambiguous phrasing. Asymmetric failure modes: misclassifying a workflow request as Q&A means the model has no tools and looks broken.
2. **Gemini Flash micro-classifier** — reintroduces the provider we are migrating off, adds a second SDK and failure mode, adds 200–400ms latency to every turn (including the trivial ones we want to feel snappy).

Final decision: **drop classification entirely.**

```ts
// lib/chat/brain.ts
const thinking = { type: 'enabled', budget_tokens: 2500 } as const;
// passed unconditionally to every Anthropic call
```

Rationale:
- Anthropic extended thinking budget is a *ceiling, not a floor*. For "hi" or "תודה" the model spends ~30 thinking tokens and returns. We pay for what's used, not the budget.
- Tools are always exposed; the system prompt instructs the model when to use them ("for pure questions, just answer; for changes, use the tools").
- Multilingual works because there's no language assumption. Typos work because there's no regex.
- One less moving part.

UX detail to avoid panel flicker on trivial messages:
- `ThinkingPanel` is hidden until thinking content exceeds **100 characters** OR thinking duration exceeds **500ms**.
- Trivial turns ("hi") never show the panel because they never cross the threshold.

When to revisit: if telemetry shows real wasted spend (currently estimated at ~$9/day at 1,000 turns/day, 30% trivial), add Haiku 4.5 classification as a one-function addition. Not Gemini Flash — keep the provider count at one.

---

## Section 6 — Prompt structure

Single system prompt with a fixed anatomy. No per-intent variants.

```
1. IDENTITY (~10 lines, static)
   - Who Prism is, what it does, what it doesn't do.
   - Voice rules (concise senior collaborator) — see voice.ts.

2. CAPABILITIES (~15 lines, static)
   - Can: build new workflows, modify existing ones, answer questions
     about the system, see attached images, reason about the canvas.
   - Cannot: run workflows (user clicks Run), see runtime outputs from past
     runs unless they are in the message history, access files outside
     of attachments.

3. CURRENT CANVAS (dynamic, from workflow-context.ts)
   - "The canvas currently has N nodes: [type] (id) wired [from] -> [to]."
   - Compact summary; ~20 lines max even for big graphs.
   - If empty: "The canvas is empty."

4. NODE REGISTRY (dynamic, from registry-context.ts)
   - For each node type: name, one-line purpose, inputs (type), outputs
     (type), critical config fields. ~60-80 lines for current registry.
   - For ai_generator: list available models (id, provider, brief
     capability) pulled live from ai_models table.

5. TOOL USAGE RULES (~15 lines, static)
   - Use tools whenever the user asks for a workflow change.
   - Don't use tools for pure questions or explanations.
   - Explain in 1-2 sentences before the tool call.
   - Topological order matters for add_node — list ancestors before
     descendants.
   - Don't restate every node added; the UI shows the diff.

6. RESPONSE FORMAT (~10 lines, static)
   - Plain prose. Markdown for emphasis only.
   - Cost or token mentions only if the user asked.
   - No headers; no bullet lists unless genuinely a list.
   - End with a single forward question.
   - Match length to the question; do not pad short answers.
```

Voice rules (`prompt/voice.ts`), concrete:
- Forbidden openers: "Great question!", "I'd be happy to", "Sure thing!", "Of course!".
- Forbidden closers: "Let me know if there's anything else."
- No restating the user's request.
- Open with the answer or the action.
- One sentence of reasoning when there's a tradeoff.
- End with a single forward question, not a list.

Few-shot examples (`prompt/examples.ts`) — two examples, included unconditionally (~150 tokens):
1. A "create" example showing voice + tool usage + ending question.
2. A "qa" example showing answering without tools + voice.

Workflow context format (compact, not raw JSON):
```
Canvas: 4 nodes
- text_input "prompt" (id: a1) → ai_generator
- media_input "person photo" (id: a2) → background_remover → compositor
- ai_generator "imagen-4" (id: b1) → compositor
- compositor (id: c1) → output
```

Token budget per turn (estimate):
| Section | Tokens |
|---------|--------|
| System prompt static parts | ~600 |
| Node registry | ~1,500 |
| Workflow context | ~50–500 |
| Examples | ~150 |
| Last 8 messages | ~2,000 (avg) |
| **Total input** | **~4,500–6,000** |
| Sonnet input cost | ~$0.014–$0.018 per turn |

Prompt caching: Anthropic's `cache_control` is added on the static portions (identity, capabilities, registry, tool rules, format, examples). Cache hits cost 10% of the input rate, so we expect ~$0.005/turn after warm-up.

Out of scope for this spec:
- Dynamic example selection / RAG over past prompts.
- Per-user voice tuning.

---

## Section 7 — UI components

Component tree after the split:
```
<ChatInterface>                    orchestrator, ~350 lines
  ├─ <MessageList>                 scroll pinning, render loop
  │   └─ <Message>                 per-message wrapper
  │       ├─ <ThinkingPanel>       collapsed by default, expandable
  │       ├─ <MessageRenderer>     existing — text/markdown/results
  │       └─ <MessageActions>      copy, edit, revert
  ├─ <AttachmentGallery>           image strip with X-to-remove
  └─ <ChatInput>                   textarea, send, voice, drop zone
```

Component contracts:

| Component | Owns | Receives | Emits |
|-----------|------|----------|-------|
| `ChatInterface` | session state, send pipeline, stream reducer | `sessionId`, `workflow` | mutates store |
| `MessageList` | scroll behavior, ResizeObserver | `messages[]`, `streamingMessage` | scroll events only |
| `Message` | per-message layout | `message`, `isStreaming` | none |
| `ThinkingPanel` | open/close state, line-by-line reveal | `thinking: string`, `isStreaming`, `durationMs`, `tokens` | none |
| `MessageRenderer` | unchanged from today | `content`, `images`, `toolResults` | none |
| `MessageActions` | unchanged behavior | `message` | copy/edit/revert callbacks |
| `AttachmentGallery` | hover/remove, eviction warning at 4 | `attachments`, `onRemove` | `onRemove(id)` |
| `ChatInput` | input state, voice toggle, drop zone | `disabled`, `onSend` | `onSend(text, attachments)` |

`ThinkingPanel` mock:

```
┌────────────────────────────────────────────────────┐
│ ▸ Thinking · 1.2s · 847 tokens          [expand]  │  ← collapsed
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│ ▾ Thinking · 1.2s · 847 tokens          [collapse]│
│                                                    │
│   The user wants a beach composite. I have their   │  ← expanded
│   photo from the attachment. Imagen 4 produces     │
│   strong photographic backgrounds; Flux is more    │
│   stylized. Going with Imagen.                     │
│                                                    │
│   For compositing I need background-removal first  │
│   so the subject blends. Order: input → bg-remove  │
│   ...                                              │
└────────────────────────────────────────────────────┘
```

- While streaming: panel auto-shows once thinking exceeds 100 chars or 500ms; expandable on click; thinking text streams live.
- After streaming: collapses by default. Header shows duration + token count. Click to re-expand.
- On history reload: same — collapsed by default, expandable. Reads from `metadata.thinking`.
- Visual treatment: muted color, italic, slight indent. Distinct from the actual reply.

State machine for an in-flight assistant message:
```
idle
  → thinking_start → thinking      (panel may appear if threshold crosses)
  → thinking_delta → thinking      (text streams into panel)
  → thinking_end   → answering     (panel collapses, body starts)
  → text           → answering     (body streams in)
  → tool           → answering     (tool patches accumulate)
  → usage          → answering     (cached, used by future cost UI)
  → done           → complete      (panel + body persisted)
  → error          → error         (state preserved up to error)
```

The reducer in `use-chat-messages.ts` is one `switch` on event type, ~40 lines.

Eviction toast at the 4-image cap:
- "Removed photo 1 — chat keeps the 4 most recent images active."
- Evicted image fades out of the gallery (200ms).
- Reversible by re-attaching.

Locally-modified `ChatInterface.tsx`: the file currently has unstaged changes. Before the split, commit the existing local edits as their own small commit on the rework branch (so they're preserved in history); the split commit then refactors that committed state into the new component tree. No `git stash` — explicit commits make the diff reviewable and recoverable.

Out of scope (deferred):
- Suggestion chips below the input → E.
- Plan-approval card UI → B.
- Cost panel above Run → C.
- Diff preview of pending workflow changes → future.

---

## Section 8 — Error handling, observability, migration

### Error handling

| Error | Recoverable | UI treatment |
|-------|-------------|--------------|
| Anthropic 429 (rate limit) | yes | Inline "rate limited, retrying in Xs" with countdown; auto-retry once with backoff |
| Anthropic 5xx | yes | Inline "AI service hiccup, retry?" button |
| Anthropic auth/4xx | no | Toast "Configuration issue — contact support"; surfaced in server logs |
| Tool call validation fail (bad node config) | yes | `handlers.ts` catches; brain replies "I tried to add X but the config was invalid because Y; let me retry" — model self-corrects on next turn |
| Webhook/Supabase timeout during persist | no | Message marked `status: 'error'` in DB; user sees "Saved partially — refresh to confirm"; thinking + text already streamed are preserved client-side |
| Stream cut mid-response (network) | yes | Message marked `status: 'partial'`; "Connection dropped, continue?" button re-sends from last delta |

Tool-call validation against `aiSchema` is new behavior. Today the route applies tool calls without validation. We validate before applying so a bad config feeds back into the conversation rather than corrupting the canvas.

### Observability

Per-turn structured log from `lib/chat/brain.ts`:
```
[chat] turn { sessionId, inputTokens, outputTokens,
              thinkingTokens, latencyMs, toolCalls, status, errorKind? }
```
- Lands in the existing log pipeline (Vercel logs).
- No new vendor (no Sentry, Datadog) added in this spec.
- Future enhancement: ship to a Supabase analytics table — out of scope.

### Migration / rollout

Refactor in place per the user's earlier choice. Plan:

1. Branch off `main`.
2. Build the brain modules (`lib/chat/*`) in parallel to existing route — no behavior change yet.
3. Wire `route.ts` to use the new brain behind `process.env.CHAT_USE_NEW_BRAIN === 'true'`. Old Gemini path stays as fallback.
4. Add `ANTHROPIC_API_KEY` to `.env.local` and document in `CLAUDE.md`.
5. Manual smoke test with the env var on (no test runner per `CLAUDE.md`).
6. Split `ChatInterface.tsx` in a separate commit so the diff is reviewable.
7. Flip the env var on, observe for a session.
8. Remove the Gemini fallback in a follow-up commit once stable.

### Manual test checklist

(There is no test runner in this repo per `CLAUDE.md`. Ad-hoc integration scripts in `scripts/` may be added if useful, but the primary gate is manual.)

- Cold session, "make a workflow that puts a person on a beach" with image → workflow appears, thinking visible after threshold, run works.
- Existing session, "change the model to Flux" → `update_node` fires, no rebuild.
- "What does this node do?" → no tool calls, thinking budget unused, fast reply.
- 5 image upload → oldest evicted, toast shown.
- Network blip mid-stream → recoverable, retry works, partial content preserved.
- Refresh page → thinking persists in `metadata.thinking`, panel expands history correctly.
- Multilingual: send a Hebrew or Spanish message → response in same language, thinking budget respected.
- Bad tool call (model emits invalid config) → brain catches, model self-corrects on next turn, canvas not corrupted.

---

## Open questions / risks

- **Token budget on big workflows**: at ~6,000 input tokens per turn for large graphs, prompt caching is critical. If cache hit rate is poor in practice, we may need to compress the registry context further.
- **Image vision cost at the 4-image cap**: ~6,000 extra tokens per turn when full. Acceptable for now; monitor in telemetry.
- **Voice consistency**: hard rules in `voice.ts` are a starting point. Expect to tune with real traffic. The few-shot examples are the most powerful lever.
- **Stash/re-apply local edits in `ChatInterface.tsx`**: requires care during the split commit.

## What success looks like

- Provider switched to Anthropic Sonnet 4.6; Gemini SDK removed from chat path after rollout.
- `app/api/chat/stream/route.ts` is ~80 lines; `lib/chat/*` holds the rest.
- `components/chat/ChatInterface.tsx` is ~350 lines; rest is in extracted components.
- Attached images are actually visible to the model in conversation.
- Thinking shows up for non-trivial turns and is persisted across reloads.
- Voice is consistently "concise senior collaborator" — no "Great question!" patterns in the response sample.
- Manual test checklist passes.

## Next step

After user review of this spec, invoke the `superpowers:writing-plans` skill to convert it into an implementation plan.
