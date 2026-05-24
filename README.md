# Prism AI 🎨✨

**Chat-first, node-based AI image & media workflow editor for designers.**

Describe an outcome in plain language, and Prism turns it into a node graph: **Claude** reads your request and emits a workflow patch, you review it on a visual canvas, and a server-side engine runs each node — sending generative steps to **Replicate** and image transforms to a local **Sharp** pipeline. Runs are metered against a credit balance backed by **Paddle** billing.

## Features

- **Chat → workflow.** Claude (Anthropic) builds and edits your node graph through tool calls, patch by patch, so your manual edits survive between turns.
- **Visual node canvas.** React Flow canvas with a Konva-based compositor for multi-layer composition.
- **Generative + transforms.** AI generation via Replicate (dynamic, DB-driven models) plus ephemeral transforms (blur, levels, compositor).
- **Characters.** Reusable character references (images + description + weight) you can drop into a graph or `@`-mention in chat.
- **Live execution.** Webhook-driven DAG engine with real-time status pushed to the canvas over Supabase Realtime — no polling.
- **Result caching.** Identical node work is deduplicated by an input hash, cutting generation cost on iterative edits.
- **Credits & billing.** Per-node credit cost, Paddle subscriptions (Free / Starter / Pro / Studio), and an append-only credit ledger.

## Tech stack

- **Framework:** Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS
- **Canvas:** React Flow + Konva (compositor)
- **Chat brain:** `@anthropic-ai/sdk` — Claude Haiku 4.5 (free) / Sonnet 4.6 (paid), Node.js runtime
- **Generative AI:** Replicate (async predictions + webhooks)
- **Image transforms:** Sharp
- **Data/Auth/Storage/Realtime:** Supabase (Postgres)
- **Billing:** Paddle
- **Hosting:** Vercel (incl. cron jobs)

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system map and [PLAN.md](PLAN.md) for the execution-engine design rationale.

## Prerequisites

- **Node.js** 18+
- A **Supabase** project (Postgres + Auth + Storage + Realtime)
- An **Anthropic API key** (chat brain)
- A **Replicate API token** (generative nodes)
- Optional: **Gemini API key** (session titles + image fallbacks), **Paddle** credentials (billing), **Resend** (admin alert emails)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Set up the database

The migrations in [`supabase/migrations/`](supabase/migrations/) are the source of truth for the schema (the `supabase_*.sql` snapshots at the repo root are stale). Apply them to your Supabase project in order. You'll also need the storage buckets `chat-assets` (permanent) and `workflow-ephemeral-tmp` (transient).

### 3. Configure environment variables

Create `.env.local` with:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Chat brain
ANTHROPIC_API_KEY=your-anthropic-key

# Generative AI
REPLICATE_API_TOKEN=your-replicate-token
REPLICATE_WEBHOOK_SIGNING_SECRET=your-webhook-secret

# App URL (used as the Replicate webhook base — must be publicly reachable)
NEXT_PUBLIC_APP_URL=https://your-app-url

# Cron auth
CRON_SECRET=your-cron-secret

# Optional: Gemini (session titles, image fallbacks)
GEMINI_API_KEY=your-gemini-key

# Optional: billing (Paddle) and admin alerts (Resend)
# RESEND_API_KEY=...
# ADMIN_ALERT_EMAIL=...
# ADMIN_ALERT_FROM=alerts@prismai.local
```

> Generative models are configured as rows in the `ai_models` table (the `ai_generator` node reads its handles and controls from `ai_models.inputs_schema` at runtime), not in code. Seed at least one model to generate images.

### 4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Commands

```bash
npm run dev     # Next.js dev server (port 3000)
npm run build   # Production build
npm start       # Production server
npm run lint    # next lint
```

There is no automated test runner; the scripts in [`scripts/`](scripts/) are ad-hoc integration probes run by hand against a live Supabase + env.

## How it works

1. **You describe a goal in chat.** The message (plus the current workflow, any attached images, and `@`-mentioned characters) is sent to `/api/chat/stream`.
2. **Claude builds the graph.** `runBrain` ([lib/chat/](lib/chat/)) runs a tool-calling loop, emitting `add_node` / `update_node` / `remove_node` patches that are applied to your canvas — preserving edits you made between turns.
3. **You review and run.** Clicking Run posts the graph to `/api/executions/start`, which snapshots the subgraph, debits credits, and dispatches root nodes.
4. **The engine chains.** Generative nodes go to Replicate (async, webhook callback); ephemeral nodes run in-process via Sharp. As each node finishes, ready children are dispatched. Status streams back to the canvas over Supabase Realtime.

## Node types

| Type | What it does |
|---|---|
| `ai_generator` | Generative node; model + controls are defined by its `ai_models` row (supports multi-output fan-out). |
| `media_input` | User-uploaded image(s). |
| `character` | Reusable character reference (frozen snapshot). |
| `prompt` | Text output. |
| `blur` | Gaussian/box/stack blur (image or video). |
| `levels` | Tonal remap (black/white points + gamma). |
| `compositor` | Konva-based multi-layer compositor. |

## Notes & current limitations

- **No mid-run cancellation.** Once a run starts, credits are debited up front and generative work is submitted to Replicate as fire-and-forget async jobs; there is no central process to interrupt, so a run can't be stopped mid-flight.
- **No automatic retry.** A failed node fails the run; re-running is manual (via run modes).
- **No automated test suite.**

## License

MIT.
