# Automatic Character-Reference Framing

**Date:** 2026-06-11
**Status:** Approved, pending implementation

## Problem

A character is now a single photographic **character sheet** — one image often showing
the person across multiple angles, poses, and expressions (the "sheet page"). When that
sheet is wired into an AI node and the user types a request, by the time the image reaches
the model it is just an opaque URL in `image: [...]`; all "this is a character" context has
been dropped. The model reasonably interprets a sheet full of faces/poses as a scene
containing several different people, and applies the user's request to all of them.

Today the only workaround is to manually add wording like "use a single character" to every
prompt. The goal: connect the character node, type the request normally, and have the
pipeline handle it correctly on its own — even with multiple characters wired in.

## Decisions (from brainstorming)

- **Fully hidden.** The guidance is prepended behind the scenes; the user never sees or
  manages it.
- **No description injected.** The model has the image and can see the character better than
  any sentence; a description only spends tokens and risks contradicting the visual.
- **No names injected.** The user describes characters visually ("the redhead", "the one on
  the left") rather than by name, so names add nothing. (This supersedes the earlier
  "label by name" pick once the user confirmed they describe rather than name.)
- **Always on** whenever a character node is wired into the AI node — no toggle.
- **Framing goes before the user's request** (constraints-first reads better for
  instruction-following image models).
- **Templates live as a code constant** for now, not DB-configurable (YAGNI).

## Behavior

Connect one or more character nodes to an `ai_generator` node, type the request, generate.
The pipeline prepends a short framing instruction to the final prompt so the model treats
each sheet as one consistent person.

### Injected text (two variants)

**One character wired** — prepend:

> The reference image is a character sheet showing ONE single person across multiple angles,
> poses, and expressions. Treat it as a single consistent character and apply the request to
> that one person.

**Multiple characters wired** — prepend:

> The reference images are separate character sheets. Each sheet depicts ONE distinct person
> (shown across multiple angles/poses). These are different individuals — keep them distinct
> and apply the request to the people described below.

Then the user's request follows. No names, no descriptions in either variant.

## Mechanism

The single convergence point for the final prompt is the `ai_generator` executor
([lib/nodes/plugins/ai_generator/executor.server.ts](../../../lib/nodes/plugins/ai_generator/executor.server.ts)),
where the node's typed-in prompt control value and a wired prompt-node both collapse into one
string in `replicateInputs[promptKey]`. But character provenance is only known upstream in
the orchestrator
([lib/workflow/orchestrator.ts](../../../lib/workflow/orchestrator.ts) around line 369),
which already detects `nodeTypeById.get(edge.source) === 'character'` edges and even trims
multi-character contributions to their base image.

Plan:

1. **Compute the count upstream.** At the point where the orchestrator/dispatch assembles
   inputs for the `ai_generator` node, count the **distinct character nodes** whose edges feed
   the node's image input(s). Pass this `characterRefCount` into the executor via
   `ExecutionContext` (a new optional field), since the executor is where the final prompt is
   built but provenance has otherwise been lost by then.
2. **Inject in the executor.** Just before dispatch, if `characterRefCount >= 1` **and** the
   resolved model has a text/prompt input field, prepend the matching framing variant to the
   final prompt string via a single helper `buildCharacterFraming(count)` that holds both
   templates.

The existing multi-character trim-to-base behavior in the orchestrator is unchanged; this
feature only adds framing text.

## Scope & edge cases

- **Scope:** the `ai_generator` node only (the app's generative node). Chat-brain generation
  is a separate path and out of scope.
- **Model with no prompt field** → skip silently; there is nothing to inject into.
- **Empty user prompt** → the framing alone becomes the prompt (harmless).
- **Plain image input mixed with a character** → framing still describes "the character
  reference sheet(s)"; accepted as a known limitation, not handled specially.
- **Existing multi-character trim-to-base** stays as-is.

## Verification

No test runner in this repo. Verify with:

1. `npx tsc --noEmit` — type safety.
2. Manual E2E:
   - One character + "make them wave" → edits the single person, no group artifacts.
   - Two characters + "put the redhead in a suit" → only that one changes; identities stay
     distinct.
   - A non-character image node feeding the AI node → behavior unchanged (no framing added).
