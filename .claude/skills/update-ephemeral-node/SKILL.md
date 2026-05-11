---
name: update-ephemeral-node
description: Use when the user wants to modify an existing ephemeral node plugin in this PrismAi repo. Triggers on "update the X node", "add Y to the X node", "change the X node's Z", "make X support W", "the X node's UX needs to ...", "fix X's preview", or the slash command /update-ephemeral-node. The skill identifies the affected files across the plugin folder, the three registries, the aiSchema (which the chat brain reads), and downstream consumers, and applies the change surgically without breaking saved workflows. Server tech changes and live-preview adjustments are INFERRED from the description, not asked. ALWAYS does impact analysis before editing.
---

# Update Ephemeral Node

You are modifying an existing ephemeral-node plugin. Unlike creating a new one, your job here is **surgical** — change only what's needed, preserve everything that works, and never break workflows users have already saved.

## Hard rules (do not skip)

1. **Always read the current plugin state first.** Read `definition.ts`, `executor.server.ts`, `executor.client.ts`, `component.tsx`, and `index.ts` of the target plugin BEFORE proposing any change. You cannot do impact analysis from memory or assumption.
2. **Always do impact analysis before editing.** [references/change-types.md](references/change-types.md) maps each change type (add control, remove control, add handle, remove handle, change handle id, change output shape, rename, etc.) to the files and DB shapes it touches. Skip this and you'll break something silently.
3. **Default to ADDITIVE, not BREAKING.** New optional control with a safe default is fine. Removing a control breaks every saved workflow that uses the old shape. Adding `isMandatory: false` is fine. Changing an existing handle's id breaks every saved edge that references it. See [references/backwards-compat.md](references/backwards-compat.md).
4. **Refuse renames and removes unless the user provides a migration plan.** Node type slugs, handle ids, and control keys are referenced in stored workflow JSON (`sessions.canvas_state`, `executions.graph_json`) and stored layer config. Changing them silently turns user workflows into errors. Push back; ask for explicit confirmation + a migration story.
5. **Server tech and preview adjustments are INFERRED.** The user says "make blur work on video too." You figure out that means adding `'video'` to the input handle's `expectedType` array, switching from Sharp to ffmpeg-wasm-server for that branch, and updating the client preview from Canvas+CSS-filter to `<video>`+canvas. The user doesn't have to specify any of that.
6. **Preserve UI styling — modern minimal / glassmorphism.** Any new UI elements match the existing language. See [references/style-guide.md](../create-ephemeral-node/references/style-guide.md) (shared with the create skill).
7. **Reach for existing primitives first.** [references/ui-primitives.md](../create-ephemeral-node/references/ui-primitives.md) (shared) lists everything available. New components: in-plugin if one-off, shared library only if reusable.
8. **Verify with `npm run build` and a targeted smoke-test note.** Don't claim success without a clean build, and tell the user specifically what scenarios to test in the browser.

## The four phases

### Phase 1 — Understand the change

Ask these conversationally, ONE AT A TIME, skipping any obvious from the user's initial request.

1. **Which node?** If unambiguous from the description ("update blur to..."), skip. If ambiguous ("update the image transform"), list candidate plugins from `lib/nodes/plugins/` and ask.
2. **What change?** Get the user to articulate it in one sentence. Push back if vague. "Make it better" is not a change.
3. **Why?** Helps you understand intent so you make the right call when the description is ambiguous. E.g. "add a quality control" could mean output format quality (JPEG quality slider) or processing quality (resolution downsample) — knowing why disambiguates.
4. **Anything else?** Once you have the explicit change, ask if there are related tweaks the user wants bundled in (often yes — "while you're in there, also..."). Bundling related edits into one diff is fine; bundling unrelated ones isn't (keep commits focused).

### Phase 2 — Impact analysis + plan

After understanding the change, READ the target plugin's files. Then determine:

1. **Change classification.** Use [references/change-types.md](references/change-types.md) to map the change to a category:
   - **Additive — control:** add a new optional config field with a default. Low risk.
   - **Additive — handle:** add a new optional input/output handle. Low risk (default `isMandatory: false`).
   - **Modify — control semantics:** change what a control does (range, mapping, behavior). Medium risk — may produce different visual output for existing workflows.
   - **Modify — UX:** rearrange the canvas card, change icon, add a button. Low/no runtime risk; UI-only.
   - **Modify — server logic:** change how the transform works internally. Medium risk — visual output may differ for saved workflows.
   - **Modify — preview:** improve or fix `executor.client.ts`. Low risk; preview only.
   - **Breaking — remove control:** removes a `defaultConfig` key. Old workflows lose that knob. Requires either (a) treating the absence as a default in the executor (back-compat shim), or (b) explicit user approval to break old workflows.
   - **Breaking — remove handle:** removes a handle entry from `handles`. Old edges become orphaned. Refuse without a migration plan.
   - **Breaking — change handle id:** old edges reference the old id. Refuse without a migration plan.
   - **Breaking — rename type slug:** old workflows reference the type by string. Refuse without a migration plan.
   - **Cross-plugin — output shape:** changes what downstream consumers see. Requires checking compositor layers and any other node that consumes this output type.
2. **Files affected.** List the files you'll touch. For most changes:
   - `lib/nodes/plugins/<type>/definition.ts` (config interface, defaultConfig, aiSchema, handles)
   - `lib/nodes/plugins/<type>/executor.server.ts`
   - `lib/nodes/plugins/<type>/executor.client.ts`
   - `lib/nodes/plugins/<type>/component.tsx`
   - Sometimes: `lib/nodes/plugins/<type>/properties.tsx`, `shared.ts`, files in `ui/`
   - Rarely: a registry barrel (only when adding new exports — e.g. exporting a new type from the barrel)
3. **Backwards-compat plan.** For each change, state what happens to existing workflows that have the OLD config/edge shape. If the answer is "they break," either:
   - Implement a compat shim in the executor (treat the missing field as default).
   - Get explicit user approval to ship breaking changes.
   See [references/backwards-compat.md](references/backwards-compat.md).
4. **aiSchema update.** If the change affects what the chat brain sees, update `aiSchema` in `definition.ts`. State this explicitly — the brain re-introspects `sharedRegistry` on every chat request, so changes propagate immediately to natural-language node generation. Reference [.claude/skills/create-ephemeral-node/references/aischema-cookbook.md](../create-ephemeral-node/references/aischema-cookbook.md).
5. **New components.** If the change needs new UI, decide where they live (in-plugin `ui/` for one-off, `components/ui/` for reusable). See [.claude/skills/create-ephemeral-node/references/ui-primitives.md](../create-ephemeral-node/references/ui-primitives.md) for the existing inventory — reach there first.
6. **Inferred tech/preview choices.** If the change implies new server tech (e.g. supporting video where Sharp doesn't fit), state what you'll switch to and why. Reference [.claude/skills/create-ephemeral-node/references/server-tech-inference.md](../create-ephemeral-node/references/server-tech-inference.md) and [.claude/skills/create-ephemeral-node/references/client-preview-inference.md](../create-ephemeral-node/references/client-preview-inference.md).
7. **Risks.** Anything you're unsure about. Cross-plugin dependencies, performance, edge cases the user might care about.

Present this as a plan in a single message and wait for "go." Do NOT edit files before approval.

### Phase 3 — Apply the change

Execute the plan in this order to minimize broken-intermediate-state risk:

1. **`definition.ts`** first — the source of truth for types, schema, handles.
2. **`shared.ts`** (if exists and affected) — pure helpers used by both executors.
3. **`executor.server.ts`** — server logic. Implement compat shims here (default values for missing config fields).
4. **`executor.client.ts`** — client preview. Mirror server behavior.
5. **`component.tsx`** — UI changes. Render new controls, handle the new state.
6. **`properties.tsx`** / `ui/<...>.tsx` (if affected).
7. **Registry barrels** — only if you're adding new exports to the `index.ts` barrel that the registries import.
8. **New shared components** in `components/ui/` if Phase 2 identified them.

For each edit, use the `Edit` tool with precise context. Don't rewrite whole files when a 5-line change will do — surgical edits preserve git blame history and reduce review surface.

### Phase 4 — Verify

1. Run `npm run build`. Must pass.
2. Grep to confirm the change landed: e.g. if you added a `quality` control to blur, `grep -n "quality" lib/nodes/plugins/blur/*.ts` should show the field in definition, server, client, and component.
3. If aiSchema changed, mentally trace what the chat brain context now says about this node — does it correctly describe the new field/handle?
4. Write a smoke-test summary for the user. Specifically point at:
   - What to manually test in the browser (e.g., "drop a Blur node, set quality to 50, verify output looks crisper than before").
   - What existing workflows to re-run to confirm no regression (e.g., "load the most recent session that uses Blur and click Run — output should match what it produced previously").
   - Any cross-plugin scenarios to verify (e.g., for compositor changes: "verify the Blur → Compositor → AI generator chain still ends with a non-white image").

Do NOT smoke-test yourself — the user does that.

## Slash command invocation

User typed `/update-ephemeral-node` (optionally with `<node> <description>`).
- If inline argument like `blur "add quality control"` is given, jump to Phase 1 with that as context.
- Otherwise ask: "Which node and what change? (e.g. 'blur — add a quality control')."

## When to refuse / push back

- **Renaming the type slug, a handle id, or a config key.** These are stable identifiers used in saved workflows. Refuse and tell the user: this is a breaking schema change. To proceed they need to provide (a) explicit confirmation to break old saved workflows, OR (b) a migration plan (typically a SQL migration that rewrites `sessions.canvas_state` and `executions.graph_json` for affected rows).
- **Removing a control or handle.** Same logic. Default to refusing; only proceed with explicit approval. The compat-shim alternative (treating the field as removed but tolerated in old configs) is usually preferable.
- **Removing a plugin entirely.** Same — requires migration plan or explicit destructive approval. Tell the user this orphans every workflow that uses the node.
- **The "update" is actually a new plugin in disguise.** If the user says "update blur to also do brightness, contrast, and grayscale all in one," that's not an update — that's a different node (a generic color-adjust node). Suggest using `/create-ephemeral-node` for the new one and leaving blur alone.
- **The change implies the operation is actually a hosted ML model.** Same rule as the create skill: tell the user to add a row to the `ai_models` table instead of forcing a hosted model into an ephemeral plugin.

## Reference files

This skill's own references:
- [references/change-types.md](references/change-types.md) — change taxonomy + per-type file lists + risk levels.
- [references/backwards-compat.md](references/backwards-compat.md) — patterns for not breaking saved workflows (compat shims, default coercion, deprecated-but-tolerated fields).

Shared with `create-ephemeral-node`:
- [.claude/skills/create-ephemeral-node/references/plugin-structure.md](../create-ephemeral-node/references/plugin-structure.md) — the target file/folder layout you're working against.
- [.claude/skills/create-ephemeral-node/references/ui-primitives.md](../create-ephemeral-node/references/ui-primitives.md) — existing component inventory.
- [.claude/skills/create-ephemeral-node/references/node-recipes.md](../create-ephemeral-node/references/node-recipes.md) — four shape patterns (sometimes an update changes the node's shape entirely, which is essentially a rebuild).
- [.claude/skills/create-ephemeral-node/references/handle-types.md](../create-ephemeral-node/references/handle-types.md) — NodeDataType enum.
- [.claude/skills/create-ephemeral-node/references/aischema-cookbook.md](../create-ephemeral-node/references/aischema-cookbook.md) — aiSchema patterns.
- [.claude/skills/create-ephemeral-node/references/style-guide.md](../create-ephemeral-node/references/style-guide.md) — visual language.
- [.claude/skills/create-ephemeral-node/references/server-tech-inference.md](../create-ephemeral-node/references/server-tech-inference.md) — picking server tech.
- [.claude/skills/create-ephemeral-node/references/client-preview-inference.md](../create-ephemeral-node/references/client-preview-inference.md) — picking client preview.

The project also carries [lib/nodes/plugins/README.md](../../lib/nodes/plugins/README.md) and [docs/node-recipes.md](../../docs/node-recipes.md) which stay current with the codebase.
