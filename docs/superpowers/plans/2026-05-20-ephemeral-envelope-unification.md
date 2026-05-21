# Ephemeral Output Envelope Unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the five live-output envelope shapes published by ephemeral nodes (graph / url / canvas / cssFilter / text) to three (graph / url / text) by removing two dead paths and routing all video-with-filter through `GraphDescription`.

**Architecture:** No new modules. Surgical deletes in [Renderer.tsx](lib/nodes/plugins/compositor/ui/Renderer.tsx) and [compositor/component.tsx](lib/nodes/plugins/compositor/component.tsx). One behavior change in [blur/executor.client.ts](lib/nodes/plugins/blur/executor.client.ts): when upstream is a raw video URL, synthesize a 1-layer compositor `GraphDescription` and wrap it in a `kind: 'filter'` graph so blur's output is uniformly a graph. Server-side execution path is not touched.

**Tech Stack:** TypeScript, React, Zustand, Konva (Canvas2D under the hood), Next.js. No tests in this repo — verification = `npx tsc --noEmit` + manual browser smoke per [CLAUDE.md](CLAUDE.md).

**Spec:** [docs/superpowers/specs/2026-05-20-ephemeral-envelope-unification-design.md](docs/superpowers/specs/2026-05-20-ephemeral-envelope-unification-design.md)

---

## File map

| File | Action |
|---|---|
| `lib/nodes/plugins/blur/executor.client.ts` | Modify — synthesize wrapping graph; stop emitting `cssFilter` sibling |
| `lib/nodes/plugins/compositor/ui/Renderer.tsx` | Modify — delete `LayerCanvas`, delete `cssFilter` prop + filter draw on `LayerVideo`, simplify dispatch |
| `lib/nodes/plugins/compositor/component.tsx` | Modify — drop `cssFilter: ''` from publish; remove `canvas` branch in `outputKind` |
| `lib/hooks/use-node-auto-compute.ts` | Modify — update header comment for `envelopeContentEqual` |
| `.claude/skills/create-ephemeral-node/references/live-data-flow.md` | Rewrite to one-graph contract |
| `.claude/skills/create-ephemeral-node/references/node-recipes.md` | Update video-aware recipe |
| `.claude/skills/update-ephemeral-node/references/change-types.md` | Sync to one-graph contract |

---

## Task 1: Pre-flight audit — confirm dead paths have no remote producers

**Files:**
- Read-only audit across `lib/`, `components/`, `app/`

- [ ] **Step 1: Grep for any envelope emitter of `cssFilter`**

Run (PowerShell):

```powershell
rg -n "cssFilter" lib app components --type ts --type tsx
```

Expected: matches in **only** these files:

- `lib/nodes/plugins/blur/executor.client.ts` (emitter — Task 2 will fix)
- `lib/nodes/plugins/compositor/component.tsx` (emits `cssFilter: ''` — Task 5 will fix)
- `lib/nodes/plugins/compositor/ui/Renderer.tsx` (consumer — Task 3 will fix)
- `lib/nodes/plugins/compositor/graph-renderer.ts` (consumes the `kind: 'filter'` graph internal field — KEEP, this is the new home for the data)
- `lib/nodes/plugins/compositor/shared.ts` (defines `GraphDescription` filter kind — KEEP)
- `lib/nodes/plugins/blur/component.tsx` (read-only audit — only matters if it READS envelope.cssFilter; if it only references the local CSS string, leave it)
- `components/ui/ImageLightbox.tsx` (audit — should not be reading envelope cssFilter)

If matches appear in any OTHER file, STOP and surface them — the plan needs an extra task.

- [ ] **Step 2: Grep for any envelope emitter of a raw `HTMLCanvasElement` ref**

Run (PowerShell):

```powershell
rg -n "canvas\s*instanceof\s*HTMLCanvasElement|canvas:\s*HTMLCanvasElement|\.canvas\s*=" lib app components --type ts --type tsx
```

Expected: matches **only** in:

- `lib/nodes/plugins/compositor/ui/Renderer.tsx` (consumer + the `LayerCanvas` component — Task 3/4 will remove)
- `lib/nodes/plugins/compositor/component.tsx` (the `outputKind` check at lines ~597-600 — Task 5 will remove)

Any match outside those two files means a producer exists somewhere unexpected. STOP and surface.

- [ ] **Step 3: Confirm in [blur/component.tsx](lib/nodes/plugins/blur/component.tsx)**

Read the file. **Finding (recorded during plan execution 2026-05-20):** `blur/component.tsx` lines 167-186 define `upstreamCssFilter` which walks the upstream envelope looking for a `cssFilter` string. Line 351 composes it into `blurStyle`. Both become dead code once Task 2 stops emitting the sibling field. Task 2 has been extended to also clean these up — see Task 2 Step 9 below.

- [ ] **Step 4: Commit the audit notes (optional)**

No code changed yet. Skip commit and proceed to Task 2.

---

## Task 2: Blur client executor — always emit a `GraphDescription`

**Files:**
- Modify: [lib/nodes/plugins/blur/executor.client.ts](lib/nodes/plugins/blur/executor.client.ts)

- [ ] **Step 1: Open the file and confirm current state**

Read the file. Confirm the current imports:

```ts
import { GraphDescription } from '../compositor/shared';
```

…and that `blurClientExecutor` currently:
- Emits `cssFilter: accumulatedCss` on every video-branch return.
- Has a "static URL video" pass-through that returns `{ url, cssFilter }` without a graph.

- [ ] **Step 2: Add the `CompositorLayer` import**

Add this to the import block at the top of [executor.client.ts](lib/nodes/plugins/blur/executor.client.ts):

```ts
import { CompositorLayer } from '../compositor/definition';
```

- [ ] **Step 3: Add a synthesis helper above `blurClientExecutor`**

Insert this function just above the `export const blurClientExecutor` declaration:

```ts
/**
 * Synthesize a 1-layer compositor GraphDescription wrapping a raw video URL.
 * Used when blur's upstream is a static-URL video (e.g., MediaInput → Blur
 * directly, with no compositor between). Means blur's output is uniformly a
 * `kind: 'filter'` wrapping a `kind: 'compositor'` regardless of upstream shape.
 */
function wrapUrlAsCompositorGraph(
    url: string,
    resolution?: { width: number; height: number },
): GraphDescription {
    const w = resolution?.width ?? 1920;
    const h = resolution?.height ?? 1080;
    const layer: CompositorLayer = {
        id: '__blur_wrap__',
        name: 'wrap',
        sourceHandleId: '__blur_wrap__',
        selectedIndex: 0,
        transform: {
            x: 0, y: 0, width: w, height: h,
            rotation: 0, opacity: 1,
            flipX: false, flipY: false,
            isAutoCentered: true,
            crop: null,
        },
        visible: true,
        locked: false,
        startTime: 0,
        duration: null,
        trimIn: 0,
        trimOut: null,
        speed: 1,
        muted: false,
        transition: { type: 'none', duration: 0 },
    };
    return {
        kind: 'compositor',
        layers: [{ layer, source: { kind: 'media', url, mediaKind: 'video' } }],
        canvasWidth: w,
        canvasHeight: h,
        duration: 0,
        fps: 30,
        intrinsicDurations: {},
    };
}
```

- [ ] **Step 4: Replace the video branch of `blurClientExecutor`**

Find the existing `if (kind === 'video') { … }` block (currently spanning roughly lines 111-150). Replace its body with this single uniform implementation:

```ts
    if (kind === 'video') {
        const ownFilter = blurFilterString(config?.radius ?? 5);

        // Always operate on a GraphDescription. If upstream already supplied
        // one, wrap it; otherwise synthesize a 1-layer compositor graph
        // around the raw URL first. Downstream consumers see exactly one
        // shape (a `kind: 'filter'` graph) no matter what fed us.
        const baseGraph: GraphDescription = upstreamGraph
            ?? wrapUrlAsCompositorGraph(url!, resolution);

        const filterGraph: GraphDescription = {
            kind: 'filter',
            upstream: baseGraph,
            cssFilter: ownFilter,
        };

        return {
            type: 'video',
            data: [{
                url: '',
                graph: filterGraph,
                resolution,
            }],
        } as any;
    }
```

Note what changed:
- The `accumulatedCss` local and the sibling `cssFilter: accumulatedCss` field on the returned envelope are gone.
- The "static URL" fallback path (the second `return { type: 'video', data: [{ url, cssFilter, resolution }] }` near old line 142-149) is gone — the new code handles both cases through the synthesis.
- The `upstreamCssFilter` local read at the top of the function (lines 87-98) becomes unused. Delete its declaration AND the line that assigns it from `(first as any).cssFilter`.

- [ ] **Step 5: Remove the now-unused `upstreamCssFilter` local**

In the variable-declaration block near the top of `blurClientExecutor` (currently lines 86-90), delete:

```ts
    let upstreamCssFilter: string | null = null;
```

…and the line that assigns it:

```ts
        if (typeof (first as any).cssFilter === 'string') upstreamCssFilter = (first as any).cssFilter;
```

- [ ] **Step 6: Typecheck**

Run:

```powershell
npx tsc --noEmit
```

Expected: no new errors introduced by this file. If the existing project has unrelated errors, they were there before — note the count and confirm it didn't grow.

- [ ] **Step 7: Clean up dead `upstreamCssFilter` reader in blur/component.tsx**

Open [lib/nodes/plugins/blur/component.tsx](lib/nodes/plugins/blur/component.tsx).

(a) Delete the `upstreamCssFilter` `useMemo` block (currently lines 167-186, the full block from the leading `// If the upstream already carries a cssFilter...` comment down through the closing `}, [sourceOutput]);`). It walks the envelope looking for a sibling `cssFilter` string; no producer emits that field anymore.

(b) Simplify the `blurStyle` `useMemo`. Find the current version:

```ts
    const blurStyle = useMemo(() => {
        const sigma = radiusToSigma(localRadius);
        const base = `blur(${sigma}px)`;
        const ownFilter =
            config.type === 'box'
                ? `${base} contrast(1.15) brightness(1.05) saturate(1.1)`
                : config.type === 'stack'
                ? `${base} saturate(0.8) opacity(0.9)`
                : base;
        return upstreamCssFilter ? `${upstreamCssFilter} ${ownFilter}` : ownFilter;
    }, [localRadius, config.type, upstreamCssFilter]);
```

Replace with:

```ts
    const blurStyle = useMemo(() => {
        const sigma = radiusToSigma(localRadius);
        const base = `blur(${sigma}px)`;
        return config.type === 'box'
            ? `${base} contrast(1.15) brightness(1.05) saturate(1.1)`
            : config.type === 'stack'
            ? `${base} saturate(0.8) opacity(0.9)`
            : base;
    }, [localRadius, config.type]);
```

(c) Update the JSDoc comment above `blurStyle` (currently lines 337-341) to remove the "Composes our own blur with any cssFilter the upstream already declared..." sentence. The new behavior: blur preview always uses its own filter; upstream filter info travels in the `paintGraphFrame` path for graph upstreams (filters live inside the graph), so the preview canvas renders the cumulative effect via `paintGraphFrame`, and `blurStyle` only adds the local blur on top.

Why this is safe: when upstream is a graph, [graph-renderer.ts:336-362](lib/nodes/plugins/compositor/graph-renderer.ts#L336-L362) already flattens and applies the upstream filter chain when painting into the preview canvas. Adding local blur on top via CSS gives the same cumulative visual result as the old composition.

- [ ] **Step 8: Manual smoke**

Start the dev server in a separate terminal if not already running:

```powershell
npm run dev
```

In the browser at `http://localhost:3000`:

1. Build: `MediaInput (video) → Blur → Compositor`.
2. Confirm: the Compositor preview shows the video blurred, scrub works on the compositor's mini-transport.
3. Build: `MediaInput (video) → Compositor A → Blur → Compositor B`.
4. Confirm: Compositor B shows A's pixels blurred; A's playhead and B's playhead can advance independently (scrub B without affecting A).
5. Build: `MediaInput (video) → Blur → Blur (chained)` — both blur previews show cumulative blur (the downstream blur card's in-card preview renders the upstream's filter chain via paintGraphFrame plus its own local blur on top).

If any scenario regresses, debug before committing.

- [ ] **Step 9: Commit**

```powershell
git add lib/nodes/plugins/blur/executor.client.ts lib/nodes/plugins/blur/component.tsx
git commit -m "refactor(blur): always publish a GraphDescription, drop sibling cssFilter"
```

---

## Task 3: Renderer — remove `cssFilter` prop from `LayerVideo`

**Files:**
- Modify: [lib/nodes/plugins/compositor/ui/Renderer.tsx](lib/nodes/plugins/compositor/ui/Renderer.tsx)

This task removes the per-layer offscreen-filter-canvas rAF loop attached to `LayerVideo`. Filtered video now reaches the renderer exclusively through `LayerSubgraph` (via `paintGraphFrame`'s native handling of `kind: 'filter'` graphs).

- [ ] **Step 1: Delete `cssFilter` from `LayerVideo`'s props interface**

Open [Renderer.tsx](lib/nodes/plugins/compositor/ui/Renderer.tsx). Find the `LayerVideo` props interface (immediately inside the `const LayerVideo = memo(function LayerVideo({…}: { … }) {` declaration around line 219). Delete the `cssFilter` field and its JSDoc:

```ts
    /**
     * Optional CSS filter string from the upstream envelope (e.g. from a
     * Blur node: `"blur(8px)"`). When present, frames are drawn through a
     * per-layer offscreen canvas with `ctx.filter = cssFilter` before Konva
     * picks them up. Chained filters compose by string concatenation. When
     * null, the raw pooled HTMLVideoElement is passed to Konva directly —
     * zero-overhead path for unfiltered video.
     */
    cssFilter?: string | null;
```

Also delete the `cssFilter` destructure entry in the function signature (the `cssFilter,` line in the parameter destructure block above the props interface, around line 213).

- [ ] **Step 2: Delete the offscreen filter canvas refs and rAF loop**

Inside `LayerVideo`'s body, delete the entire block that creates and animates the offscreen filter canvas. That is, delete:

```ts
    // Per-layer offscreen canvas for filtered video. Created lazily on first
    // need; sized to match the pooled video's natural resolution; redrawn
    // every animator tick (only while playing) with the upstream cssFilter
    // applied. Konva uses this canvas as its image source instead of the raw
    // video, picking up the blurred frame on each batchDraw.
    const filterCanvasRef = useRef<HTMLCanvasElement | null>(null);
    if (cssFilter && !filterCanvasRef.current && typeof document !== 'undefined') {
        filterCanvasRef.current = document.createElement('canvas');
    }
    const filterCanvas = cssFilter ? filterCanvasRef.current : null;

    // rAF loop for the filter draw. Runs only while the pooled video is
    // actively playing OR was just scrubbed; pauses cleanly so we don't burn
    // CPU on a static frame. The compositor's CompositorAnimator handles
    // konva.batchDraw on its own rhythm — this loop's job is only to keep
    // the offscreen canvas's pixels current.
    useEffect(() => {
        if (!cssFilter) return;
        const video = pooledEl;
        const canvas = filterCanvasRef.current;
        if (!video || !canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let stopped = false;
        let raf = 0;
        const draw = () => {
            if (stopped) return;
            if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
                if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
                if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
                ctx.filter = cssFilter;
                try {
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                } catch {
                    // CORS-tainted draw can throw; ignore — Konva will keep
                    // using the last good frame.
                }
            }
            raf = requestAnimationFrame(draw);
        };
        raf = requestAnimationFrame(draw);
        return () => {
            stopped = true;
            if (raf) cancelAnimationFrame(raf);
        };
    }, [cssFilter, pooledEl]);
```

- [ ] **Step 3: Replace `videoEl` resolution with the raw pooled element**

Find:

```ts
    // The image source Konva renders: filtered canvas if cssFilter is set,
    // otherwise the raw pooled video element.
    const videoEl = filterCanvas || pooledEl;
```

Replace with:

```ts
    const videoEl = pooledEl;
```

- [ ] **Step 4: Remove `cssFilter` passing at the `LayerVideo` call site**

Scroll down to `CompositorLayerNodes`. Find the `<LayerVideo … cssFilter={cssFilter} … />` invocation (around line 1147) and delete the `cssFilter={cssFilter}` prop.

- [ ] **Step 5: Remove the `cssFilter` extraction from `CompositorLayerNodes`**

Within `CompositorLayerNodes`, delete the block that pulls `cssFilter` off `resolved`:

```ts
                // Filter descriptor carried from an upstream effect node
                // (e.g. Blur). When present, the LayerVideo routes frames
                // through an offscreen canvas with `ctx.filter = cssFilter`
                // before Konva renders them.
                const cssFilter =
                    resolved && typeof resolved === 'object' && typeof (resolved as any).cssFilter === 'string'
                        ? ((resolved as any).cssFilter as string)
                        : null;
```

- [ ] **Step 6: Typecheck**

```powershell
npx tsc --noEmit
```

Expected: no new errors. If `cssFilter` is referenced anywhere else in this file, the compiler will tell you — delete the remaining usage.

- [ ] **Step 7: Manual smoke**

Reload the browser. Re-run the two scenarios from Task 2 (`MediaInput → Blur → Compositor` and `MediaInput → Compositor A → Blur → Compositor B`). Both should still show blurred video. The blurred output is now produced inside `paintGraphFrame` (filter handling in [graph-renderer.ts:336-362](lib/nodes/plugins/compositor/graph-renderer.ts#L336-L362)) instead of in `LayerVideo`'s per-layer canvas.

- [ ] **Step 8: Commit**

```powershell
git add lib/nodes/plugins/compositor/ui/Renderer.tsx
git commit -m "refactor(compositor): remove cssFilter prop and per-layer filter loop from LayerVideo"
```

---

## Task 4: Renderer — delete `LayerCanvas` and its dispatch branch

**Files:**
- Modify: [lib/nodes/plugins/compositor/ui/Renderer.tsx](lib/nodes/plugins/compositor/ui/Renderer.tsx)

- [ ] **Step 1: Update the `RenderableLayer` interface**

The `RenderableLayer` type at [Renderer.tsx:38](lib/nodes/plugins/compositor/ui/Renderer.tsx#L38) currently is:

```ts
export interface RenderableLayer {
    layer: CompositorLayer;
    resolved: { url?: string; canvas?: HTMLCanvasElement; graph?: GraphDescription; cssFilter?: string } | string | null;
}
```

Replace the `resolved` type with the narrowed shape:

```ts
export interface RenderableLayer {
    layer: CompositorLayer;
    resolved: { url?: string; graph?: GraphDescription; resolution?: { width: number; height: number } } | string | null;
}
```

(Adding `resolution` while we're here — it's already present on incoming objects and downstream code reads it; making it explicit in the type is a 0-risk clarity win.)

- [ ] **Step 2: Delete the `LayerCanvas` component**

Locate the `LayerCanvas` declaration (begins at the JSDoc block "Render a layer whose source is an HTMLCanvasElement…" around line 453 and ends at the close of the second-returned `<KonvaImage … />` JSX around line 643). Delete the entire span — JSDoc, `const LayerCanvas = memo(function LayerCanvas({…}) { … });`, and the trailing blank line.

- [ ] **Step 2: Delete the `sourceCanvas` extraction in `CompositorLayerNodes`**

Find:

```ts
                // Live canvas reference from an upstream renderer (legacy
                // push model — kept for non-graph sources that still publish
                // a direct canvas ref). The pull-model graph branch above
                // takes precedence whenever both are present.
                const sourceCanvas =
                    !sourceGraph &&
                    resolved && typeof resolved === 'object' && (resolved as any).canvas instanceof HTMLCanvasElement
                        ? ((resolved as any).canvas as HTMLCanvasElement)
                        : null;
```

Delete the entire block.

- [ ] **Step 3: Delete the `sourceCanvas` rendering branch**

Find the `if (sourceCanvas) { return <LayerCanvas … /> }` block in `CompositorLayerNodes`. Delete it whole — the JSDoc above it (`// Canvas-sourced layer: …`) too.

- [ ] **Step 4: Simplify the `kind` determination**

The `kind` resolution currently has:

```ts
                let kind: LayerSourceKind = 'unknown';
                if (asText !== null) kind = 'text';
                else if (sourceGraph) kind = 'video'; // graphs behave like video for gating/redraw
                else if (sourceCanvas) kind = 'video'; // canvas behaves like video for gating/redraw
                else if (url) kind = detectSourceKindFromUrl(url);
```

Remove the `sourceCanvas` line:

```ts
                let kind: LayerSourceKind = 'unknown';
                if (asText !== null) kind = 'text';
                else if (sourceGraph) kind = 'video'; // graphs behave like video for gating/redraw
                else if (url) kind = detectSourceKindFromUrl(url);
```

- [ ] **Step 5: Simplify the `hasVideo` detection**

Find the `useMemo` that computes `hasVideo` (drives `CompositorAnimator`'s `enabled` flag, around line 994). Currently:

```ts
    const hasVideo = useMemo(
        () =>
            layers.some(({ layer, resolved }) => {
                if (!layer.visible) return false;
                if (resolved && typeof resolved === 'object') {
                    if ((resolved as any).graph) return true;
                    if ((resolved as any).canvas instanceof HTMLCanvasElement) return true;
                }
                const url =
                    resolved && typeof resolved === 'object' && typeof (resolved as any).url === 'string'
                        ? ((resolved as any).url as string)
                        : null;
                return !!(url && detectSourceKindFromUrl(url) === 'video');
            }),
        [layers],
    );
```

Replace the inner body with:

```ts
    const hasVideo = useMemo(
        () =>
            layers.some(({ layer, resolved }) => {
                if (!layer.visible) return false;
                if (resolved && typeof resolved === 'object' && (resolved as any).graph) return true;
                const url =
                    resolved && typeof resolved === 'object' && typeof (resolved as any).url === 'string'
                        ? ((resolved as any).url as string)
                        : null;
                return !!(url && detectSourceKindFromUrl(url) === 'video');
            }),
        [layers],
    );
```

- [ ] **Step 6: Typecheck**

```powershell
npx tsc --noEmit
```

Expected: no new errors. If `LayerCanvas` is referenced anywhere else, the compiler will flag it — delete those usages too.

- [ ] **Step 7: Manual smoke**

Reload browser. Repeat both blur scenarios from prior tasks. Also build `MediaInput (image) → Compositor` and confirm the image still composites. The Compositor → Compositor chained case (compositor A's output feeding compositor B) should still play via `LayerSubgraph`.

- [ ] **Step 8: Commit**

```powershell
git add lib/nodes/plugins/compositor/ui/Renderer.tsx
git commit -m "refactor(compositor): delete LayerCanvas push-model fallback"
```

---

## Task 5: Compositor component — stop publishing `cssFilter` and `canvas` checks

**Files:**
- Modify: [lib/nodes/plugins/compositor/component.tsx](lib/nodes/plugins/compositor/component.tsx)

- [ ] **Step 1: Remove `cssFilter: ''` from the published envelope**

Locate the `setNodeOutput(id, { … })` call inside the `useEffect` that publishes the graph (around line 736-746). Currently:

```ts
        setNodeOutput(id, {
            type: 'video',
            data: [{
                url: '',
                graph: publishedGraph,
                cssFilter: '',
                resolution: { width: canvasW, height: canvasH },
                metadata: { source: 'Compositor', processedBy: 'GraphLive' },
            }],
        });
```

Replace with:

```ts
        setNodeOutput(id, {
            type: 'video',
            data: [{
                url: '',
                graph: publishedGraph,
                resolution: { width: canvasW, height: canvasH },
                metadata: { source: 'Compositor', processedBy: 'GraphLive' },
            }],
        });
```

- [ ] **Step 2: Remove the `canvas instanceof HTMLCanvasElement` check in `outputKind`**

Find the `outputKind` `useMemo` (around line 595). Currently:

```ts
    const outputKind = useMemo<'image' | 'video' | null>(() => {
        let sawImage = false;
        for (const { resolved } of renderable) {
            if (resolved && typeof resolved === 'object' && (resolved as any).canvas instanceof HTMLCanvasElement) {
                return 'video';
            }
            const url =
                resolved && typeof resolved === 'object' && typeof (resolved as any).url === 'string'
                    ? ((resolved as any).url as string)
                    : null;
            if (!url) continue;
            const kind = detectSourceKindFromUrl(url);
            if (kind === 'video') return 'video';
            if (kind === 'image') sawImage = true;
        }
        return sawImage ? 'image' : null;
    }, [renderable]);
```

Replace with — the `canvas` branch is gone; we also pick up `graph` upstreams (which behave as video):

```ts
    const outputKind = useMemo<'image' | 'video' | null>(() => {
        let sawImage = false;
        for (const { resolved } of renderable) {
            if (resolved && typeof resolved === 'object' && (resolved as any).graph) {
                return 'video';
            }
            const url =
                resolved && typeof resolved === 'object' && typeof (resolved as any).url === 'string'
                    ? ((resolved as any).url as string)
                    : null;
            if (!url) continue;
            const kind = detectSourceKindFromUrl(url);
            if (kind === 'video') return 'video';
            if (kind === 'image') sawImage = true;
        }
        return sawImage ? 'image' : null;
    }, [renderable]);
```

Why the `graph` check: a layer whose upstream is a `kind: 'filter'` graph (e.g. Blur in front of a video) should still classify the compositor's output as video. The prior `canvas instanceof HTMLCanvasElement` was the legacy way; the new way is to check for `graph`.

- [ ] **Step 3: Typecheck**

```powershell
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Manual smoke**

Reload browser. Build `MediaInput (video) → Blur → Compositor`. Confirm the compositor's output handle label says "Video" (not "Media" or "Image") — that's `outputKind` correctly recognizing the filtered-graph upstream. Then add a downstream node (another Blur or AI Generator) and confirm the wire connection is offered.

- [ ] **Step 5: Commit**

```powershell
git add lib/nodes/plugins/compositor/component.tsx
git commit -m "refactor(compositor): drop cssFilter from publish, classify graph upstream as video"
```

---

## Task 6: `useNodeAutoCompute` — update header comment

**Files:**
- Modify: [lib/hooks/use-node-auto-compute.ts](lib/hooks/use-node-auto-compute.ts)

The function body of `envelopeContentEqual` has no key-specific branches for `cssFilter` or `canvas` — it just iterates `Object.keys`. With the producer-side cleanups, those keys no longer appear. The function works unchanged. Only the JSDoc header needs to match the new contract.

- [ ] **Step 1: Update the JSDoc header**

Find the JSDoc above `function envelopeContentEqual(a: any, b: any): boolean {` (around lines 11-34). Replace the bullet list at the bottom of the JSDoc:

```ts
 * Comparison rules:
 *   - top-level: type + data array length
 *   - per data-item: shallow key compare
 *   - resolution {width,height}: compared by value (it's commonly a fresh
 *     object literal but trivially shallow-comparable)
 *   - graph / canvas / stream / other live-signal handles: ref equality
 *     (upstream stabilization makes these stable by reference when content
 *     hasn't changed; if a writer doesn't follow that contract, we
 *     pessimistically treat the envelope as changed — correct fallback)
 */
```

With:

```ts
 * Comparison rules:
 *   - top-level: type + data array length
 *   - per data-item: shallow key compare
 *   - resolution {width,height}: compared by value (it's commonly a fresh
 *     object literal but trivially shallow-comparable)
 *   - graph (the sole live-signal shape): ref equality. Publishers
 *     stabilize the graph reference via content-equality at their publish
 *     site, so identical content produces identical reference. If a writer
 *     doesn't follow that contract, we pessimistically treat the envelope
 *     as changed — correct fallback.
 */
```

- [ ] **Step 2: Typecheck**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```powershell
git add lib/hooks/use-node-auto-compute.ts
git commit -m "docs(use-node-auto-compute): reflect single-graph live-signal contract"
```

---

## Task 7: Update skill reference docs

**Files:**
- Modify: `.claude/skills/create-ephemeral-node/references/live-data-flow.md`
- Modify: `.claude/skills/create-ephemeral-node/references/node-recipes.md`
- Modify: `.claude/skills/update-ephemeral-node/references/change-types.md`

These docs guide future plugin authors. They currently document the legacy multi-shape envelope. Update them to match the one-graph contract.

- [ ] **Step 1: Read each doc and locate the envelope-shape sections**

Read all three files. Identify sections that describe:
- The shape of `nodeOutputs[id]`
- How an ephemeral node should emit its output
- The `cssFilter` sibling field and/or `canvas` ref usage

- [ ] **Step 2: Rewrite `live-data-flow.md`'s envelope contract**

The doc should describe the new contract in roughly these terms:

> **Live ephemeral output contract**
>
> Every ephemeral node publishes into `nodeOutputs[id]` an envelope of the shape:
>
> ```ts
> { type: 'image' | 'video' | 'text', data: [{ url?, graph?, resolution?, metadata? }] }
> ```
>
> Exactly one of `url` (static asset) or `graph` (live `GraphDescription`) is set per data item; `text`-typed envelopes use `data: [string]` directly.
>
> When your node's upstream is itself live (a Compositor's published graph, or another filter wrapping one), wrap that upstream in a `{ kind: 'filter', upstream, cssFilter }` graph and publish that. When your node's upstream is a raw URL, synthesize a 1-layer compositor graph around it first (see [lib/nodes/plugins/blur/executor.client.ts](lib/nodes/plugins/blur/executor.client.ts) for the reference pattern), then wrap that in your filter graph. Result: your node always emits a `GraphDescription`. Downstream sees exactly one shape.
>
> Do NOT publish a sibling `cssFilter: string` field on the envelope. Do NOT publish a raw `HTMLCanvasElement` reference. Both shapes were removed in 2026-05.

Adjust the surrounding prose in the doc so it reads naturally — these aren't necessarily verbatim paragraphs to paste, but the content above must all be reflected.

- [ ] **Step 3: Update `node-recipes.md`'s video-aware recipe**

Find the recipe(s) showing how to author a video-aware filter node (Blur is the template). Update the code sample to show:
1. Importing `GraphDescription` from `../compositor/shared`.
2. Importing `CompositorLayer` from `../compositor/definition`.
3. The synthesis helper (`wrapUrlAsCompositorGraph` pattern from Task 2 Step 3).
4. The envelope return: `{ type: 'video', data: [{ url: '', graph: filterGraph, resolution }] }` — no sibling `cssFilter`.

- [ ] **Step 4: Update `change-types.md`**

If this doc lists the envelope shapes that updates can flow through, remove `cssFilter` and `canvas` from any enumeration. Add a note that as of 2026-05 the envelope contract collapsed to graph / url / text.

- [ ] **Step 5: Commit**

```powershell
git add .claude/skills/create-ephemeral-node/references/live-data-flow.md `
        .claude/skills/create-ephemeral-node/references/node-recipes.md `
        .claude/skills/update-ephemeral-node/references/change-types.md
git commit -m "docs(skills): collapse ephemeral envelope to single-graph contract"
```

---

## Task 8: Final integration check

- [ ] **Step 1: Confirm no stale references remain**

Run (PowerShell):

```powershell
rg -n "cssFilter" lib --type ts --type tsx
```

Expected matches — and ONLY these:

- `lib/nodes/plugins/blur/executor.client.ts` — the local `ownFilter` variable name, the `blurFilterString` import. NO sibling envelope field.
- `lib/nodes/plugins/blur/shared.ts` — `blurFilterString` helper definition.
- `lib/nodes/plugins/compositor/graph-renderer.ts` — internal use inside the `kind: 'filter'` graph handling. KEEP.
- `lib/nodes/plugins/compositor/shared.ts` — the `cssFilter` field of `GraphDescription` (filter kind). KEEP.

If any other match appears, address it.

```powershell
rg -n "LayerCanvas|\.canvas\s+instanceof\s+HTMLCanvasElement" lib --type ts --type tsx
```

Expected: zero matches.

- [ ] **Step 2: Full typecheck pass**

```powershell
npx tsc --noEmit
```

Expected: error count is the same as it was before Task 1 (i.e., no new errors introduced).

- [ ] **Step 3: Manual smoke — all five scenarios from the spec**

In the browser:

1. MediaInput (image) → Compositor → preview shows image.
2. MediaInput (video) → Compositor → preview plays, scrub works.
3. MediaInput (video) → Blur → Compositor → preview plays with blur applied.
4. MediaInput (video) → Compositor A → Blur → Compositor B → B plays with A's pixels blurred, B has its own playhead independent of A.
5. AI Generator (after Run) → Compositor → preview shows generated image / video.
6. Two compositors fed from the same upstream MediaInput video — scrubbing one does not move the other.

Watch the browser console during 60 seconds of interaction (drag layers, scrub, adjust blur radius). Expect zero new errors.

- [ ] **Step 4: If any smoke scenario regressed, stop and debug**

Do not declare done with a regression. Use [systematic-debugging](.claude/skills) if the issue isn't obvious within 10 minutes.

- [ ] **Step 5: Final commit only if there were corrective edits in step 4**

If steps 1-3 passed without changes, skip. If step 4 produced fixes:

```powershell
git add <files>
git commit -m "fix(envelope): <specific regression description>"
```

---

## Definition of done (from spec)

- [ ] `LayerCanvas` source no longer exists.
- [ ] No file in `lib/nodes/plugins/` emits an envelope data item containing the literal key `cssFilter`.
- [ ] No file in `lib/nodes/plugins/` or `lib/hooks/` reads the literal key `cssFilter` off an envelope data item (internal `kind: 'filter'` graph reads are not envelope reads — they're graph-internal).
- [ ] Compositor's `outputKind` has no `HTMLCanvasElement` check.
- [ ] All six smoke scenarios in Task 8 Step 3 pass.
- [ ] `npx tsc --noEmit` clean (or no worse than baseline).
- [ ] Skill reference docs updated.
