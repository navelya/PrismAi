import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { GoogleGenAI, Modality } from '@google/genai';
import {
  IMAGE_MODEL,
  CONDITIONED_POSES,
  type GenImage,
  type RefSetEvent,
  restyleBasePrompt,
  restyleFacePrompt,
  firstImagePart,
  fetchImageAsBase64,
  makeCharacterImageUploader,
  streamPosesAndFace,
} from '@/lib/characters/reference-set';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/characters/[id]/variant — restyle an existing character into a new
 * look from a style prompt, streaming NDJSON identical to /generate. Preserves
 * identity by conditioning the new base on the source character's own base
 * image, and the face close-up on the source face image.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Image generation unavailable (GEMINI_API_KEY not set)' }, { status: 503 });
  }

  const id = params.id;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: any;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const style = typeof body?.style === 'string' ? body.style.trim() : '';
  if (style.length < 3) {
    return NextResponse.json({ error: 'Describe the new style first (at least a few words).' }, { status: 400 });
  }

  const { data: character, error } = await supabase
    .from('characters')
    .select('id, name, reference_images')
    .eq('id', id)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .single();
  if (error || !character) {
    return NextResponse.json({ error: 'Character not found' }, { status: 404 });
  }

  const refs: { url?: string; role?: string }[] = Array.isArray(character.reference_images)
    ? character.reference_images
    : [];
  const baseRef = refs[0];
  if (!baseRef?.url) {
    return NextResponse.json({ error: 'Source character has no base image to restyle.' }, { status: 400 });
  }
  const faceRef = refs.find((r) => r?.role === 'face') ?? baseRef;

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

        // Pull the source base + face down as inline base64 for image→image.
        let sourceBase: GenImage;
        let sourceFace: GenImage;
        try {
          sourceBase = await fetchImageAsBase64(baseRef.url!);
          sourceFace = faceRef.url && faceRef.url !== baseRef.url
            ? await fetchImageAsBase64(faceRef.url)
            : sourceBase;
        } catch {
          send({ type: 'error', message: 'Could not load the original character images.' });
          controller.close();
          return;
        }

        // Restyle the canonical base (index 0) from the source base.
        const baseResp = await ai.models.generateContent({
          model: IMAGE_MODEL,
          contents: [
            { inlineData: { mimeType: sourceBase.mimeType, data: sourceBase.data } },
            { text: restyleBasePrompt(style) },
          ],
          config: genConfig,
        });
        const newBase = firstImagePart(baseResp);
        if (!newBase) {
          send({ type: 'error', message: 'Could not restyle the base image. Try a different style description.' });
          controller.close();
          return;
        }
        const baseUp = await uploadImage(newBase, 0);
        if (!baseUp) {
          send({ type: 'error', message: 'Could not save the generated image. Please try again.' });
          controller.close();
          return;
        }
        send({ type: 'image', index: 0, url: baseUp.url, path: baseUp.path });

        // Poses condition on the NEW base (so they carry the new style); the
        // face restyles from the SOURCE face (identity anchor) + new style.
        await streamPosesAndFace({
          ai,
          base: newBase,
          faceSrc: sourceFace,
          faceIndex,
          facePromptText: restyleFacePrompt(style),
          uploadImage,
          send,
        });

        send({ type: 'done' });
        controller.close();
      } catch (err: any) {
        console.error('[characters/variant] error:', err);
        try { send({ type: 'error', message: err?.message || 'Variant generation failed' }); } catch {}
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
