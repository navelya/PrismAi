# Plugin Folder Contract

Every ephemeral-node plugin lives at `lib/nodes/plugins/<snake_case_type>/` and follows a uniform layout. The skill emits exactly these files; no alternative names.

## Required files

```
lib/nodes/plugins/<type>/
  definition.ts        # NodeSharedDef literal + config TS interface + aiSchema
  executor.server.ts   # Server execution (sharp, ffmpeg, fetch+upload)
  executor.client.ts   # Client live preview (Canvas / Web Audio / Three / etc.)
  component.tsx        # React Flow canvas card, exports default + <type>ClientDef
  index.ts             # Barrel — public surface for the registries
```

## Optional files

```
lib/nodes/plugins/<type>/
  properties.tsx       # Custom side property panel (RARE — only ai_generator currently uses)
  shared.ts            # Pure helpers used by BOTH executors
  ui/                  # Subfolder for node-specific custom UI (modals, canvases)
    EditorModal.tsx
    Renderer.tsx
    ...
```

## File responsibilities

### `definition.ts`

- Imports `NodeSharedDef` from `'../../core/types'`.
- Declares the config TS interface (`<Type>Config`).
- Exports `<type>SharedDef: NodeSharedDef<<Type>Config>`.
- Contains: `type` (snake_case slug), `family` (`'input' | 'generative' | 'utility' | 'output'`), `category` (`'input' | 'utility' | 'generative'`), `meta { label, color, icon, ephemeral?: true }`, `handles { inputs: [], outputs: [] }`, `defaultConfig`, `aiSchema`.
- The `meta.ephemeral: true` flag tells the engine NOT to persist this node's outputs to the DB (live preview only).
- See [aischema-cookbook.md](aischema-cookbook.md) for the schema patterns and [handle-types.md](handle-types.md) for the data-type enum.

### `executor.server.ts`

- Imports `sharp` (or whatever server tech) at the top of the file. No conditional dynamic imports.
- Signature: `(config, inputs, context: ExecutionContext) => Promise<NodeExecutionResult>`.
- Self-contained: fetch input URLs, run the transform, upload binary outputs to the `workflow-ephemeral-tmp` Supabase bucket using `createServiceClient` from `@/lib/supabase/service`.
- Path convention for uploads: `${context.executionId}/${context.nodeId}/<type>_${Date.now()}.<ext>`.
- Returns `NodeExecutionResult { success: true, data: [<ImageObject | string | other>] }` on success or `{ success: false, data: null, error: '...' }` on failure.
- Logs liberally: `console.log` at the start with input keys + config summary, on each major step, and at the end. The runtime captures these to dev-server output and they are essential for diagnosing layered nodes.
- DO NOT export any browser-touching code from this file. It is server-only.

### `executor.client.ts`

- Imports `ClientExecutor` type from `'../../core/types'`.
- Signature: `(config, inputs) => Promise<{type, data} | null>` (or sync variant).
- Browser-only: uses Canvas 2D, `<video>`, Web Audio API, Three.js, model-viewer, etc.
- The first thing it does should be `if (typeof window === 'undefined') return null;` so it's safe even if accidentally imported server-side.
- Reads upstream values from `inputs` keyed by handle id or edge id (compositor pattern).
- Returns the same envelope shape as the server side: `{ type: 'image', data: [{ url: dataUrl }] }` for images, `{ type: 'text', data: [str] }` for text.
- Use `toLegacyRenderableOutput` from `@/lib/workflow/result-format` to normalize upstream values that may arrive as envelopes, raw `ImageObject`, or arrays.

### `component.tsx`

- Top of file: `'use client';`.
- Imports `BaseNode` from `'@/lib/nodes/core/canvas/BaseNode'`.
- Imports the config type from `'./definition'` (same folder).
- Renders a `BaseNode` with the node's inline controls + preview as children.
- Calls `useNodeAutoCompute(id)` from `'@/lib/hooks/use-node-auto-compute'` to wire the client executor.
- Default export: `memo(<Component>)`.
- Named export: `<type>ClientDef: NodeClientDef = { ...<type>SharedDef, component: memo((props) => <Component {...props} type="<type>" />), clientExecutor: <type>ClientExecutor }`.
- Uses Zustand selectors with `useShallow` to subscribe narrowly to the upstream output and the node's config. NEVER use `useNodes()` or `useEdges()` from React Flow — they fire on every drag tick and tank performance.
- Style: `bg-white/5`, `border-white/10`, `backdrop-blur-md`. See [style-guide.md](style-guide.md).

### `index.ts`

A pure barrel. Does NOT export `executor.server.ts` (server-only). Looks like:

```ts
// Public surface of the <type> plugin.
// IMPORTANT: this barrel must NOT export executor.server.ts.
// executor.server.ts imports `sharp`, which is server-only and would leak
// into the client bundle if surfaced here. Server code imports from
// './executor.server' explicitly via the server-registry barrel.
export { <type>SharedDef, type <Type>Config } from './definition';
export { <type>ClientDef, default as <Type>Node } from './component';
export { <type>ClientExecutor } from './executor.client';
```

If a `properties.tsx` exists: also `export { default as <Type>Properties } from './properties';`.

### `properties.tsx` (rare — usually omit)

Only create this if the user explicitly wants a side property panel separate from the canvas card. The current codebase only uses one for `ai_generator`. Most ephemeral nodes put their controls inline in the card.

If creating: signature `(props: { node: WorkflowNode; updateConfig: (cfg: Partial<<Type>Config>) => void }) => JSX.Element`. Default export.

### `shared.ts` (rare)

Pure helpers (geometry math, format-detection, etc.) used by BOTH `executor.server.ts` and `executor.client.ts`. Pure functions only — no `sharp`, no `window`. If you only need a helper in one place, define it inline in that file.

### `ui/` subfolder (when needed)

Heavy node-specific UI that doesn't fit in `component.tsx`. Compositor's Konva editor (`ui/EditorModal.tsx`, `ui/Renderer.tsx`) is the canonical example.

## Registry wiring (three barrel files)

After writing the plugin folder, append exactly one line per registry:

### `lib/nodes/core/shared-registry.ts`

```ts
import { <type>SharedDef } from '../plugins/<type>/definition';
// ...
export const sharedRegistry: Record<string, NodeSharedDef<any>> = {
    // ... existing entries ...
    <type>: <type>SharedDef,
};
```

### `lib/nodes/core/client-registry.ts`

```ts
import { <type>ClientDef } from '../plugins/<type>';
// ...
export const clientRegistry: Record<string, NodeClientDef> = {
    // ... existing entries ...
    <type>: <type>ClientDef,
};
```

### `lib/nodes/core/server-registry.ts`

```ts
import { <type>SharedDef } from '../plugins/<type>/definition';
import { <type>Executor } from '../plugins/<type>/executor.server';
// ...
export const serverRegistry: Record<string, NodeServerDef> = {
    // ... existing entries ...
    <type>: { ...<type>SharedDef, executor: <type>Executor },
};
```

The `isEphemeralNode(type)` helper exported from `server-registry.ts` automatically picks up the new entry — no edit needed there.

## Verification

After writing files:

```bash
npm run build
```

Must pass. Then:

```bash
grep -n "<type>" lib/nodes/core/shared-registry.ts lib/nodes/core/client-registry.ts lib/nodes/core/server-registry.ts
```

Must show three matches (one per registry).
