# Compositor Card Preview — WebGL2 Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the compositor *card preview's* Konva/Canvas-2D compositing path with a WebGL2 compositor that uploads detached `<video>` frames as GPU textures, blends layers in a shader, and presents via a single `drawImage` to a visible 2D `<canvas>`. Matches the Weavy pipeline observed in the user's runtime instrumentation: *"hardware-decoded off-DOM `<video>` → `texImage2D` into WebGL2 → shader composite on an offscreen canvas → one `drawImage` to the on-screen canvas, driven by the video's own playback clock."*

**Why this and not other options:**
- **Native `<video>` DOM layers** (extract_frame's model): only works cleanly for a single video without compositing — can't do multi-layer blend modes / crops faithfully via CSS.
- **Resolution cap alone**: already shipped, didn't help → fill rate isn't the bottleneck; per-frame `drawImage(video,…)` + Konva scene walk + 2D `globalCompositeOperation` is.
- **WebGL2 with `texImage2D(video)`**: matches Weavy 1:1; GPU does the compositing, CPU just orchestrates.

**Architecture:**
- New `WebGLCardCompositor` class (one new file) owns an offscreen WebGL2 canvas, a quad VBO, a shader program with per-layer transform/opacity/crop/blend-mode uniforms, a ping-pong framebuffer pair (for read-modify-write blend modes), and a texture cache keyed by source.
- New per-layer source-resolution hooks in `LivePreview` resolve each renderable layer to a ready-to-upload element: pooled `<video>` (already-existing video pool), cached `<img>`, or a per-layer scratch `<canvas>` for text and subgraph layers.
- `LivePreview` switches from `<Stage>` (Konva) to a single visible `<canvas>` driven by an rAF loop that calls `compositor.render(descriptors, …)` each frame.
- Slider clock: already rVFC-driven from the master video in the previous change set; no change needed.
- **Out of scope:** Editor modal (stays Konva — needs interactive transformer). Pull-model `paintGraphFrame` and downstream blur preview (stay Canvas-2D — separate follow-up).

**Tech Stack:** WebGL2 (browser API, no npm deps), TypeScript, React. Existing `video-pool.ts`, `paintGraphFrame` (for subgraphs), `formatTimecode`, etc. reused unchanged.

**Verification:** Per repo memory ([CLAUDE.md auto-memory](C:/Users/user/.claude/projects/c--Projects-Prisfol-PrismAi/memory/MEMORY.md)), `npm run lint`/`next build` are flaky in this repo — use `npx tsc --noEmit` for type-checks. Functional verification is **manual browser testing** (no test runner exists; ad-hoc scripts in `scripts/` aren't a test suite).

**A/B safety:** Every task lands behind a `localStorage.prismCompositorRenderer` flag with `'konva'` as default until Task 9. Flip to `'webgl'` to test, back to `'konva'` to revert without redeploy.

---

## File map (new + modified)

**New:**
- `lib/nodes/plugins/compositor/webgl/compositor.ts` — `WebGLCardCompositor` class.
- `lib/nodes/plugins/compositor/webgl/shaders.ts` — GLSL strings (vertex + fragment with blend-mode switch).
- `lib/nodes/plugins/compositor/webgl/sources.ts` — React hooks: `useVideoLayerSources`, `useImageLayerSources`, `useTextLayerSources`, `useSubgraphLayerSources`.
- `lib/nodes/plugins/compositor/webgl/types.ts` — `LayerDescriptor`, `LayerSource`, `BlendMode` enum/union.

**Modified:**
- `lib/nodes/plugins/compositor/component.tsx` — `LivePreview` gets a WebGL branch behind the flag. Wall-clock + master-video rVFC clock kept as-is.
- `lib/nodes/plugins/compositor/video-pool.ts` — stop appending pooled `<video>` to `document.body` (Task 10). Small, optional cleanup.

**Untouched (explicitly):**
- `lib/nodes/plugins/compositor/ui/Renderer.tsx` — shared Konva renderer, still used by editor modal.
- `lib/nodes/plugins/compositor/ui/EditorModal.tsx` — interactive editor, stays Konva.
- `lib/nodes/plugins/compositor/graph-renderer.ts` (`paintGraphFrame`) — pull-model still used by downstream `blur/component.tsx` and by `useSubgraphLayerSources` to paint subgraph layer scratch canvases.

---

## Task 1: Feature flag + folder scaffolding

**Files:**
- Create: `lib/nodes/plugins/compositor/webgl/types.ts` (skeleton only)
- Modify: `lib/nodes/plugins/compositor/component.tsx` (add flag helper alongside `previewResCapped`)

- [ ] **Step 1: Create the webgl folder with a minimal types file**

```ts
// lib/nodes/plugins/compositor/webgl/types.ts
export type BlendMode =
    | 'source-over' | 'multiply' | 'screen' | 'overlay'
    | 'darken' | 'lighten' | 'color-dodge' | 'color-burn'
    | 'hard-light' | 'soft-light' | 'difference' | 'exclusion';

export interface LayerSourceVideo { kind: 'video'; el: HTMLVideoElement; }
export interface LayerSourceImage { kind: 'image'; el: HTMLImageElement; }
export interface LayerSourceCanvas { kind: 'canvas'; el: HTMLCanvasElement; version: number; }
export type LayerSource = LayerSourceVideo | LayerSourceImage | LayerSourceCanvas;

export interface LayerDescriptor {
    id: string;                        // stable per layer
    source: LayerSource;
    transform: {
        x: number; y: number; width: number; height: number;
        rotation: number;              // degrees
        flipX: boolean; flipY: boolean;
        opacity: number;               // 0..1
        blendMode: BlendMode;
        crop?: { x: number; y: number; width: number; height: number } | null;
    };
    sourceWidth: number;               // intrinsic (videoWidth / naturalWidth / canvas.width)
    sourceHeight: number;
}
```

- [ ] **Step 2: Add the renderer-mode flag helper to component.tsx**

Add just below the existing `maxPreviewDpr()` function:

```ts
// 'webgl' switches the card preview to the new WebGL2 compositor (Weavy-style).
// Default 'konva' until Task 9. Override via:
//   localStorage.prismCompositorRenderer = 'webgl' (or 'konva')
function cardRendererMode(): 'konva' | 'webgl' {
    if (typeof window === 'undefined') return 'konva';
    try {
        return window.localStorage.getItem('prismCompositorRenderer') === 'webgl'
            ? 'webgl' : 'konva';
    } catch {
        return 'konva';
    }
}
```

- [ ] **Step 3: Add a one-shot log when the WebGL flag is on**

In the existing `loggedResRef` effect inside `LivePreview`, extend the log payload:

```ts
console.log('[compositor:preview-res]', {
    mode: previewResCapped() ? 'capped' : 'full',
    renderer: cardRendererMode(),
    display: `${Math.round(size.width)}×${Math.round(size.height)}`,
    backing: `${Math.round(size.width * previewPixelRatio)}×${Math.round(size.height * previewPixelRatio)}`,
    source: `${canvasWidth}×${canvasHeight}`,
    pixelRatio: Number(previewPixelRatio.toFixed(3)),
});
```

- [ ] **Step 4: Type-check + commit**

Run: `npx tsc --noEmit`
Expected: clean (no output).

```bash
git add lib/nodes/plugins/compositor/webgl/types.ts lib/nodes/plugins/compositor/component.tsx
git commit -m "feat(compositor): webgl card-preview scaffolding + flag"
```

---

## Task 2: WebGL compositor skeleton (init + clear + present)

**Files:**
- Create: `lib/nodes/plugins/compositor/webgl/compositor.ts`

- [ ] **Step 1: Write the skeleton class**

```ts
// lib/nodes/plugins/compositor/webgl/compositor.ts
'use client';

/**
 * WebGL2 compositor for the compositor node's card preview. Mirrors Weavy's
 * pipeline: per frame, upload each layer's source (video / image / canvas)
 * as a GPU texture, composite into an offscreen FBO via a shader (one pass
 * per layer with the destination read back from the accumulator FBO, so
 * non-trivial blend modes work), then blit the result to a visible 2D
 * <canvas> via a single drawImage.
 *
 * The compositor doesn't know how layer sources are produced — caller passes
 * ready-to-upload elements per frame (see `webgl/sources.ts`).
 */

import { LayerDescriptor } from './types';

export class WebGLCardCompositor {
    private visible: HTMLCanvasElement;
    private visibleCtx: CanvasRenderingContext2D;
    private offscreen: HTMLCanvasElement;
    private gl: WebGL2RenderingContext;
    private width = 1;
    private height = 1;

    constructor(visible: HTMLCanvasElement) {
        this.visible = visible;
        const vctx = visible.getContext('2d');
        if (!vctx) throw new Error('WebGLCardCompositor: visible canvas missing 2D context');
        this.visibleCtx = vctx;

        this.offscreen = document.createElement('canvas'); // detached, off-DOM
        const gl = this.offscreen.getContext('webgl2', { premultipliedAlpha: true, alpha: true });
        if (!gl) throw new Error('WebGLCardCompositor: WebGL2 unavailable');
        this.gl = gl;
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // canvas Y is down; texImage2D Y is up
    }

    setSize(w: number, h: number): void {
        const W = Math.max(1, Math.round(w));
        const H = Math.max(1, Math.round(h));
        if (this.width === W && this.height === H) return;
        this.width = W;
        this.height = H;
        this.offscreen.width = W;
        this.offscreen.height = H;
        this.visible.width = W;
        this.visible.height = H;
        this.gl.viewport(0, 0, W, H);
    }

    /** Render a list of layers + base fill into the offscreen, then present. */
    render(_layers: LayerDescriptor[], baseFillRgba: [number, number, number, number]): void {
        const gl = this.gl;
        gl.clearColor(baseFillRgba[0], baseFillRgba[1], baseFillRgba[2], baseFillRgba[3]);
        gl.clear(gl.COLOR_BUFFER_BIT);
        // Layers drawn in Task 4+.
        this.present();
    }

    private present(): void {
        // Blit offscreen WebGL canvas → visible 2D canvas, once per frame.
        this.visibleCtx.clearRect(0, 0, this.width, this.height);
        this.visibleCtx.drawImage(this.offscreen, 0, 0);
    }

    dispose(): void {
        // GL objects created in later tasks freed here; this is the catch-all.
        const gl = this.gl;
        const loseCtx = gl.getExtension('WEBGL_lose_context');
        loseCtx?.loseContext();
    }
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add lib/nodes/plugins/compositor/webgl/compositor.ts
git commit -m "feat(compositor): webgl compositor skeleton (init, clear, present)"
```

---

## Task 3: Shader program + textured quad

**Files:**
- Create: `lib/nodes/plugins/compositor/webgl/shaders.ts`
- Modify: `lib/nodes/plugins/compositor/webgl/compositor.ts`

- [ ] **Step 1: Write the shader sources**

```ts
// lib/nodes/plugins/compositor/webgl/shaders.ts

/**
 * Vertex shader. Receives a unit quad (positions ∈ [0,1]) and a per-draw
 * transform that maps it to the layer's canvas-space rectangle. The fragment
 * shader receives the unit UV — we apply crop (sub-rect of the source) via a
 * uniform `uCrop` of (uMin, vMin, uMax, vMax) so the texture-coord math stays
 * in one place.
 */
export const VERT_SRC = /* glsl */ `#version 300 es
precision highp float;

in vec2 aPos;         // 0..1 unit quad
out vec2 vUv;         // 0..1 unit UV
uniform mat3 uModel;  // canvas-space transform
uniform vec2 uCanvasSize;

void main() {
    vec3 p = uModel * vec3(aPos, 1.0);                // canvas px
    vec2 ndc = (p.xy / uCanvasSize) * 2.0 - 1.0;       // NDC
    gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);       // flip Y for canvas convention
    vUv = aPos;
}`;

/**
 * Fragment shader. Samples the layer texture with crop, optionally blends
 * against the destination accumulator (Task 6). For now: simple alpha
 * source-over (premultiplied).
 */
export const FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTex;        // layer source
uniform vec4 uCrop;            // (uMin, vMin, uMax, vMax)
uniform float uOpacity;        // 0..1
uniform int uBlendMode;        // 0 = source-over only (others in Task 6)

void main() {
    vec2 uv = mix(uCrop.xy, uCrop.zw, vUv);
    vec4 src = texture(uTex, uv);
    src.rgb *= uOpacity;
    src.a   *= uOpacity;
    outColor = src;
}`;
```

- [ ] **Step 2: Add program/quad setup to compositor.ts**

Add inside `WebGLCardCompositor`:

```ts
import { VERT_SRC, FRAG_SRC } from './shaders';

// fields
private program!: WebGLProgram;
private quadVbo!: WebGLBuffer;
private aPosLoc = 0;
private uModelLoc!: WebGLUniformLocation;
private uCanvasSizeLoc!: WebGLUniformLocation;
private uTexLoc!: WebGLUniformLocation;
private uCropLoc!: WebGLUniformLocation;
private uOpacityLoc!: WebGLUniformLocation;
private uBlendModeLoc!: WebGLUniformLocation;
```

Initialize in the constructor (after the `pixelStorei` calls):

```ts
this.program = this.linkProgram(VERT_SRC, FRAG_SRC);
this.quadVbo = this.gl.createBuffer()!;
const gl = this.gl;
gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    0, 0,  1, 0,  0, 1,
    0, 1,  1, 0,  1, 1,
]), gl.STATIC_DRAW);
gl.useProgram(this.program);
this.uModelLoc      = gl.getUniformLocation(this.program, 'uModel')!;
this.uCanvasSizeLoc = gl.getUniformLocation(this.program, 'uCanvasSize')!;
this.uTexLoc        = gl.getUniformLocation(this.program, 'uTex')!;
this.uCropLoc       = gl.getUniformLocation(this.program, 'uCrop')!;
this.uOpacityLoc    = gl.getUniformLocation(this.program, 'uOpacity')!;
this.uBlendModeLoc  = gl.getUniformLocation(this.program, 'uBlendMode')!;
gl.uniform1i(this.uTexLoc, 0);
```

Add the compile helper:

```ts
private linkProgram(vSrc: string, fSrc: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(s);
            gl.deleteShader(s);
            throw new Error(`shader compile failed: ${log}`);
        }
        return s;
    };
    const v = compile(gl.VERTEX_SHADER, vSrc);
    const f = compile(gl.FRAGMENT_SHADER, fSrc);
    const p = gl.createProgram()!;
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(p);
        gl.deleteProgram(p);
        throw new Error(`program link failed: ${log}`);
    }
    gl.deleteShader(v);
    gl.deleteShader(f);
    return p;
}
```

- [ ] **Step 3: Add `drawTexturedQuad` helper**

```ts
private drawTexturedQuad(
    tex: WebGLTexture,
    transform: Float32Array,          // 3x3 mat (canvas-space)
    crop: [number, number, number, number],
    opacity: number,
    blendMode: number,
): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.enableVertexAttribArray(this.aPosLoc);
    gl.vertexAttribPointer(this.aPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniformMatrix3fv(this.uModelLoc, false, transform);
    gl.uniform2f(this.uCanvasSizeLoc, this.width, this.height);
    gl.uniform4f(this.uCropLoc, crop[0], crop[1], crop[2], crop[3]);
    gl.uniform1f(this.uOpacityLoc, opacity);
    gl.uniform1i(this.uBlendModeLoc, blendMode);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
}
```

- [ ] **Step 4: Smoke verify by drawing a known texture**

Temporarily, inside `render()`, replace the empty layer placeholder with: create a 1×1 magenta texture and `drawTexturedQuad` over a `100×100` rect at `(10,10)` of canvas. Verify it appears when wired in Task 8. (Revert before commit — this is mental rehearsal, not a code change to land.)

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit
git add lib/nodes/plugins/compositor/webgl/shaders.ts lib/nodes/plugins/compositor/webgl/compositor.ts
git commit -m "feat(compositor): webgl shader program + textured quad helper"
```

---

## Task 4: Per-layer transform pipeline

**Files:**
- Modify: `lib/nodes/plugins/compositor/webgl/compositor.ts`

- [ ] **Step 1: Add a CPU-side matrix builder**

Add to compositor.ts (private helper, no GLSL change — the shader already takes `uModel`):

```ts
/**
 * Build a 3×3 transform mapping the unit quad to the layer's canvas-space
 * rectangle. Mirrors Konva's pivot semantics: rotate/flip around the layer's
 * centre, then translate to (x, y).
 */
private buildModelMatrix(t: LayerDescriptor['transform']): Float32Array {
    const w = Math.max(1, t.width);
    const h = Math.max(1, t.height);
    const cx = t.x + w / 2;
    const cy = t.y + h / 2;
    const rad = (t.rotation || 0) * Math.PI / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const sx = (t.flipX ? -1 : 1) * w;
    const sy = (t.flipY ? -1 : 1) * h;
    // Steps: translate(-0.5,-0.5) → scale(sx,sy) → rotate(rad) → translate(cx,cy)
    // Composed column-major (WebGL convention).
    const m00 = c * sx;
    const m01 = s * sx;
    const m10 = -s * sy;
    const m11 = c * sy;
    const tx = cx - 0.5 * (m00 + m10);
    const ty = cy - 0.5 * (m01 + m11);
    return new Float32Array([
        m00, m01, 0,
        m10, m11, 0,
        tx,  ty,  1,
    ]);
}
```

(`import { LayerDescriptor } from './types';` at the top of compositor.ts.)

- [ ] **Step 2: Build crop UVs from descriptor**

```ts
private buildCropUv(d: LayerDescriptor): [number, number, number, number] {
    const sw = Math.max(1, d.sourceWidth);
    const sh = Math.max(1, d.sourceHeight);
    if (!d.transform.crop) return [0, 0, 1, 1];
    const cx = d.transform.crop.x / sw;
    const cy = d.transform.crop.y / sh;
    const cw = d.transform.crop.width / sw;
    const ch = d.transform.crop.height / sh;
    return [cx, cy, cx + cw, cy + ch];
}
```

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit
git add lib/nodes/plugins/compositor/webgl/compositor.ts
git commit -m "feat(compositor): webgl per-layer transform + crop helpers"
```

---

## Task 5: Texture cache + per-frame upload

**Files:**
- Modify: `lib/nodes/plugins/compositor/webgl/compositor.ts`

- [ ] **Step 1: Add a cache keyed by source element identity**

```ts
// field
private textures = new Map<HTMLVideoElement | HTMLImageElement | HTMLCanvasElement, {
    tex: WebGLTexture;
    lastVersion: number; // for canvas sources; -1 for video (always re-upload)
}>();
```

- [ ] **Step 2: Upload helper**

```ts
/**
 * Returns a GL texture for the source, uploading the current frame if needed.
 * For video: re-upload every call (frame may have changed).
 * For image: upload once on first acquire (loaded images are immutable).
 * For canvas: upload when `version` changes (caller increments on repaint).
 *
 * Caller MUST ensure video sources have readyState >= 2 before calling.
 */
private acquireTexture(source: LayerSource): WebGLTexture | null {
    const gl = this.gl;
    let entry = this.textures.get(source.el);

    if (!entry) {
        const tex = gl.createTexture();
        if (!tex) return null;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        entry = { tex, lastVersion: -2 };
        this.textures.set(source.el, entry);
    }

    gl.bindTexture(gl.TEXTURE_2D, entry.tex);

    if (source.kind === 'video') {
        // Video frames change every call; always re-upload. Skip if not ready.
        const v = source.el;
        if (v.readyState < 2 || v.videoWidth === 0) return null;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
        return entry.tex;
    }
    if (source.kind === 'image') {
        const img = source.el;
        if (!img.complete || img.naturalWidth === 0) return null;
        if (entry.lastVersion === -2) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            entry.lastVersion = 0;
        }
        return entry.tex;
    }
    // canvas
    const can = source.el;
    if (can.width === 0 || can.height === 0) return null;
    if (entry.lastVersion !== source.version) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, can);
        entry.lastVersion = source.version;
    }
    return entry.tex;
}
```

(Add `import { LayerSource } from './types';`.)

- [ ] **Step 3: Free textures on dispose; evict stale entries on render**

In `dispose()`:

```ts
this.textures.forEach(({ tex }) => this.gl.deleteTexture(tex));
this.textures.clear();
```

In `render()`, after drawing, evict any cached entry whose source isn't in the current frame's descriptor set (so memory doesn't grow):

```ts
const seen = new Set<HTMLElement>(_layers.map(l => l.source.el as any));
for (const k of Array.from(this.textures.keys())) {
    if (!seen.has(k as any)) {
        const entry = this.textures.get(k)!;
        this.gl.deleteTexture(entry.tex);
        this.textures.delete(k);
    }
}
```

- [ ] **Step 4: Type-check + commit**

```bash
npx tsc --noEmit
git add lib/nodes/plugins/compositor/webgl/compositor.ts
git commit -m "feat(compositor): webgl texture cache + per-source upload policy"
```

---

## Task 6: Blend modes via ping-pong framebuffers

**Files:**
- Modify: `lib/nodes/plugins/compositor/webgl/shaders.ts` (fragment)
- Modify: `lib/nodes/plugins/compositor/webgl/compositor.ts`

Background: GLSL can't read the framebuffer it's writing to in WebGL2 (no EXT_shader_framebuffer_fetch). The standard fix is **ping-pong**: two FBOs A/B; one is the "destination" (read as a texture), one is the "render target." After each layer, swap. This means the shader receives both `uSrcTex` (layer) and `uDstTex` (accumulator) and computes the blend manually — `gl.blendFunc` doesn't support the modes we need.

- [ ] **Step 1: Extend the fragment shader with blend formulas**

Replace `FRAG_SRC` in `webgl/shaders.ts`:

```ts
export const FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTex;       // layer source
uniform sampler2D uDst;       // destination accumulator (previous composite)
uniform vec4 uCrop;
uniform float uOpacity;
uniform int uBlendMode;       // see BLEND_* constants below
uniform vec2 uCanvasSize;

// Separable blend functions per channel. Inputs are non-premultiplied RGB.
float blendChannel(float Cs, float Cb, int mode) {
    if (mode == 0)  return Cs;                                              // source-over (handled at alpha-compose stage)
    if (mode == 1)  return Cs * Cb;                                         // multiply
    if (mode == 2)  return 1.0 - (1.0 - Cs) * (1.0 - Cb);                    // screen
    if (mode == 3) {                                                        // overlay = hard-light(Cb, Cs)
        return Cb < 0.5 ? 2.0 * Cs * Cb : 1.0 - 2.0 * (1.0 - Cs) * (1.0 - Cb);
    }
    if (mode == 4)  return min(Cs, Cb);                                     // darken
    if (mode == 5)  return max(Cs, Cb);                                     // lighten
    if (mode == 6)  return Cs >= 1.0 ? 1.0 : min(1.0, Cb / (1.0 - Cs));     // color-dodge
    if (mode == 7)  return Cs <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - Cb) / Cs); // color-burn
    if (mode == 8) {                                                        // hard-light
        return Cs < 0.5 ? 2.0 * Cs * Cb : 1.0 - 2.0 * (1.0 - Cs) * (1.0 - Cb);
    }
    if (mode == 9) {                                                        // soft-light (W3C Compositing spec)
        float d;
        if (Cb <= 0.25) d = ((16.0 * Cb - 12.0) * Cb + 4.0) * Cb;
        else            d = sqrt(Cb);
        return Cs <= 0.5
            ? Cb - (1.0 - 2.0 * Cs) * Cb * (1.0 - Cb)
            : Cb + (2.0 * Cs - 1.0) * (d - Cb);
    }
    if (mode == 10) return abs(Cs - Cb);                                    // difference
    if (mode == 11) return Cs + Cb - 2.0 * Cs * Cb;                          // exclusion
    return Cs;
}

void main() {
    vec2 uv = mix(uCrop.xy, uCrop.zw, vUv);
    vec4 srcPre = texture(uTex, uv);
    srcPre.rgb *= uOpacity;
    srcPre.a   *= uOpacity;

    // Sample the accumulator at this fragment's screen-space position.
    vec2 dstUv = gl_FragCoord.xy / uCanvasSize;
    vec4 dstPre = texture(uDst, dstUv);

    // Unpremultiply for the blend math, then re-composite. This matches the
    // W3C compositing spec for non-source-over modes.
    vec3 Cs = srcPre.a > 0.0 ? srcPre.rgb / srcPre.a : vec3(0.0);
    vec3 Cb = dstPre.a > 0.0 ? dstPre.rgb / dstPre.a : vec3(0.0);

    vec3 B;
    if (uBlendMode == 0) {
        B = Cs;
    } else {
        B = vec3(
            blendChannel(Cs.r, Cb.r, uBlendMode),
            blendChannel(Cs.g, Cb.g, uBlendMode),
            blendChannel(Cs.b, Cb.b, uBlendMode)
        );
    }

    // Porter-Duff source-over with the blended source colour.
    float aS = srcPre.a;
    float aB = dstPre.a;
    float aR = aS + aB * (1.0 - aS);
    vec3 mixed = mix(Cb, B, aB);              // dest colour with blend applied
    vec3 outRgb = mixed * aS + Cb * aB * (1.0 - aS);
    outColor = vec4(outRgb, aR);
}`;
```

- [ ] **Step 2: Add `uDst` uniform location wiring**

In compositor.ts constructor:

```ts
this.uDstLoc = gl.getUniformLocation(this.program, 'uDst')!;
gl.uniform1i(this.uDstLoc, 1);
```

Add `private uDstLoc!: WebGLUniformLocation;` field.

- [ ] **Step 3: Create ping-pong FBOs**

Add fields + setup helper:

```ts
private fboA!: WebGLFramebuffer;
private fboB!: WebGLFramebuffer;
private texA!: WebGLTexture;
private texB!: WebGLTexture;
private read: 'A' | 'B' = 'A';

private allocPingPong(w: number, h: number): void {
    const gl = this.gl;
    const make = () => {
        const t = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        const f = gl.createFramebuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        return { t, f };
    };
    const a = make();
    const b = make();
    this.texA = a.t; this.fboA = a.f;
    this.texB = b.t; this.fboB = b.f;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
```

Call `allocPingPong(W, H)` inside `setSize` whenever size changes (free old first):

```ts
// inside setSize, after assigning width/height:
if (this.fboA) {
    this.gl.deleteFramebuffer(this.fboA);
    this.gl.deleteFramebuffer(this.fboB);
    this.gl.deleteTexture(this.texA);
    this.gl.deleteTexture(this.texB);
}
this.allocPingPong(W, H);
```

- [ ] **Step 4: Rewrite `render` to ping-pong each layer**

```ts
render(layers: LayerDescriptor[], baseFillRgba: [number, number, number, number]): void {
    const gl = this.gl;

    // Clear the read FBO to base fill.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.read === 'A' ? this.fboA : this.fboB);
    gl.clearColor(baseFillRgba[0], baseFillRgba[1], baseFillRgba[2], baseFillRgba[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);

    for (const d of layers) {
        const tex = this.acquireTexture(d.source);
        if (!tex) continue;

        const readTex = this.read === 'A' ? this.texA : this.texB;
        const writeFbo = this.read === 'A' ? this.fboB : this.fboA;

        // Copy read → write so the destination accumulator carries through
        // areas the new layer doesn't cover. Cheap full-screen blit using the
        // same program with blend mode source-over and a unit-quad texture.
        gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, readTex);
        // Identity model covering the full canvas:
        this.drawTexturedQuad(
            readTex,
            this.buildIdentityFullCanvas(),
            [0, 0, 1, 1],
            1,
            0, // source-over
        );

        // Now draw the layer on top, with its blend mode and the accumulator
        // bound as uDst (texture unit 1).
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, readTex);
        gl.activeTexture(gl.TEXTURE0);
        const model = this.buildModelMatrix(d.transform);
        const crop = this.buildCropUv(d);
        const mode = blendModeToInt(d.transform.blendMode);
        this.drawTexturedQuad(tex, model, crop, d.transform.opacity, mode);

        // Swap.
        this.read = this.read === 'A' ? 'B' : 'A';
    }

    // Evict stale textures (Task 5 step 3).
    const seen = new Set<HTMLElement>(layers.map(l => l.source.el as any));
    for (const k of Array.from(this.textures.keys())) {
        if (!seen.has(k as any)) {
            const e = this.textures.get(k)!;
            this.gl.deleteTexture(e.tex);
            this.textures.delete(k);
        }
    }

    // Present the most-recent read FBO's texture to the visible canvas.
    this.presentFromTexture(this.read === 'A' ? this.texA : this.texB);
}

private buildIdentityFullCanvas(): Float32Array {
    return new Float32Array([
        this.width, 0, 0,
        0, this.height, 0,
        0, 0, 1,
    ]);
}

private presentFromTexture(tex: WebGLTexture): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.drawTexturedQuad(tex, this.buildIdentityFullCanvas(), [0, 0, 1, 1], 1, 0);
    // Then blit the offscreen canvas to the visible one.
    this.visibleCtx.clearRect(0, 0, this.width, this.height);
    this.visibleCtx.drawImage(this.offscreen, 0, 0);
}
```

Add the blend-mode mapper inside the file:

```ts
function blendModeToInt(m: import('./types').BlendMode): number {
    switch (m) {
        case 'source-over': return 0;
        case 'multiply':    return 1;
        case 'screen':      return 2;
        case 'overlay':     return 3;
        case 'darken':      return 4;
        case 'lighten':     return 5;
        case 'color-dodge': return 6;
        case 'color-burn':  return 7;
        case 'hard-light':  return 8;
        case 'soft-light':  return 9;
        case 'difference':  return 10;
        case 'exclusion':   return 11;
        default:            return 0;
    }
}
```

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit
git add lib/nodes/plugins/compositor/webgl/compositor.ts lib/nodes/plugins/compositor/webgl/shaders.ts
git commit -m "feat(compositor): webgl ping-pong blend-mode compositor"
```

---

## Task 7: Per-layer source resolution hooks

**Files:**
- Create: `lib/nodes/plugins/compositor/webgl/sources.ts`

These hooks live alongside `LivePreview`. Each returns a map of `layerId → LayerSource` (plus a stable identity so descriptors don't churn).

- [ ] **Step 1: Video sources (acquire pooled element, vote play/mute)**

```ts
// lib/nodes/plugins/compositor/webgl/sources.ts
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CompositorLayer } from '../definition';
import { acquireVideo, releaseVideo, setMuted, setPlayState } from '../video-pool';
import { GraphRenderCache, paintGraphFrame } from '../graph-renderer';
import { GraphDescription, graphDimensions, isLayerActiveAt } from '../shared';
import { LayerSource } from './types';

export interface ResolvedLayerForWebGL {
    layer: CompositorLayer;
    source: LayerSource;
    sourceWidth: number;
    sourceHeight: number;
}

export function useVideoLayerSources(
    layers: { layer: CompositorLayer; url: string; isActive: boolean }[],
    poolKey: string,
    isPlaying: boolean,
    muted: boolean,
): Map<string, { el: HTMLVideoElement; consumerId: number; w: number; h: number; ready: boolean }> {
    // Stable handle store keyed by layerId.
    const refsRef = useRef<Map<string, { url: string; el: HTMLVideoElement; consumerId: number }>>(new Map());
    const [tick, setTick] = useState(0);

    // Reconcile acquisitions on changes to (layerId, url).
    useEffect(() => {
        const refs = refsRef.current;
        const wanted = new Set(layers.map(l => l.layer.id));
        // Release ones no longer wanted OR whose url changed.
        for (const [id, entry] of Array.from(refs.entries())) {
            const layer = layers.find(l => l.layer.id === id);
            if (!layer || layer.url !== entry.url) {
                releaseVideo(entry.url, entry.consumerId, poolKey);
                refs.delete(id);
            }
        }
        // Acquire new.
        for (const l of layers) {
            if (refs.has(l.layer.id)) continue;
            const { el, id: cid } = acquireVideo(l.url, poolKey);
            refs.set(l.layer.id, { url: l.url, el, consumerId: cid });
        }
        setTick(t => t + 1);
        return () => { /* released on next reconcile or unmount-effect below */ };
    }, [layers.map(l => `${l.layer.id}:${l.url}`).join('|'), poolKey]);

    // Unmount cleanup: release everything.
    useEffect(() => () => {
        const refs = refsRef.current;
        for (const e of refs.values()) releaseVideo(e.url, e.consumerId, poolKey);
        refs.clear();
    }, [poolKey]);

    // Vote play/mute per acquired video.
    useEffect(() => {
        for (const l of layers) {
            const entry = refsRef.current.get(l.layer.id);
            if (!entry) continue;
            const wantsPlay = isPlaying && l.isActive;
            setPlayState(entry.url, entry.consumerId, wantsPlay, poolKey);
            setMuted(entry.url, entry.consumerId, muted || !l.isActive || !!l.layer.muted, poolKey);
        }
    }, [layers, isPlaying, muted, poolKey, tick]);

    // Build the read-only result map.
    return useMemo(() => {
        const out = new Map<string, { el: HTMLVideoElement; consumerId: number; w: number; h: number; ready: boolean }>();
        for (const l of layers) {
            const entry = refsRef.current.get(l.layer.id);
            if (!entry) continue;
            const el = entry.el;
            out.set(l.layer.id, {
                el,
                consumerId: entry.consumerId,
                w: el.videoWidth || 0,
                h: el.videoHeight || 0,
                ready: el.readyState >= 2 && el.videoWidth > 0,
            });
        }
        return out;
    }, [layers, tick]);
}
```

- [ ] **Step 2: Image sources (load once, cache)**

```ts
export function useImageLayerSources(
    layers: { layer: CompositorLayer; url: string }[],
): Map<string, { el: HTMLImageElement; w: number; h: number; ready: boolean }> {
    const cacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
    const [tick, setTick] = useState(0);
    useEffect(() => {
        const cache = cacheRef.current;
        for (const l of layers) {
            if (cache.has(l.url)) continue;
            const img = new Image();
            img.crossOrigin = 'anonymous';
            const safe = l.url.startsWith('data:')
                ? l.url
                : l.url + (l.url.includes('?') ? '&' : '?') + 'notaint=1';
            img.onload = () => setTick(t => t + 1);
            img.src = safe;
            cache.set(l.url, img);
        }
    }, [layers.map(l => l.url).join('|')]);
    return useMemo(() => {
        const out = new Map<string, { el: HTMLImageElement; w: number; h: number; ready: boolean }>();
        for (const l of layers) {
            const img = cacheRef.current.get(l.url);
            if (!img) continue;
            out.set(l.layer.id, {
                el: img,
                w: img.naturalWidth || 0,
                h: img.naturalHeight || 0,
                ready: img.complete && img.naturalWidth > 0,
            });
        }
        return out;
    }, [layers, tick]);
}
```

- [ ] **Step 3: Text sources (offscreen canvas per layer)**

```ts
export function useTextLayerSources(
    layers: { layer: CompositorLayer; text: string }[],
): Map<string, { el: HTMLCanvasElement; w: number; h: number; ready: boolean; version: number }> {
    const cacheRef = useRef<Map<string, { canvas: HTMLCanvasElement; key: string; version: number }>>(new Map());
    return useMemo(() => {
        const cache = cacheRef.current;
        const wanted = new Set<string>();
        const out = new Map<string, { el: HTMLCanvasElement; w: number; h: number; ready: boolean; version: number }>();
        for (const l of layers) {
            wanted.add(l.layer.id);
            const t = l.layer.transform;
            const w = Math.max(1, Math.round(t.width || 100));
            const h = Math.max(1, Math.round(t.height || 100));
            const fontSize = t.fontSize || 48;
            const fontWeight = (t as any).fontWeight || 'bold';
            const fontStyle = t.fontStyle || 'normal';
            const fontFamily = t.fontFamily || 'Inter';
            const fillColor = t.fillColor || '#ffffff';
            const align = t.textAlign || 'center';
            const key = `${w}|${h}|${fontSize}|${fontWeight}|${fontStyle}|${fontFamily}|${fillColor}|${align}|${l.text}`;
            let entry = cache.get(l.layer.id);
            if (!entry) {
                entry = { canvas: document.createElement('canvas'), key: '', version: 0 };
                cache.set(l.layer.id, entry);
            }
            if (entry.key !== key) {
                entry.canvas.width = w;
                entry.canvas.height = h;
                const ctx = entry.canvas.getContext('2d');
                if (ctx) {
                    ctx.clearRect(0, 0, w, h);
                    ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
                    ctx.fillStyle = fillColor;
                    ctx.textAlign = align as CanvasTextAlign;
                    ctx.textBaseline = 'middle';
                    const x = align === 'left' ? 0 : align === 'right' ? w : w / 2;
                    ctx.fillText(l.text, x, h / 2);
                }
                entry.key = key;
                entry.version += 1;
            }
            out.set(l.layer.id, { el: entry.canvas, w, h, ready: true, version: entry.version });
        }
        // Evict canvases for layers no longer present.
        for (const id of Array.from(cache.keys())) if (!wanted.has(id)) cache.delete(id);
        return out;
    }, [layers]);
}
```

- [ ] **Step 4: Subgraph sources (paintGraphFrame each frame)**

```ts
export function useSubgraphLayerSources(
    layers: { layer: CompositorLayer; graph: GraphDescription }[],
    playhead: number,
    isPlaying: boolean,
    poolKey: string,
    muted: boolean,
): Map<string, { el: HTMLCanvasElement; w: number; h: number; ready: boolean; version: number }> {
    interface Entry { canvas: HTMLCanvasElement; cache: GraphRenderCache; version: number; }
    const entriesRef = useRef<Map<string, Entry>>(new Map());
    const [tick, setTick] = useState(0);

    // Reconcile entries (create/destroy) when layer set changes.
    useEffect(() => {
        const entries = entriesRef.current;
        const wanted = new Set(layers.map(l => l.layer.id));
        for (const [id, e] of Array.from(entries.entries())) {
            if (!wanted.has(id)) {
                e.cache.dispose();
                entries.delete(id);
            }
        }
        for (const l of layers) {
            if (entries.has(l.layer.id)) continue;
            entries.set(l.layer.id, {
                canvas: document.createElement('canvas'),
                cache: new GraphRenderCache(`${poolKey}:${l.layer.id}`),
                version: 0,
            });
        }
        setTick(t => t + 1);
        return () => { /* deeper cleanup in unmount effect below */ };
    }, [layers.map(l => l.layer.id).join('|'), poolKey]);

    useEffect(() => () => {
        for (const e of entriesRef.current.values()) e.cache.dispose();
        entriesRef.current.clear();
    }, []);

    // Paint each entry on every render of the playhead. The compositor's main
    // rAF will call this hook implicitly through React state — but to avoid
    // doing the paint inside `useMemo`, we do it as an effect and bump tick.
    useEffect(() => {
        for (const l of layers) {
            const e = entriesRef.current.get(l.layer.id);
            if (!e) continue;
            const dims = graphDimensions(l.graph);
            if (e.canvas.width !== dims.width) e.canvas.width = Math.max(1, dims.width);
            if (e.canvas.height !== dims.height) e.canvas.height = Math.max(1, dims.height);
            const ctx = e.canvas.getContext('2d');
            if (!ctx) continue;
            e.cache.releaseAllScratch();
            paintGraphFrame(l.graph, playhead, ctx, e.cache, isPlaying, muted);
            e.version += 1;
        }
        setTick(t => t + 1);
    }, [layers, playhead, isPlaying, muted]);

    return useMemo(() => {
        const out = new Map<string, { el: HTMLCanvasElement; w: number; h: number; ready: boolean; version: number }>();
        for (const l of layers) {
            const e = entriesRef.current.get(l.layer.id);
            if (!e) continue;
            out.set(l.layer.id, {
                el: e.canvas,
                w: e.canvas.width,
                h: e.canvas.height,
                ready: e.canvas.width > 0 && e.canvas.height > 0,
                version: e.version,
            });
        }
        return out;
    }, [layers, tick]);
}
```

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit
git add lib/nodes/plugins/compositor/webgl/sources.ts
git commit -m "feat(compositor): webgl source hooks (video/image/text/subgraph)"
```

---

## Task 8: Wire the WebGL compositor into LivePreview (behind flag)

**Files:**
- Modify: `lib/nodes/plugins/compositor/component.tsx`

- [ ] **Step 1: Add imports to component.tsx**

```ts
import { WebGLCardCompositor } from './webgl/compositor';
import {
    useVideoLayerSources,
    useImageLayerSources,
    useTextLayerSources,
    useSubgraphLayerSources,
} from './webgl/sources';
import { BlendMode, LayerDescriptor, LayerSource } from './webgl/types';
import { isLayerActiveAt, GraphDescription } from './shared';
```

- [ ] **Step 2: Partition `renderable` by kind inside LivePreview**

Right after the `master` memo (which already iterates `renderable`):

```ts
const partitioned = useMemo(() => {
    const videos: { layer: CompositorLayer; url: string; isActive: boolean }[] = [];
    const images: { layer: CompositorLayer; url: string }[] = [];
    const texts: { layer: CompositorLayer; text: string }[] = [];
    const subgraphs: { layer: CompositorLayer; graph: GraphDescription }[] = [];
    for (const r of renderable) {
        const resolved: any = r.resolved;
        if (resolved === null || resolved === undefined) continue;
        if (typeof resolved === 'string') {
            texts.push({ layer: r.layer, text: resolved });
            continue;
        }
        if (typeof resolved !== 'object') continue;
        if (resolved.graph) {
            subgraphs.push({ layer: r.layer, graph: resolved.graph });
            continue;
        }
        const url = typeof resolved.url === 'string' ? resolved.url : null;
        if (!url) continue;
        const kind = detectSourceKindFromUrl(url);
        if (kind === 'video') {
            const intrinsic = intrinsicDurations[r.layer.id] ?? null;
            const isActive = isLayerActiveAt(r.layer, 'video', intrinsic, playhead);
            videos.push({ layer: r.layer, url, isActive });
        } else if (kind === 'image') {
            images.push({ layer: r.layer, url });
        }
    }
    return { videos, images, texts, subgraphs };
}, [renderable, intrinsicDurations, playhead]);
```

(Add `CompositorLayer` to existing imports if not present.)

- [ ] **Step 3: Invoke the source hooks**

```ts
const videoSources = useVideoLayerSources(partitioned.videos, poolKey, isPlaying, muted);
const imageSources = useImageLayerSources(partitioned.images);
const textSources = useTextLayerSources(partitioned.texts);
const subgraphSources = useSubgraphLayerSources(partitioned.subgraphs, playhead, isPlaying, poolKey, muted);
```

- [ ] **Step 4: Build descriptors for the WebGL render call**

```ts
const layerDescriptors = useMemo<LayerDescriptor[]>(() => {
    const out: LayerDescriptor[] = [];
    // Iterate in DRAW order (bottom-to-top → reverse z-order; mirrors Konva's reverse() in CompositorLayerNodes).
    const ordered = [...renderable].reverse();
    for (const r of ordered) {
        if (!r.layer.visible) continue;
        const intrinsic = intrinsicDurations[r.layer.id] ?? null;
        const resolved: any = r.resolved;
        if (resolved === null || resolved === undefined) continue;

        let source: LayerSource | null = null;
        let w = 0, h = 0;

        if (typeof resolved === 'string') {
            const t = textSources.get(r.layer.id);
            if (!t || !t.ready) continue;
            if (!isLayerActiveAt(r.layer, 'text', intrinsic, playhead)) continue;
            source = { kind: 'canvas', el: t.el, version: t.version };
            w = t.w; h = t.h;
        } else if (resolved.graph) {
            const s = subgraphSources.get(r.layer.id);
            if (!s || !s.ready) continue;
            // Subgraphs gate internally; rendered every frame regardless.
            source = { kind: 'canvas', el: s.el, version: s.version };
            w = s.w; h = s.h;
        } else {
            const url = typeof resolved.url === 'string' ? resolved.url : null;
            if (!url) continue;
            const kind = detectSourceKindFromUrl(url);
            if (kind === 'video') {
                if (!isLayerActiveAt(r.layer, 'video', intrinsic, playhead)) continue;
                const v = videoSources.get(r.layer.id);
                if (!v || !v.ready) continue;
                source = { kind: 'video', el: v.el };
                w = v.w; h = v.h;
            } else if (kind === 'image') {
                if (!isLayerActiveAt(r.layer, 'image', intrinsic, playhead)) continue;
                const i = imageSources.get(r.layer.id);
                if (!i || !i.ready) continue;
                source = { kind: 'image', el: i.el };
                w = i.w; h = i.h;
            }
        }
        if (!source) continue;

        const t = r.layer.transform;
        out.push({
            id: r.layer.id,
            source,
            sourceWidth: w,
            sourceHeight: h,
            transform: {
                x: t.x, y: t.y, width: t.width, height: t.height,
                rotation: t.rotation || 0,
                flipX: !!t.flipX, flipY: !!t.flipY,
                opacity: t.opacity ?? 1,
                blendMode: ((t.blendMode as BlendMode) || 'source-over'),
                crop: t.crop ?? null,
            },
        });
    }
    return out;
}, [renderable, intrinsicDurations, playhead, videoSources, imageSources, textSources, subgraphSources]);
```

- [ ] **Step 5: Mount the visible canvas + render loop when flag is on**

Replace the existing Stage JSX block with a branch:

```tsx
{scale > 0 && cardRendererMode() === 'webgl' ? (
    <WebGLPreviewCanvas
        canvasWidth={canvasWidth}
        canvasHeight={canvasHeight}
        previewPixelRatio={previewPixelRatio}
        layerDescriptors={layerDescriptors}
        baseFill={baseFill}
        isPlaying={isPlaying}
        playhead={playhead}
    />
) : scale > 0 ? (
    <Stage ref={stageRef} width={size.width} height={size.height} listening={false}>
        {/* ...existing Stage/Layer/Group/CompositorLayerNodes... */}
    </Stage>
) : null}
```

And add this component above `LivePreview` (inside the file):

```tsx
const WEBGL_SETTLE_MS = 800;

function WebGLPreviewCanvas({
    canvasWidth, canvasHeight, previewPixelRatio, layerDescriptors, baseFill, isPlaying, playhead,
}: {
    canvasWidth: number; canvasHeight: number; previewPixelRatio: number;
    layerDescriptors: LayerDescriptor[]; baseFill: string | null;
    isPlaying: boolean; playhead: number;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const compositorRef = useRef<WebGLCardCompositor | null>(null);

    useEffect(() => {
        const c = canvasRef.current;
        if (!c) return;
        try {
            compositorRef.current = new WebGLCardCompositor(c);
        } catch (err) {
            console.error('[compositor:webgl] init failed', err);
            return;
        }
        return () => {
            compositorRef.current?.dispose();
            compositorRef.current = null;
        };
    }, []);

    // Keep the WebGL canvas backing-store at display res × DPR (same cap as Konva path).
    useEffect(() => {
        const comp = compositorRef.current;
        if (!comp) return;
        const W = Math.round(canvasWidth * previewPixelRatio);
        const H = Math.round(canvasHeight * previewPixelRatio);
        comp.setSize(W, H);
    }, [canvasWidth, canvasHeight, previewPixelRatio]);

    // Parse base fill ("#rrggbb" / "#rrggbbaa" / null) to premul RGBA floats.
    const baseFillRgba = useMemo<[number, number, number, number]>(() => {
        if (!baseFill) return [0, 0, 0, 0];
        const hex = baseFill.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16) / 255;
        const g = parseInt(hex.substring(2, 4), 16) / 255;
        const b = parseInt(hex.substring(4, 6), 16) / 255;
        const a = hex.length >= 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1;
        return [r * a, g * a, b * a, a];
    }, [baseFill]);

    // Render loop. Playing: continuous rAF. Paused: short settle burst on
    // change so an async video frame can land, then idle — mirrors the Konva
    // Animator's cadence so paused cards don't peg the GPU.
    const settleDep = isPlaying ? '__playing__' : `${playhead.toFixed(3)}|${layerDescriptors.length}`;
    useEffect(() => {
        const comp = compositorRef.current;
        if (!comp) return;
        let raf = 0;
        let stopped = false;
        const tick = () => {
            if (stopped) return;
            comp.render(layerDescriptors, baseFillRgba);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        if (isPlaying) {
            return () => { stopped = true; if (raf) cancelAnimationFrame(raf); };
        }
        const timer = setTimeout(() => { stopped = true; if (raf) cancelAnimationFrame(raf); }, WEBGL_SETTLE_MS);
        return () => { stopped = true; clearTimeout(timer); if (raf) cancelAnimationFrame(raf); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settleDep, layerDescriptors, baseFillRgba]);

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
        />
    );
}
```

- [ ] **Step 6: Type-check + smoke-verify in browser**

```bash
npx tsc --noEmit
npm run dev
```

In a browser tab with a compositor card containing one video:
1. Open DevTools console.
2. Run `localStorage.prismCompositorRenderer = 'webgl'; location.reload()`.
3. Confirm the `[compositor:preview-res]` log shows `renderer: 'webgl'`.
4. Confirm the card preview renders the video.
5. Confirm play/pause/scrub all work and the slider tracks the picture.

- [ ] **Step 7: Commit**

```bash
git add lib/nodes/plugins/compositor/component.tsx
git commit -m "feat(compositor): wire webgl card preview behind flag"
```

---

## Task 9: Make WebGL the default for card preview

**Files:**
- Modify: `lib/nodes/plugins/compositor/component.tsx`

- [ ] **Step 1: Flip the flag default**

In the `cardRendererMode` helper, change:

```ts
return window.localStorage.getItem('prismCompositorRenderer') === 'webgl'
    ? 'webgl' : 'konva';
```

to:

```ts
return window.localStorage.getItem('prismCompositorRenderer') === 'konva'
    ? 'konva' : 'webgl';
```

So WebGL is now default; Konva is the explicit opt-out.

- [ ] **Step 2: Update the inline doc comment above the helper accordingly**

Replace the existing comment block above `cardRendererMode` with:

```ts
// 'webgl' is the card preview's renderer. Konva remains reachable as the
// fallback for debugging / A/B comparison via:
//   localStorage.prismCompositorRenderer = 'konva'
```

- [ ] **Step 3: Browser verify scenarios from Task 11 still pass; commit**

```bash
npx tsc --noEmit
git add lib/nodes/plugins/compositor/component.tsx
git commit -m "feat(compositor): default card preview to webgl"
```

---

## Task 10: Detach pool videos from DOM

**Files:**
- Modify: `lib/nodes/plugins/compositor/video-pool.ts`

Weavy's instrumentation showed video elements are fully detached (`document.contains(v) === false`). Our pool currently appends them off-screen to `document.body`. Detaching is cleaner (no DOM pollution, no off-screen styling, no chance of `getBoundingClientRect`-driven repaints).

- [ ] **Step 1: Remove the body append + positioning**

In `acquireVideo`, delete:

```ts
el.style.position = 'fixed';
el.style.left = '-9999px';
el.style.top = '-9999px';
el.style.width = '1px';
el.style.height = '1px';
el.style.pointerEvents = 'none';
el.style.opacity = '0';
document.body.appendChild(el);
```

In `releaseVideo`, delete the `entry.el.remove();` line (element was never in the DOM).

- [ ] **Step 2: Update the docstring**

Replace the relevant paragraph in the file header:

```ts
// Elements are NEVER appended to the DOM. Browsers decode detached <video>
// elements fine as long as they have a src and play() is called. Keeping
// them off-DOM mirrors Weavy's pipeline and avoids accidental layout
// thrash from style/position writes.
```

- [ ] **Step 3: Browser verify**

```bash
npm run dev
```

1. Open a compositor card with a video. Confirm playback still works.
2. Open DevTools Elements panel. Confirm no `<video>` is visible under `<body>`.
3. Confirm console has no errors about `play()` rejecting on a detached element.

- [ ] **Step 4: Type-check + commit**

```bash
npx tsc --noEmit
git add lib/nodes/plugins/compositor/video-pool.ts
git commit -m "refactor(compositor): keep pooled videos fully detached (matches weavy)"
```

---

## Task 11: Smoke-test scenarios + performance comparison

**Files:** none modified — verification only.

- [ ] **Step 1: Manual functional checklist**

Run `npm run dev`. For each scenario, run with `localStorage.prismCompositorRenderer = 'webgl'` then with `'konva'` and confirm the visual matches.

- Single video layer (full canvas, startTime 0): plays, scrubs, loops, audio toggle works.
- Two video layers (one offset in time): both play within their windows, deactivate at window end, mute correctly.
- Video + image overlay (Normal blend): overlay renders on top with correct opacity.
- Video + image overlay with each non-Normal blend mode (Multiply, Screen, Overlay, Darken, Lighten, Color-Dodge, Color-Burn, Hard-Light, Soft-Light, Difference, Exclusion): visual matches Konva output side-by-side.
- Text layer overlay (fontStyle/fontSize/textAlign variations): renders correctly.
- Subgraph upstream (chained compositor or blur): renders the upstream graph correctly at this card's playhead.
- Layer with crop set (non-null crop rect): renders the cropped sub-rect.
- Rotation, flipX, flipY, opacity: each behaves identically to Konva.
- Pause then resume: slider stays put on pause; resumes from same frame.
- Scrub while paused: video seeks; slider follows.
- Multiple compositor cards on the canvas simultaneously: no interference between pools.

- [ ] **Step 2: Performance comparison**

For ONE card with a single high-bitrate video (1080p 30fps):

1. Set `localStorage.prismCompositorRenderer = 'konva'`, reload, play, DevTools → Performance → record 5 s. Note: average frame time, GPU time, dropped frames.
2. Set `localStorage.prismCompositorRenderer = 'webgl'`, reload, play, record again. Compare.

Expected: WebGL path shows materially lower frame time + zero or near-zero dropped frames + the slider tracking the painted picture (rVFC clock, already in place).

- [ ] **Step 3: Report findings to the user**

In whatever issue tracker / chat: paste the before/after Performance numbers + a list of scenarios verified.

---

## Out-of-scope follow-ups (do not include in this plan)

- **Editor modal**: still uses Konva for interactive transformer/handles. Migrating it would require porting the Transformer/marquee/multi-layer-drag UX — non-trivial; revisit only if perf in the modal becomes a complaint.
- **Pull-model `paintGraphFrame`**: still Canvas-2D. Downstream blur and chained-compositor previews still use it. The right next step is letting `useSubgraphLayerSources` *also* be backed by a small WebGL renderer (recursive Weavy-style); for now it stays Canvas-2D and the WebGL card just uploads its canvas output as a texture.
- **Color management**: WebGL sample is `gl.RGBA / UNSIGNED_BYTE` without color-space conversion. Canvas-2D `drawImage(video)` does some implicit sRGB handling. If a side-by-side reveals color drift, follow up by setting `gl.UNPACK_COLORSPACE_CONVERSION_WEBGL = NONE` and/or doing explicit gamma in the shader.
- **Power throttling**: in inactive tabs WebGL rAF still runs. The settle-burst pattern already handles paused cards; consider gating on `document.visibilityState !== 'visible'` if multiple cards become a battery problem.
