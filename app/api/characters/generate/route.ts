import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { GoogleGenAI, Modality } from '@google/genai';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// "Nano Banana" — Gemini 2.5 Flash Image (GA). If this id ever 404s, the
// preview alias is 'gemini-2.5-flash-image-preview'.
const IMAGE_MODEL = 'gemini-2.5-flash-image';
const STORAGE_BUCKET = 'chat-assets';

// Pose 0 is the base (front), generated text→image. Poses 1-4 are generated
// image→image, each conditioned on the base so identity stays consistent.
const BASE_POSE = 'front view, facing the camera, neutral A-pose';
const CONDITIONED_POSES = [
    'three-quarter left view',
    'left side profile view',
    'three-quarter right view',
    'back view, facing away',
];

function basePrompt(description: string): string {
    return (
        `Full-body character reference image of: ${description}. ` +
        `${BASE_POSE}. A single character only, centered, head to toe in frame, ` +
        `plain solid white background, soft even studio lighting, no text, no watermark, no props.`
    );
}

function conditionedPrompt(pose: string): string {
    return (
        `Generate the EXACT SAME character as in the provided image — identical face, ` +
        `hair, body, outfit, and colors — but now in a ${pose}. ` +
        `Full body, head to toe, centered, plain solid white background, soft even studio lighting, ` +
        `no text, no watermark, no props.`
    );
}

type GenImage = { mimeType: string; data: string };

function firstImagePart(resp: any): GenImage | null {
    const parts = resp?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return null;
    for (const p of parts) {
        const inline = p?.inlineData;
        if (inline?.data && typeof inline.data === 'string') {
            return { mimeType: inline.mimeType || 'image/png', data: inline.data };
        }
    }
    return null;
}

/**
 * Streams NDJSON so the client can fill each reference slot the moment that
 * pose is ready, instead of waiting for the whole set. Events:
 *   { type: 'start', total }
 *   { type: 'image', index, url, path }
 *   { type: 'pose_failed', index }
 *   { type: 'error', message }
 *   { type: 'done' }
 * The base (index 0) streams first because the other poses are conditioned on
 * it; the remaining poses run in parallel and stream as each settles.
 */
export async function POST(request: NextRequest) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return NextResponse.json({ error: 'Image generation unavailable (GEMINI_API_KEY not set)' }, { status: 503 });
    }

    let body: any;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

    const description = typeof body?.description === 'string' ? body.description.trim() : '';
    if (description.length < 3) {
        return NextResponse.json({ error: 'Please describe the character first (at least a few words).' }, { status: 400 });
    }

    const ai = new GoogleGenAI({ apiKey });
    const genConfig = { responseModalities: [Modality.IMAGE] };

    const uploadImage = async (img: GenImage, index: number): Promise<{ url: string; path: string } | null> => {
        const ext = img.mimeType.includes('png') ? 'png' : img.mimeType.includes('webp') ? 'webp' : 'jpg';
        const path = `${user.id}/characters/${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const buffer = Buffer.from(img.data, 'base64');
        const { error: upErr } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(path, buffer, { contentType: img.mimeType, upsert: false });
        if (upErr) {
            console.error('[characters/generate] upload failed:', upErr.message);
            return null;
        }
        const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
        return { url: pub.publicUrl, path };
    };

    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const enc = new TextEncoder();
            const send = (obj: any) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));

            try {
                send({ type: 'start', total: 1 + CONDITIONED_POSES.length });

                // 1. Base image (text → image) — must finish first; poses condition on it.
                const baseResp = await ai.models.generateContent({
                    model: IMAGE_MODEL,
                    contents: basePrompt(description),
                    config: genConfig,
                });
                const base = firstImagePart(baseResp);
                if (!base) {
                    send({ type: 'error', message: 'The model did not return a base image. Try a more descriptive prompt.' });
                    controller.close();
                    return;
                }
                const baseUp = await uploadImage(base, 0);
                if (!baseUp) {
                    send({ type: 'error', message: 'Could not save the generated image. Please try again.' });
                    controller.close();
                    return;
                }
                send({ type: 'image', index: 0, url: baseUp.url, path: baseUp.path });

                // 2. Remaining poses in parallel, each conditioned on the base.
                //    Stream each the moment it uploads.
                await Promise.all(
                    CONDITIONED_POSES.map(async (pose, i) => {
                        const index = i + 1;
                        try {
                            const resp = await ai.models.generateContent({
                                model: IMAGE_MODEL,
                                contents: [
                                    { inlineData: { mimeType: base.mimeType, data: base.data } },
                                    { text: conditionedPrompt(pose) },
                                ],
                                config: genConfig,
                            });
                            const img = firstImagePart(resp);
                            if (!img) { send({ type: 'pose_failed', index }); return; }
                            const up = await uploadImage(img, index);
                            if (up) send({ type: 'image', index, url: up.url, path: up.path });
                            else send({ type: 'pose_failed', index });
                        } catch (e: any) {
                            console.error('[characters/generate] pose failed:', e?.message);
                            send({ type: 'pose_failed', index });
                        }
                    }),
                );

                send({ type: 'done' });
                controller.close();
            } catch (err: any) {
                console.error('[characters/generate] error:', err);
                try { send({ type: 'error', message: err?.message || 'Character generation failed' }); } catch {}
                try { controller.close(); } catch {}
            }
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
        },
    });
}
