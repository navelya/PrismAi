# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full picture: top-level folders, external services, the persistent vs. ephemeral node split, the v2 execution engine, and how a chat message becomes a finished image. [PLAN.md](PLAN.md) has the original long-form design rationale for the workflow engine — read it before changing dispatch/orchestrator code.

## Commands

```bash
npm run dev       # Next.js dev server (port 3000)
npm run build     # Production build
npm start         # Production server
npm run lint      # next lint
```

There is no test runner. Ad-hoc integration scripts in [scripts/](scripts/) are run directly with `node scripts/<file>.js` against a live Supabase + env — they are not a test suite.

A separate Python background-removal service runs on port 8000 (see [STARTUP.md](STARTUP.md), [DEPLOYMENT.md](DEPLOYMENT.md)) — its `python-backend/` directory ships separately to Hugging Face Spaces and is not in this repo.

Required env (in `.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` (chat brain), `GEMINI_API_KEY` (used by session-title generation and other Gemini features), `REPLICATE_API_TOKEN`, `REPLICATE_WEBHOOK_SIGNING_SECRET`, `NEXT_PUBLIC_APP_URL` (used as the Replicate webhook base URL — must be publicly reachable), `ELEVENLABS_API_KEY` (direct ElevenLabs API — speech/audio provider adapter), `CRON_SECRET`, `RESEND_API_KEY` (admin alert emails for billing exceptions), `ADMIN_ALERT_EMAIL` (destination for billing alerts), `ADMIN_ALERT_FROM` (optional, defaults to `alerts@prismai.local`). Billing (Paddle): `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_ENVIRONMENT`, `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, `NEXT_PUBLIC_PADDLE_ENVIRONMENT`.

## UI components — reuse first

- **Reuse a shared primitive before building anything new.** Before writing UI, check [components/ui/](components/ui/) for a primitive that fits and use it.
- **All popups go through the shared Modal.** For **any** overlay/popup — modal, dialog, confirmation, info/message, wizard — use [components/ui/Modal.tsx](components/ui/Modal.tsx) (or `ConfirmationModal` for confirms). **Never** hand-roll a Radix Dialog shell or a `createPortal` + overlay + `motion.div` popup; that is exactly how the app drifted into ~15 divergent popup styles (backdrops `black/60…/80`, radii `2xl/3xl`, a `z-50…z-[9999]` ladder). `Modal` owns the house glass style, the spring animation, the close button, and the `level` z-scale (`base`/`elevated`/`top`). Centered modals only — right-side drawers (`UserDetailDrawer`) and bottom sheets (`MobileActionSheet`) are a separate not-yet-built `Modal` variant; match the existing one until then.
- **Shared vs. one-off.** If a piece of UI will be reused across the app, build it as a shared component in `components/ui/` rather than inline, and extend an existing primitive rather than duplicating its styling. A bespoke one-off component is a last resort, for genuinely single-use UI.

## Things that bite

- **Service-role Supabase client** ([lib/supabase/service.ts](lib/supabase/service.ts)) bypasses RLS. Use ONLY in webhooks / cron / background workers. Never in user-facing handlers.
- **Orchestrator readiness check is scoped by `execution_id`, not `session_id`** (see comment in [lib/workflow/orchestrator.ts](lib/workflow/orchestrator.ts)). Using `session_id` would dispatch nodes with stale results from prior runs.
- **`runFromNodeId` and `runMode` MUST NOT survive a page refresh** — they are trigger signals; if rehydrated they re-fire executions on load. The persistence config in [lib/store/app-store.ts](lib/store/app-store.ts) explicitly excludes them.
- **Three-way registry split** in [lib/nodes/core/](lib/nodes/core/) — shared/client/server. Don't import the server registry from a client component (pulls `sharp` into the browser bundle) or vice versa.
- **`ai_generator` is dynamic** — its handles come from the `ai_models.inputs_schema` JSONB column at runtime, not from TypeScript. Adding a new generative model is usually a DB row, not a code change.
- **Workflow generation is patch-based** ([lib/workflow/workflow-patch.ts](lib/workflow/workflow-patch.ts)) — the LLM emits ops, not full rewrites, so user edits between turns survive.
- **The chat brain is Claude, not Gemini.** [lib/chat/](lib/chat/) runs an Anthropic Claude agentic tool loop (`nodejs` runtime, not edge — the SDK imports `node:fs`). Gemini is only used for session titles and a couple of image-gen routes. The system prompt's stable block is cached for 1h — keep registry/rules in the stable block, per-turn workflow/selection in the dynamic block, or you nuke the cache.
- **Generative runs cost credits, debited before dispatch.** `/api/executions/start` runs a cost pre-flight + debit; failures must refund via the `refund_tokens` RPC ([lib/workflow/orchestrator.ts](lib/workflow/orchestrator.ts)). Don't add a generative dispatch path that skips the debit/refund accounting, or balances drift.
- **`character` nodes embed a frozen snapshot**, not a live reference — editing the source character does not change a saved workflow. The chat brain is shown only name/description; image URLs are hydrated server-side so the LLM can't fabricate them.
- **External provider adapters** ([lib/ai/providers/](lib/ai/providers/)) — a model whose `providers.adapter_key` is set runs through a code adapter (e.g. ElevenLabs, synchronous) instead of Replicate. The adapter uploads result bytes via [lib/workflow/media-mirror.ts](lib/workflow/media-mirror.ts) and returns a hosted `{ url }`; the dispatcher completes it through the same sync-success path as Replicate's local run. Replicate models (no `adapter_key`) are unchanged. Voices for the speech picker live in the `voices` table — seed with `node scripts/sync-elevenlabs-voices.js`. **No webhook needed** — sync adapters return bytes in-request. **But** because such a node goes `running→completed` entirely inside the `/api/executions/start` request, its `completed` realtime event can be missed (node hangs on "loading" until refresh). The run trigger reconciles from the DB right after the start response via `reconcileExecutionFromDb` ([lib/hooks/use-execution-channel.ts](lib/hooks/use-execution-channel.ts)) — keep that call when adding new sync adapters (music, audio FX, …).
- **Path alias** `@/*` → repo root.
