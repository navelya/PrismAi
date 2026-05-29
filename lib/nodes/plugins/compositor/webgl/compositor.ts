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
