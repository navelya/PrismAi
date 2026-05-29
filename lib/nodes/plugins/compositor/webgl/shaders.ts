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
 * Fragment shader. Implements ping-pong compositing with 12 blend modes.
 * uTex (unit 0) is the layer source; uDst (unit 1) is the destination
 * accumulator from the previous composite pass.
 */
export const FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTex;       // layer source
uniform sampler2D uDst;       // destination accumulator (previous composite)
uniform vec4 uCrop;
uniform float uOpacity;
uniform int uBlendMode;
uniform vec2 uCanvasSize;

// Separable blend functions per channel. Inputs are non-premultiplied RGB.
float blendChannel(float Cs, float Cb, int mode) {
    if (mode == 0)  return Cs;
    if (mode == 1)  return Cs * Cb;
    if (mode == 2)  return 1.0 - (1.0 - Cs) * (1.0 - Cb);
    if (mode == 3) {
        return Cb < 0.5 ? 2.0 * Cs * Cb : 1.0 - 2.0 * (1.0 - Cs) * (1.0 - Cb);
    }
    if (mode == 4)  return min(Cs, Cb);
    if (mode == 5)  return max(Cs, Cb);
    if (mode == 6)  return Cs >= 1.0 ? 1.0 : min(1.0, Cb / (1.0 - Cs));
    if (mode == 7)  return Cs <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - Cb) / Cs);
    if (mode == 8) {
        return Cs < 0.5 ? 2.0 * Cs * Cb : 1.0 - 2.0 * (1.0 - Cs) * (1.0 - Cb);
    }
    if (mode == 9) {
        float d;
        if (Cb <= 0.25) d = ((16.0 * Cb - 12.0) * Cb + 4.0) * Cb;
        else            d = sqrt(Cb);
        return Cs <= 0.5
            ? Cb - (1.0 - 2.0 * Cs) * Cb * (1.0 - Cb)
            : Cb + (2.0 * Cs - 1.0) * (d - Cb);
    }
    if (mode == 10) return abs(Cs - Cb);
    if (mode == 11) return Cs + Cb - 2.0 * Cs * Cb;
    return Cs;
}

void main() {
    vec2 uv = mix(uCrop.xy, uCrop.zw, vUv);
    vec4 srcPre = texture(uTex, uv);
    srcPre.rgb *= uOpacity;
    srcPre.a   *= uOpacity;

    vec2 dstUv = gl_FragCoord.xy / uCanvasSize;
    vec4 dstPre = texture(uDst, dstUv);

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

    float aS = srcPre.a;
    float aB = dstPre.a;
    float aR = aS + aB * (1.0 - aS);
    vec3 mixed = mix(Cb, B, aB);
    vec3 outRgb = mixed * aS + Cb * aB * (1.0 - aS);
    outColor = vec4(outRgb, aR);
}`;
