import { GoogleGenAI, Modality } from '@google/genai';
import type { SupabaseClient } from '@supabase/supabase-js';

// "Nano Banana" — Gemini 2.5 Flash Image (GA). If this id ever 404s, the
// preview alias is 'gemini-2.5-flash-image-preview'.
export const IMAGE_MODEL = 'gemini-2.5-flash-image';
export const STORAGE_BUCKET = 'chat-assets';

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
  'Lay it out as a clean photographic contact sheet with TWO horizontal rows on a plain solid neutral background. ' +
  'TOP ROW: four full-body photographs of the SAME person, head-to-toe, evenly spaced — ' +
  '(1) facing the camera, (2) left-facing profile, (3) right-facing profile, (4) facing away from the camera. ' +
  'BOTTOM ROW: three close-up photographic head-and-shoulders portraits of the SAME person — ' +
  '(1) facing the camera, (2) left-facing profile, (3) right-facing profile. ' +
  'Identical face, hair, body, outfit, and colors in every frame. ' +
  'Exact same age, ethnicity, bone structure, and proportions across all seven views. ' +
  'Photorealistic, soft even studio lighting, sharp focus on the subject, ' +
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
      ? ` Additionally, apply these requested changes to the character while keeping them clearly the same person: ${changes.trim()}.`
      : '';
  return (
    `Create a professional character reference sheet based strictly on the uploaded reference image. ` +
    `Use a clean, neutral plain background and present the sheet as a technical model turnaround while matching ` +
    `the exact visual style of the reference (same realism level, rendering approach, texture, color treatment, ` +
    `and overall aesthetic). Arrange the composition into two horizontal rows. Top row: four full-body standing ` +
    `views placed side-by-side in this order: front view, left profile view (facing left), right profile view ` +
    `(facing right), back view. Bottom row: three highly detailed close-up portraits aligned beneath the full-body ` +
    `row in this order: front portrait, left profile portrait (facing left), right profile portrait (facing right). ` +
    `Maintain perfect identity consistency across every panel. Keep the subject in a relaxed A-pose and with ` +
    `consistent scale and alignment between views, accurate anatomy, and clear silhouette; ensure even spacing and ` +
    `clean panel separation, with uniform framing and consistent head height across the full-body lineup and ` +
    `consistent facial scale across the portraits. Lighting should be consistent across all panels (same direction, ` +
    `intensity, and softness), with natural, controlled shadows that preserve detail without dramatic mood shifts. ` +
    `Output a crisp, print-ready reference sheet look, sharp details.${edit}`
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
  prompt: string;
  source?: GenImage;
  uploadImage: (img: GenImage, index: number) => Promise<{ url: string; path: string } | null>;
  send: (e: SheetSetEvent) => void;
}): Promise<void> {
  const { ai, prompt, source, uploadImage, send } = opts;
  const genConfig = { responseModalities: [Modality.IMAGE] };
  const contents = source
    ? [{ inlineData: { mimeType: source.mimeType, data: source.data } }, { text: prompt }]
    : prompt;

  await Promise.all(
    Array.from({ length: SHEET_CANDIDATES }, (_, index) =>
      (async () => {
        try {
          const resp = await ai.models.generateContent({ model: IMAGE_MODEL, contents, config: genConfig });
          const img = firstImagePart(resp);
          if (!img) { send({ type: 'sheet_failed', index }); return; }
          const up = await uploadImage(img, index);
          if (up) send({ type: 'sheet', index, url: up.url, path: up.path });
          else send({ type: 'sheet_failed', index });
        } catch (e: any) {
          console.error('[reference-set] sheet failed:', e?.message);
          send({ type: 'sheet_failed', index });
        }
      })(),
    ),
  );
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
