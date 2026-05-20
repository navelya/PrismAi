# Change Type Taxonomy + Impact Analysis

Every update to an ephemeral node falls into one of these categories. Pick the one(s) that match the requested change, then follow the impact list.

## Additive — new optional control

The user wants a new knob on the node. The new field has a sensible default; existing workflows that don't set it use the default.

**Risk:** Low.

**Files to touch:**
- `definition.ts` — add field to the `<Type>Config` interface, add it to `defaultConfig`, add it to `aiSchema.properties`.
- `executor.server.ts` — read the new field, apply its effect. Use `??` to default when the field is missing on old configs: `const quality = config.quality ?? 1.0`.
- `executor.client.ts` — same as server, mirror the behavior.
- `component.tsx` — render a control (NumberInput/Select/Switch/etc.) that writes to `config.<field>` via `updateNodeConfig`.

**Backwards compat:** Free. Old workflows lack the field; the `??` default gives them the previous behavior.

**Example user requests:**
- "Add a quality slider to blur"
- "Let the user choose grayscale mode (luminance vs average)"
- "Add a tooltip toggle to the compositor preview"

## Additive — new optional handle

A new input or output handle. New inputs are `isMandatory: false` so old workflows that don't connect anything still work. New outputs can be ignored by downstream nodes that don't read them.

**Risk:** Low.

**Files to touch:**
- `definition.ts` — add to `handles.inputs` or `handles.outputs`. New inputs ALWAYS get `isMandatory: false`. Update `aiSchema` if the new handle changes how the chat brain wires the node.
- `executor.server.ts` — read the new input from `inputs.<id>` (with falsy guard if optional) or produce the new output.
- `executor.client.ts` — same.
- `component.tsx` — usually no code change; `BaseNode` renders handles automatically from the shared def's `handles` field. Verify the new handle appears.

**Backwards compat:** Free for optional handles.

**Example user requests:**
- "Add a mask input to blur (optional)"
- "Add a second output that exposes the histogram"

## Modify — control range/semantics

The user wants an existing knob to behave differently — wider range, different default, different mapping curve, etc. Existing workflows that have the old default may now produce subtly different output.

**Risk:** Medium. Existing workflows still LOAD (the type is unchanged), but their RUN OUTPUT may differ.

**Files to touch:**
- `definition.ts` — update `aiSchema` bounds/description and `defaultConfig` default. The TS interface type usually doesn't change (number is still number).
- `executor.server.ts` — update the mapping logic.
- `executor.client.ts` — match the server's new mapping.
- `component.tsx` — update the control's min/max/step props.

**Backwards compat:** State explicitly in the plan how the change affects existing workflows. If old workflows have a saved `radius: 50` and the meaning of "50" is changing, you must either (a) accept that old workflows produce different output now, or (b) treat the old config range as a legacy variant. Almost always (a) is fine — but the user must approve.

**Example user requests:**
- "Make the blur radius go up to 100 instead of 50"
- "Use a logarithmic scale for the quality slider"
- "The default for output format should be webp instead of png"

## Modify — UX only (no runtime impact)

Rearrange the canvas card, change the icon, add a button that just toggles a preview mode, restyle the controls — anything that doesn't affect `executor.*.ts` or the data flow.

**Risk:** None at runtime. Visual only.

**Files to touch:**
- `component.tsx` — most changes go here.
- `definition.ts` — only if you're changing `meta.icon`, `meta.label`, `meta.color`. These show in the canvas + node palette + AI brain context.
- New components in plugin `ui/` if needed (in-plugin if one-off).
- New components in `components/ui/` if reusable.

**Backwards compat:** Free.

**Example user requests:**
- "Change the blur icon from Droplets to Waves"
- "Add a 'reset' button to compositor that clears all layers"
- "Make the preview image bigger in the prompt node"

## Modify — server logic only

Change how the server transform works internally (different Sharp pipeline, different algorithm) without changing the public API (handles, controls, output type).

**Risk:** Medium. Public API stable; saved workflows still load and run. But the OUTPUT may look different.

**Files to touch:**
- `executor.server.ts` — the logic change.
- `executor.client.ts` — make sure the client preview produces the same result (or closest equivalent in-browser). Drift between server and client preview confuses users.
- Sometimes `shared.ts` if pure helpers move.

**Backwards compat:** Outputs of saved workflows may differ. State this in the plan; user approval required for any non-trivial visual difference.

**Example user requests:**
- "Use bicubic resize in the compositor instead of fill"
- "Switch blur from Gaussian to a separable kernel for performance"
- "Fix the blur server-side to match the client preview exactly"

## Modify — client preview only

Improve or fix `executor.client.ts` without touching the server. Pure preview improvements (faster, more accurate, fewer artifacts) that don't change downstream node consumers.

**Risk:** None — the canvas value piped to downstream nodes during server runs comes from `executor.server.ts`. The client executor only feeds `nodeOutputs[id]` for in-canvas preview.

**Files to touch:**
- `executor.client.ts` — usually the only file.

**Backwards compat:** Free.

**Example user requests:**
- "The blur preview is laggy on big images — downscale the input before applying"
- "The compositor preview doesn't show rotation correctly"
- "Add a loading indicator while the client preview is computing"

## Modify — aiSchema only

Tighten or expand what the chat brain understands about this node. Pure documentation update for the brain.

**Risk:** None at runtime. Affects natural-language node generation.

**Files to touch:**
- `definition.ts` — only the `aiSchema` field.

**Backwards compat:** Free.

**Example user requests:**
- "The brain keeps generating blurs with radius 100 when the user says 'subtle blur' — fix the schema descriptions"
- "Add an enum constraint on output format so the brain only picks valid values"

## Cross-plugin — video live-signal contract

A change to a node that produces or consumes `video`. The envelope contract collapsed to a single live shape in 2026-05: each data item carries exactly one of `url` (static asset) or `graph` (live `GraphDescription`). The legacy sibling fields `cssFilter`, `stream`, and `canvas` on the envelope are **gone** — filter information now lives only inside `{ kind: 'filter', upstream, cssFilter }` graphs. See [live-data-flow.md](../../create-ephemeral-node/references/live-data-flow.md) for the full contract.

Many "innocent" updates break one shape while keeping the other working — e.g. tightening an upstream-URL guard, adding a `canvas.toDataURL()` step on the video branch, or assuming `first.url` is always non-empty.

**Risk:** High. Failure mode is silent: workflows still load and the UI looks fine, but the live preview goes blank or chains stop propagating.

**Files to touch:** depends on the role this node plays in the video chain.

- **If this node CONSUMES video (filter, transform, preview):**
  - `executor.client.ts` — extraction must read both `graph` and `url` from the upstream envelope item; the "no input" check is `if (!url && !graph) return null`. Filters wrap the upstream graph in `{ kind: 'filter', upstream, cssFilter }`; they do NOT re-encode pixels. When upstream is a raw URL, synthesize a 1-layer compositor graph first (see `wrapUrlAsCompositorGraph` in `lib/nodes/plugins/blur/executor.client.ts`) so the output is uniformly a graph.
  - `component.tsx` — preview renders the upstream graph via `paintGraphFrame` / `LayerSubgraph` when `graph` is present; falls back to `<video src>` for static URLs. `mediaKind` returns `'video'` whenever a graph is present, regardless of URL.
  - Filter chains compose by nesting `kind: 'filter'` graphs — the renderer flattens them during paint. The node does NOT read `cssFilter` off the envelope.

- **If this node PRODUCES video (compositor-like live producer):**
  - `executor.server.ts` — emits a real URL (Shape A). Server has no canvas; uses ffmpeg/Sharp/Replicate and uploads.
  - `component.tsx` — publishes `{ type: 'video', data: [{ url: '', graph, resolution, metadata }] }` into `nodeOutputs[id]` via `setNodeOutput`. The `graph` is a `GraphDescription` (e.g. `kind: 'compositor'`) describing the timeline.
  - If the node has a fullscreen lightbox, the video path records the graph into a blob URL once on open and feeds that to `ImageLightbox` (a live graph can't be scrubbed as a single resource). See compositor's `lightboxBlobUrl` flow.

- **If this node's output dataType is the polymorphic union `['image','video']`:** add or update a `resolve<NodeName>OutputKind` helper in `lib/editor/handle-compatibility.ts` and dispatch from `resolveDynamicOutputType`. The helper should trust the envelope's `.type` field over URL detection — live producers have empty URLs. The component should call `pruneIncompatibleOutgoingEdges(id, newKind)` from a `useEffect` when the kind narrows.

**Backwards compat:** verify both upstream shapes still work after the change. Smoke test must include:
- Static-URL upstream: `media_input` video → this node → downstream. Confirm live preview.
- Live-graph upstream: `compositor` with a video layer → this node → downstream. Confirm live preview AND that filter chains continue past this node.

**Example user requests that hit this:**
- "Make blur work on video too" — adds graph-wrapping consumer logic to blur.
- "The compositor's output isn't reaching downstream filters" — likely a producer-side envelope shape bug (missing `graph`, or `url` not `''`).
- "Add a contrast node" — must follow the same filter pattern as blur (wrap upstream in `kind: 'filter'`) to compose with the existing video chain.

## Cross-plugin — output shape change

You're changing what this node outputs in a way downstream nodes might notice. E.g. switching the output from `image` to `image_array`, adding a new field to `ImageObject.metadata` that downstream nodes might or might not expect.

**Risk:** High. Every downstream consumer is potentially affected.

**Files to touch:**
- This node's `definition.ts`, `executor.server.ts`, `executor.client.ts`.
- Every downstream node that consumes this output type. Often nothing — most downstream nodes just look for `.url`. But check.

**Backwards compat:** Verify by grep:
```
grep -rn "result_type.*'<old-type>'" lib/workflow/ app/api/  # check workflow engine expectations
grep -rn "inputs.<this-output-handle-id>" lib/nodes/plugins/  # downstream consumers
```

If the change is genuinely breaking for downstream nodes, you need a coordinated update — either the user's request covers both sides, or you push back and propose a different approach.

## Breaking — remove control

The user wants to remove a config field. Old workflows that have it will load with the extra field; the executor will ignore it.

**Risk:** Depends. The runtime is permissive about extra config keys, so removal doesn't actually break old workflows from loading or running. The risk is loss of functionality: old workflows that depended on the field now silently use the default instead.

**Files to touch:**
- `definition.ts` — remove from interface, `defaultConfig`, `aiSchema.properties`, optionally `aiSchema.required`.
- `executor.server.ts` — remove the field's branch.
- `executor.client.ts` — same.
- `component.tsx` — remove the control UI.

**Backwards compat:** Old configs work; the field is just ignored. Document this in the plan.

**Refusal trigger:** If the field's effect is load-bearing (e.g. you can't remove `images` from media_input — it's the whole point), refuse and ask for clarification.

## Breaking — remove handle

The user wants to remove an input or output handle. Old edges that target/source it become orphaned.

**Risk:** High. The renderer may show broken edges; the orchestrator may fail to build inputs for the affected node.

**REFUSE without explicit migration plan.** The plan must answer: what happens to saved workflows that have edges referencing this handle?

If approved: also need a migration approach (SQL update to `sessions.canvas_state` removing matching edges, or runtime filtering of orphaned edges).

## Breaking — change handle id

Same as remove + add. Old edges reference the old id; they're now orphaned.

**REFUSE without explicit migration plan.**

## Breaking — rename type slug

The plugin folder name + the `type` field in `definition.ts` + the registry keys.

**The type slug is a string baked into every saved workflow.** Renaming breaks every saved session and every saved execution.

**REFUSE without explicit migration plan + SQL migration that updates the type in stored canvas_state and graph_json.**

If the user wants this anyway, ask: are you sure no published workflows depend on the old slug? Even if so, recommend keeping the old slug as an alias (the registry can have both keys pointing at the same defs) for a deprecation period.

## Removing a plugin entirely

Same as rename — every saved workflow that uses the type becomes broken.

**REFUSE without explicit destructive approval.** Suggest the deprecation pattern: keep the plugin registered but mark it with a "deprecated" badge in `meta`, hide it from the node palette, and remove it fully later after no live workflows reference it.

## Plugin shape change

If the user wants to change the node's shape (transform → layered, source → transform, etc.), the change is so large it's effectively a rebuild. Push back: this is two steps, not one. Either:
- Create a new plugin with the new shape (`/create-ephemeral-node`) and deprecate the old one.
- OR explicitly approve the breaking-change cascade (remove old handles, add new handles, rewrite executors and component).

Don't try to silently morph one shape into another — the file diff will be larger than a fresh plugin and the user is more likely to spot regressions on a fresh plugin review than on an "update" diff.
