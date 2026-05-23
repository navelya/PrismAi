import { GoogleGenAI, Modality } from '@google/genai';
import type { SupabaseClient } from '@supabase/supabase-js';

// "Nano Banana" — Gemini 2.5 Flash Image (GA). If this id ever 404s, the
// preview alias is 'gemini-2.5-flash-image-preview'.
export const IMAGE_MODEL = 'gemini-2.5-flash-image';
export const STORAGE_BUCKET = 'chat-assets';

export const BASE_POSE = 'front view, facing the camera, neutral A-pose';
export const CONDITIONED_POSES = [
  'three-quarter left view',
  'left side profile view',
  'three-quarter right view',
  'back view, facing away',
];

export type GenImage = { mimeType: string; data: string };

export type RefSetEvent =
  | { type: 'start'; total: number }
  | { type: 'image'; index: number; url: string; path: string; role?: 'face' }
  | { type: 'pose_failed'; index: number }
  | { type: 'error'; message: string }
  | { type: 'done' };

export function basePrompt(description: string): string {
  return (
    `Full-body character reference image of: ${description}. ` +
    `${BASE_POSE}. A single character only, centered, head to toe in frame, ` +
    `plain solid white background, soft even studio lighting, no text, no watermark, no props.`
  );
}

export function conditionedPrompt(pose: string): string {
  return (
    `Generate the EXACT SAME character as in the provided image — identical face, ` +
    `hair, body, outfit, and colors — but now in a ${pose}. ` +
    `Full body, head to toe, centered, plain solid white background, soft even studio lighting, ` +
    `no text, no watermark, no props.`
  );
}

export function facePrompt(): string {
  return (
    `Generate a tight head-and-shoulders close-up PORTRAIT of the EXACT SAME character ` +
    `as in the provided image — identical face, hair, and skin tone — looking straight at ` +
    `the camera. Sharp focus on the face, plain solid white background, soft even studio ` +
    `lighting, no text, no watermark, no props.`
  );
}

// Variant: restyle the FULL-BODY base from the source character's own base
// image. Keeps the same person (face/body) but changes outfit, art-style, and
// palette to match the new style.
export function restyleBasePrompt(style: string): string {
  return (
    `Generate the EXACT SAME character as in the provided image — identical face, hair, and ` +
    `body proportions — but restyled: ${style}. Change the outfit, art-style, and color ` +
    `palette to match this new style while keeping the same person clearly recognizable. ` +
    `${BASE_POSE}. Full body, head to toe, centered, plain solid white background, ` +
    `soft even studio lighting, no text, no watermark, no props.`
  );
}

// Variant: restyle the face close-up from the source character's face image,
// preserving facial identity while applying the new style's art direction.
export function restyleFacePrompt(style: string): string {
  return (
    `Generate a tight head-and-shoulders close-up PORTRAIT of the EXACT SAME character as in ` +
    `the provided image — identical facial features, bone structure, and hair — restyled: ${style}. ` +
    `Apply the new style's art direction and color treatment while keeping the same person clearly ` +
    `recognizable, looking straight at the camera. Sharp focus on the face, plain solid white ` +
    `background, soft even studio lighting, no text, no watermark, no props.`
  );
}

export function firstImagePart(resp: any): GenImage | null {
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

/** Fetch a stored image URL and return it as inline base64 for image→image prompts. */
export async function fetchImageAsBase64(url: string): Promise<GenImage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch source image (${res.status})`);
  const mimeType = res.headers.get('content-type') || 'image/png';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { mimeType, data: buffer.toString('base64') };
}

/** Returns an uploader that writes generated images under `{userId}/characters/...`. */
export function makeCharacterImageUploader(supabase: SupabaseClient, userId: string) {
  return async (img: GenImage, index: number): Promise<{ url: string; path: string } | null> => {
    const ext = img.mimeType.includes('png') ? 'png' : img.mimeType.includes('webp') ? 'webp' : 'jpg';
    const path = `${userId}/characters/${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const buffer = Buffer.from(img.data, 'base64');
    const { error: upErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, buffer, { contentType: img.mimeType, upsert: false });
    if (upErr) {
      console.error('[reference-set] upload failed:', upErr.message);
      return null;
    }
    const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return { url: pub.publicUrl, path };
  };
}

/**
 * Generate the 4 conditioned poses + the face close-up in parallel, streaming
 * each as it settles. Poses condition on `base` (so they inherit its outfit/
 * style); the face conditions on `faceSrc`. The caller produces + uploads +
 * streams the base (index 0) BEFORE calling this.
 */
export async function streamPosesAndFace(opts: {
  ai: GoogleGenAI;
  base: GenImage;
  faceSrc: GenImage;
  faceIndex: number;
  facePromptText: string;
  uploadImage: (img: GenImage, index: number) => Promise<{ url: string; path: string } | null>;
  send: (e: RefSetEvent) => void;
}): Promise<void> {
  const { ai, base, faceSrc, faceIndex, facePromptText, uploadImage, send } = opts;
  const genConfig = { responseModalities: [Modality.IMAGE] };

  const conditioned: { index: number; prompt: string; role?: 'face'; src: GenImage }[] = [
    ...CONDITIONED_POSES.map((pose, i) => ({ index: i + 1, prompt: conditionedPrompt(pose), src: base })),
    { index: faceIndex, prompt: facePromptText, role: 'face' as const, src: faceSrc },
  ];

  await Promise.all(
    conditioned.map(async ({ index, prompt, role, src }) => {
      try {
        const resp = await ai.models.generateContent({
          model: IMAGE_MODEL,
          contents: [{ inlineData: { mimeType: src.mimeType, data: src.data } }, { text: prompt }],
          config: genConfig,
        });
        const img = firstImagePart(resp);
        if (!img) {
          send({ type: 'pose_failed', index });
          return;
        }
        const up = await uploadImage(img, index);
        if (up) send({ type: 'image', index, url: up.url, path: up.path, ...(role ? { role } : {}) });
        else send({ type: 'pose_failed', index });
      } catch (e: any) {
        console.error('[reference-set] pose failed:', e?.message);
        send({ type: 'pose_failed', index });
      }
    }),
  );
}
