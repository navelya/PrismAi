import { GoogleGenAI, Modality } from '@google/genai';
import type { SupabaseClient } from '@supabase/supabase-js';

// Image models. Sheets default to Gemini 3 Pro Image (higher fidelity, slower);
// the front-face cover and the cheap "Flash" sheet tier use Gemini 2.5 Flash
// Image ("Nano Banana"). If the flash id 404s, the alias is
// 'gemini-2.5-flash-image-preview'.
export const IMAGE_MODEL_FLASH = 'gemini-2.5-flash-image';
export const IMAGE_MODEL_PRO = 'gemini-3-pro-image-preview';
// Back-compat alias — the fast Flash model (cover + legacy callers).
export const IMAGE_MODEL = IMAGE_MODEL_FLASH;
export const STORAGE_BUCKET = 'chat-assets';

/** Quality tier the user picks when generating sheets. */
export type ModelTier = 'pro' | 'flash';
export function sheetModelForTier(tier: ModelTier): string {
  return tier === 'flash' ? IMAGE_MODEL_FLASH : IMAGE_MODEL_PRO;
}
/** Credit cost for ONE character-sheet generation run (a batch of candidates). */
export const CHARACTER_GEN_COST: Record<ModelTier, number> = { pro: 35, flash: 5 };
export function characterGenCost(tier: ModelTier): number {
  return CHARACTER_GEN_COST[tier] ?? CHARACTER_GEN_COST.pro;
}

export type GenImage = { mimeType: string; data: string };

export type SheetSetEvent =
  | { type: 'start'; total: number }
  | { type: 'sheet'; index: number; url: string; path: string }
  | { type: 'sheet_failed'; index: number }
  | { type: 'error'; message: string }
  | { type: 'done' };

export const SHEET_CANDIDATES = 4;

// The exact contact-sheet layout every sheet prompt enforces.
// Phrasing informed by: Google Gemini prompting guide (describe the scene,
// not keywords), multi-view identity-lock research (front view alone is not
// enough — profiles + full-body force the identity to become coherent in 3D
// space), and character-sheet mastery tutorials (exact same face/body/outfit
// repeated across every panel; professional turnaround sheet style).
const SHEET_LAYOUT =
  'Place the character on a plain, empty, solid neutral background with nothing else in the scene. ' +
  'Lay the sheet out as a clean photographic contact sheet with EXACTLY two horizontal rows. ' +
  'TOP ROW — four DIFFERENT full-body photographs of the SAME person, head-to-toe, evenly spaced, in this exact ' +
  'left-to-right order: (1) front view facing the camera straight on, (2) left side profile turned 90° to the left, ' +
  '(3) right side profile turned 90° to the right, (4) back view facing fully away. ' +
  'BOTTOM ROW — three DIFFERENT close-up head-and-shoulders portraits of the SAME person, in this exact left-to-right ' +
  'order: (1) front portrait facing the camera straight on, (2) left side profile portrait, (3) right side profile portrait. ' +
  'Every one of the seven panels must be a distinct, different angle: do NOT repeat, mirror, or duplicate any pose, ' +
  'and never place a front-facing view where a profile is required or a profile where a front view is required. ' +
  'Keep identical face, hair, body, outfit, and colors in every panel; exact same age, ethnicity, bone structure, ' +
  'and proportions across all seven views; consistent scale and head height within each row. ' +
  'Photorealistic, soft even studio lighting (same direction and intensity in every panel), sharp focus on the subject, ' +
  'no text, no labels, no watermark, no props, no borders.';

export function sheetFromDescriptionPrompt(description: string): string {
  return (
    `Create a professional character reference sheet — a photographic model turnaround — for this person: ${description}. ` +
    `Lock all identity-defining attributes (face geometry, hair, skin tone, body proportions, outfit) ` +
    `identically across every view. ${SHEET_LAYOUT}`
  );
}

export function sheetFromImagePrompt(changes?: string): string {
  const edit =
    changes && changes.trim()
      ? ` Apply these changes to the character while keeping them clearly the same person: ${changes.trim()}.`
      : '';
  return (
    `Create a professional character reference sheet of the EXACT SAME person shown in the provided image — ` +
    `identical face, hair, skin tone, and body. No changes to identity, age, ethnicity, or proportions.${edit} ` +
    `${SHEET_LAYOUT}`
  );
}

export function sheetVariantPrompt(changes: string): string {
  return (
    `The provided image is a reference sheet of a character. Create a NEW reference sheet of the EXACT SAME ` +
    `person — identical facial features, bone structure, and body proportions. ` +
    `Exact same age, gender, skin tone, and hair from the reference. Apply these changes: ${changes.trim()}. ` +
    `Keep them clearly recognizable as the same person. ${SHEET_LAYOUT}`
  );
}

export function coverPrompt(): string {
  return (
    `From the character shown in this reference sheet, create ONE clean hero portrait — a single ` +
    `three-quarter upper-body shot of the EXACT SAME person facing the camera, centered. ` +
    `Identical face, hair, skin tone, and outfit as shown in the reference sheet. ` +
    `Plain solid neutral background, soft studio lighting, photorealistic, sharp focus, ` +
    `no text, no watermark, no contact-sheet grid, no multiple frames.`
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

/** Generate SHEET_CANDIDATES sheets in parallel, streaming each as it settles.
 *  `source` is the conditioning image for image→image flows (upload / variant);
 *  omit it for text→image (describe). */
export async function streamSheetCandidates(opts: {
  ai: GoogleGenAI;
  model: string;
  prompt: string;
  source?: GenImage;
  uploadImage: (img: GenImage, index: number) => Promise<{ url: string; path: string } | null>;
  send: (e: SheetSetEvent) => void;
}): Promise<number> {
  const { ai, model, prompt, source, uploadImage, send } = opts;
  const genConfig = { responseModalities: [Modality.IMAGE] };
  const contents = source
    ? [{ inlineData: { mimeType: source.mimeType, data: source.data } }, { text: prompt }]
    : prompt;

  const results = await Promise.all(
    Array.from({ length: SHEET_CANDIDATES }, (_, index) =>
      (async (): Promise<boolean> => {
        try {
          const resp = await ai.models.generateContent({ model, contents, config: genConfig });
          const img = firstImagePart(resp);
          if (!img) { send({ type: 'sheet_failed', index }); return false; }
          const up = await uploadImage(img, index);
          if (up) { send({ type: 'sheet', index, url: up.url, path: up.path }); return true; }
          send({ type: 'sheet_failed', index });
          return false;
        } catch (e: any) {
          console.error('[reference-set] sheet failed:', e?.message);
          send({ type: 'sheet_failed', index });
          return false;
        }
      })(),
    ),
  );
  // Number of candidates that successfully generated + uploaded (drives billing).
  return results.filter(Boolean).length;
}

/** Chosen sheet → one cover image. Returns null on failure. */
export async function generateCover(opts: {
  ai: GoogleGenAI;
  sheet: GenImage;
  uploadImage: (img: GenImage, index: number) => Promise<{ url: string; path: string } | null>;
}): Promise<{ url: string; path: string } | null> {
  const { ai, sheet, uploadImage } = opts;
  const resp = await ai.models.generateContent({
    model: IMAGE_MODEL,
    contents: [{ inlineData: { mimeType: sheet.mimeType, data: sheet.data } }, { text: coverPrompt() }],
    config: { responseModalities: [Modality.IMAGE] },
  });
  const img = firstImagePart(resp);
  if (!img) return null;
  return uploadImage(img, 0);
}
