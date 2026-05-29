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

import { LayerDescriptor, LayerSource } from './types';
import { VERT_SRC, FRAG_SRC } from './shaders';

export class WebGLCardCompositor {
    private visible: HTMLCanvasElement;
    private visibleCtx: CanvasRenderingContext2D;
    private offscreen: HTMLCanvasElement;
    private gl: WebGL2RenderingContext;
    private width = 1;
    private height = 1;
    private program!: WebGLProgram;
    private quadVbo!: WebGLBuffer;
    private aPosLoc = 0;
    private uModelLoc!: WebGLUniformLocation;
    private uCanvasSizeLoc!: WebGLUniformLocation;
    private uTexLoc!: WebGLUniformLocation;
    private uDstLoc!: WebGLUniformLocation;
    private uCropLoc!: WebGLUniformLocation;
    private uOpacityLoc!: WebGLUniformLocation;
    private uBlendModeLoc!: WebGLUniformLocation;
    private fboA!: WebGLFramebuffer;
    private fboB!: WebGLFramebuffer;
    private texA!: WebGLTexture;
    private texB!: WebGLTexture;
    private read: 'A' | 'B' = 'A';
    private textures = new Map<HTMLVideoElement | HTMLImageElement | HTMLCanvasElement, {
        tex: WebGLTexture;
        lastVersion: number; // for canvas sources; -1 for video (always re-upload)
    }>();

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

        this.program = this.linkProgram(VERT_SRC, FRAG_SRC);
        this.quadVbo = this.gl.createBuffer()!;
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
        this.uDstLoc = gl.getUniformLocation(this.program, 'uDst')!;
        gl.uniform1i(this.uDstLoc, 1);
    }

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
        if (this.fboA) {
            this.gl.deleteFramebuffer(this.fboA);
            this.gl.deleteFramebuffer(this.fboB);
            this.gl.deleteTexture(this.texA);
            this.gl.deleteTexture(this.texB);
        }
        this.allocPingPong(W, H);
    }

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

    /** Render a list of layers + base fill into the offscreen, then present. */
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
            // areas the new layer doesn't cover.
            gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, readTex);
            this.drawTexturedQuad(
                readTex,
                this.buildIdentityFullCanvas(),
                [0, 0, 1, 1],
                1,
                0,
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

            this.read = this.read === 'A' ? 'B' : 'A';
        }

        // Evict stale textures (caller-owned source elements that didn't appear this frame).
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
        this.visibleCtx.clearRect(0, 0, this.width, this.height);
        this.visibleCtx.drawImage(this.offscreen, 0, 0);
    }

    private drawTexturedQuad(
        tex: WebGLTexture,
        transform: Float32Array,
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

    dispose(): void {
        const gl = this.gl;
        this.textures.forEach(({ tex }) => gl.deleteTexture(tex));
        this.textures.clear();
        if (this.fboA) {
            gl.deleteFramebuffer(this.fboA);
            gl.deleteFramebuffer(this.fboB);
            gl.deleteTexture(this.texA);
            gl.deleteTexture(this.texB);
        }
        if (this.program) gl.deleteProgram(this.program);
        if (this.quadVbo) gl.deleteBuffer(this.quadVbo);
        const loseCtx = gl.getExtension('WEBGL_lose_context');
        loseCtx?.loseContext();
    }
}

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
