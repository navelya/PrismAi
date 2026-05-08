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

Required env (in `.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` (chat brain), `GEMINI_API_KEY` (used by session-title generation and other Gemini features), `REPLICATE_API_TOKEN`, `REPLICATE_WEBHOOK_SIGNING_SECRET`, `NEXT_PUBLIC_APP_URL` (used as the Replicate webhook base URL — must be publicly reachable), `CRON_SECRET`.

## Things that bite

- **Service-role Supabase client** ([lib/supabase/service.ts](lib/supabase/service.ts)) bypasses RLS. Use ONLY in webhooks / cron / background workers. Never in user-facing handlers.
- **Orchestrator readiness check is scoped by `execution_id`, not `session_id`** (see comment in [lib/workflow/orchestrator.ts](lib/workflow/orchestrator.ts)). Using `session_id` would dispatch nodes with stale results from prior runs.
- **`runFromNodeId` and `runMode` MUST NOT survive a page refresh** — they are trigger signals; if rehydrated they re-fire executions on load. The persistence config in [lib/store/app-store.ts](lib/store/app-store.ts) explicitly excludes them.
- **Three-way registry split** in [lib/nodes/core/](lib/nodes/core/) — shared/client/server. Don't import the server registry from a client component (pulls `sharp` into the browser bundle) or vice versa.
- **`ai_generator` is dynamic** — its handles come from the `ai_models.inputs_schema` JSONB column at runtime, not from TypeScript. Adding a new generative model is usually a DB row, not a code change.
- **Workflow generation is patch-based** ([lib/workflow/workflow-patch.ts](lib/workflow/workflow-patch.ts)) — the LLM emits ops, not full rewrites, so user edits between turns survive.
- **Path alias** `@/*` → repo root.
