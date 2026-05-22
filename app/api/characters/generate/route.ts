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

    try {
        // 1. Base image (text → image).
        const baseResp = await ai.models.generateContent({
            model: IMAGE_MODEL,
            contents: basePrompt(description),
            config: genConfig,
        });
        const base = firstImagePart(baseResp);
        if (!base) {
            return NextResponse.json({ error: 'The model did not return a base image. Try a more descriptive prompt.' }, { status: 502 });
        }

        // 2. Four more poses, each conditioned on the base image. Run in
        //    parallel — they all depend only on the base, not on each other.
        const poseResults = await Promise.allSettled(
            CONDITIONED_POSES.map((pose) =>
                ai.models.generateContent({
                    model: IMAGE_MODEL,
                    contents: [
                        { inlineData: { mimeType: base.mimeType, data: base.data } },
                        { text: conditionedPrompt(pose) },
                    ],
                    config: genConfig,
                }),
            ),
        );

        const generated: GenImage[] = [base];
        for (const r of poseResults) {
            if (r.status === 'fulfilled') {
                const img = firstImagePart(r.value);
                if (img) generated.push(img);
            }
        }

        // 3. Upload each generated image to storage under the user's folder.
        const uploaded: { url: string; path: string }[] = [];
        for (let i = 0; i < generated.length; i++) {
            const img = generated[i];
            const ext = img.mimeType.includes('png') ? 'png' : img.mimeType.includes('webp') ? 'webp' : 'jpg';
            const path = `${user.id}/characters/${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
            const buffer = Buffer.from(img.data, 'base64');
            const { error: upErr } = await supabase.storage
                .from(STORAGE_BUCKET)
                .upload(path, buffer, { contentType: img.mimeType, upsert: false });
            if (upErr) {
                console.error('[characters/generate] upload failed:', upErr.message);
                continue;
            }
            const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
            uploaded.push({ url: pub.publicUrl, path });
        }

        if (uploaded.length === 0) {
            return NextResponse.json({ error: 'Generated images could not be saved. Please try again.' }, { status: 500 });
        }

        return NextResponse.json({ images: uploaded });
    } catch (err: any) {
        console.error('[characters/generate] error:', err);
        return NextResponse.json({ error: err?.message || 'Character generation failed' }, { status: 500 });
    }
}
