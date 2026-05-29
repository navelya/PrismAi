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
    private uCropLoc!: WebGLUniformLocation;
    private uOpacityLoc!: WebGLUniformLocation;
    private uBlendModeLoc!: WebGLUniformLocation;

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

    dispose(): void {
        // GL objects created in later tasks freed here; this is the catch-all.
        const gl = this.gl;
        const loseCtx = gl.getExtension('WEBGL_lose_context');
        loseCtx?.loseContext();
    }
}
