import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { GoogleGenAI, Modality } from '@google/genai';
import {
  IMAGE_MODEL,
  CONDITIONED_POSES,
  type GenImage,
  type RefSetEvent,
  basePrompt,
  conditionedPrompt,
  facePrompt,
  firstImagePart,
  makeCharacterImageUploader,
  streamPosesAndFace,
} from '@/lib/characters/reference-set';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Streams NDJSON so the client can fill each reference slot the moment that
 * pose is ready. Events: start / image / pose_failed / error / done.
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

  // Optional uploaded photo to build the character FROM. When present it becomes
  // the base (index 0) and every other reference is conditioned on it.
  const rawBase = body?.baseImage;
  const uploadedBase: GenImage | null =
    rawBase && typeof rawBase.data === 'string' && rawBase.data.length > 0
      ? { mimeType: typeof rawBase.mimeType === 'string' ? rawBase.mimeType : 'image/png', data: rawBase.data }
      : null;

  if (!uploadedBase && description.length < 3) {
    return NextResponse.json({ error: 'Please describe the character first (at least a few words), or upload a photo.' }, { status: 400 });
  }

  const ai = new GoogleGenAI({ apiKey });
  const genConfig = { responseModalities: [Modality.IMAGE] };
  const uploadImage = makeCharacterImageUploader(supabase, user.id);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: RefSetEvent) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));

      try {
        const faceIndex = 1 + CONDITIONED_POSES.length;
        send({ type: 'start', total: faceIndex + 1 });

        // Establish ONE canonical base (index 0) BEFORE anything else, so every
        // pose inherits its details. Uploaded photo → clean front view via
        // image→image; text only → text→image.
        let base: GenImage | null;
        if (uploadedBase) {
          const frontResp = await ai.models.generateContent({
            model: IMAGE_MODEL,
            contents: [
              { inlineData: { mimeType: uploadedBase.mimeType, data: uploadedBase.data } },
              { text: conditionedPrompt('front view, facing the camera, full-body head-to-toe neutral A-pose') },
            ],
            config: genConfig,
          });
          base = firstImagePart(frontResp);
          if (!base) {
            send({ type: 'error', message: 'Could not generate a front view from your photo. Try a clearer, well-lit image.' });
            controller.close();
            return;
          }
        } else {
          const baseResp = await ai.models.generateContent({
            model: IMAGE_MODEL,
            contents: basePrompt(description),
            config: genConfig,
          });
          base = firstImagePart(baseResp);
          if (!base) {
            send({ type: 'error', message: 'The model did not return a base image. Try a more descriptive prompt.' });
            controller.close();
            return;
          }
        }

        const baseUp = await uploadImage(base, 0);
        if (!baseUp) {
          send({ type: 'error', message: 'Could not save the generated image. Please try again.' });
          controller.close();
          return;
        }
        send({ type: 'image', index: 0, url: baseUp.url, path: baseUp.path });

        // The face conditions on the real uploaded photo when we have one
        // (highest facial fidelity), else on the base.
        const faceSrc = uploadedBase ?? base;
        await streamPosesAndFace({
          ai,
          base,
          faceSrc,
          faceIndex,
          facePromptText: facePrompt(),
          uploadImage,
          send,
        });

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
