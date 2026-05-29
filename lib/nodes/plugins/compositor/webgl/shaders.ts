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

in vec2 aPos;
out vec2 vUv;
uniform mat3 uModel;
uniform vec2 uCanvasSize;

void main() {
    vec3 p = uModel * vec3(aPos, 1.0);
    vec2 ndc = (p.xy / uCanvasSize) * 2.0 - 1.0;
    gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
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

uniform sampler2D uTex;
uniform vec4 uCrop;
uniform float uOpacity;
uniform int uBlendMode;

void main() {
    vec2 uv = mix(uCrop.xy, uCrop.zw, vUv);
    vec4 src = texture(uTex, uv);
    src.rgb *= uOpacity;
    src.a   *= uOpacity;
    outColor = src;
}`;
