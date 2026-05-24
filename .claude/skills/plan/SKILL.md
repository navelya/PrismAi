---
name: plan
description: Use when the user wants a structured implementation plan before writing any code — new features, significant changes, refactors, or bugs that need investigation first. Triggers on "plan X", "how would we implement X", "what's the approach for X", "design X", "I want to build/add X" (when not already covered by create-ephemeral-node or update-ephemeral-node), "think through X", "what would it take to X", or the slash command /plan. Does NOT execute — produces a structured, approvable plan only. Invoke this before making any change that touches more than 2-3 files, the workflow engine, the orchestrator, or the three-way registry split.
---

# Plan

You are producing an implementation plan for a change in PrismAi. **This skill does not write any code.** The output is a structured plan the user reads, refines if needed, and then approves before any execution begins.

## Hard rules (do not skip)

1. **Always read [ARCHITECTURE.md](../../ARCHITECTURE.md) before producing a plan.** No exceptions — every plan needs the full system picture.
2. **Read [PLAN.md](../../PLAN.md) if the change touches the workflow engine, orchestrator, execution pipeline, or dispatch logic.** It holds the design rationale for why things work the way they do. Changing those systems without reading it produces plans that fight the architecture.
3. **Cross-check every plan against the "Things that bite" section in CLAUDE.md** before finalizing. If any of these apply, call them out explicitly in the plan:
   - Supabase service-role client being used in a user-facing handler
   - Orchestrator readiness check scoped by `session_id` instead of `execution_id`
   - `runFromNodeId` or `runMode` being persisted to storage
   - Server registry imported from a client component (or vice versa)
   - `ai_generator` handle schema being hard-coded instead of DB-driven
   - Workflow generation using full rewrites instead of patch ops
4. **No code during this skill.** If the user says "just do it", acknowledge, then say you'll write the plan first so they can catch anything before work starts.
5. **Be selective about what you read.** Read the files the change will actually touch. Don't dump the whole codebase into context.
6. **End every plan with an explicit approval prompt.** The user must say "go" (or similar) before any execution starts.

## Domain map — what to read for what

Use this to decide which files to read in Phase 1:

| Domain | Read these |
|--------|-----------|
| Node types, canvas, handles | `lib/nodes/core/`, `lib/nodes/plugins/<relevant>/` |
| Workflow execution / orchestrator | `lib/workflow/orchestrator.ts`, `lib/workflow/`, then PLAN.md |
| Chat brain / AI reasoning / patch ops | `app/api/chat/`, `lib/workflow/workflow-patch.ts` |
| Three-way registry | `lib/nodes/core/shared-registry.ts`, `lib/nodes/core/client-registry.ts`, `lib/nodes/core/server-registry.ts` |
| Auth / billing / user accounts | `app/api/`, `lib/supabase/` |
| UI / layout / pages | `app/`, `components/` |
| Storage / uploads / ephemeral assets | `lib/nodes/plugins/utils/ephemeral.ts`, relevant API routes |
| Background jobs / webhooks / cron | `app/api/webhooks/`, `app/api/cron/` |
| AI models / generative pipeline | `ai_generator` plugin, `ai_models` table references |

## The three phases

### Phase 1 — Understand

1. **Map the domain.** From the user's request, identify which row(s) of the domain map apply. Read the listed files for each matching row.

2. **Check for "things that bite."** If any apply, note them — they'll appear as warnings in the plan.

3. **Ask at most one clarifying question** if the request is ambiguous on something that would materially change the plan. Good candidates:
   - *Scope*: new feature vs. modification vs. refactor?
   - *Backward compatibility*: must saved workflows still load? Must existing API contracts hold?
   - *Priority*: if two approaches exist, which matters more — minimal footprint, performance, or future flexibility?

   If none of these are ambiguous, state your assumptions and move straight to Phase 2. Don't ask for the sake of asking.

### Phase 2 — Plan

Produce a single plan message with exactly these sections. Keep each section tight — this is a plan, not a spec.

---

#### Summary
One paragraph: what this change does, why it's needed, and what the expected outcome is.

#### Affected files
| File | Action | Why |
|------|--------|-----|
| `path/to/file.ts` | Create / Modify / Delete | One-line reason |

List every file that will change. If uncertain about a file, mark it `(Possible)`.

#### Implementation sequence
Numbered steps. Each step = one coherent unit of work. Aim for 4–10 steps — not too granular, not too vague.

If a step touches a "things that bite" risk, add a ⚠️ inline with the specific hazard and the guard to apply.

#### Architectural decisions
Any place where two or more reasonable approaches exist: list the options, their trade-offs, and which you recommend and why. If everything is straightforward, write "None — one clear path."

#### Assumptions
Things you assumed because the request didn't specify. User should correct these before saying "go."

#### Out of scope
What this plan deliberately does NOT do. Prevents scope creep during execution.

---

End every plan with:

> **Ready to execute — say "go" to proceed, or push back on anything above.**

### Phase 3 — Iterate (if needed)

If the user pushes back, revise only the section(s) that changed. Don't re-paste the whole plan — just the updated section with a brief note on what changed and why.

Once the user says "go" (or "approved", "looks good", "proceed", etc.):
1. Summarize in **one sentence** what you're about to do.
2. Exit the skill and begin execution in the main conversation.

## When to push back

- **Request is too vague to map to files.** Ask for more context before Phase 2. Example: "add AI stuff" — ask what capability, not how to implement it.
- **Change requires an architectural shift** the current design doesn't support. Don't paper over it. Flag it clearly in the plan's architectural-decisions section and propose what would need to change first.
- **"Things that bite" violation is central to the proposed approach.** If the user's idea as described would require, say, using `session_id` in the orchestrator readiness check, flag it and propose the correct scoping instead of just noting it as a risk.
- **This is actually a node creation/update task.** If the user wants to create or modify an ephemeral node plugin, redirect to `/create-ephemeral-node` or `/update-ephemeral-node` — those skills have deeper node-specific context.

## Slash command invocation

User typed `/plan` (optionally with `<description>`).
- With description → jump straight to Phase 1 using that description as context.
- Without description → ask: "What do you want to build or change? Short description is fine — I'll read the right parts of the codebase and ask if I need anything else."
