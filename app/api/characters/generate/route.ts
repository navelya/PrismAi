import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { createServiceClient } from '@/lib/supabase/service';
import { GoogleGenAI } from '@google/genai';
import {
  type GenImage, type SheetSetEvent, type ModelTier, SHEET_CANDIDATES,
  sheetFromDescriptionPrompt, sheetFromImagePrompt, sheetModelForTier, characterGenCost,
  makeCharacterImageUploader, streamSheetCandidates,
} from '@/lib/characters/reference-set';
import { getTokenBalance, debitCharacterGeneration } from '@/lib/characters/billing';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Image generation unavailable (GEMINI_API_KEY not set)' }, { status: 503 });

  let body: any;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  const changes = typeof body?.changes === 'string' ? body.changes.trim() : '';
  const tier: ModelTier = body?.tier === 'flash' ? 'flash' : 'pro';
  const rawBase = body?.baseImage;
  const uploadedBase: GenImage | null =
    rawBase && typeof rawBase.data === 'string' && rawBase.data.length > 0
      ? { mimeType: typeof rawBase.mimeType === 'string' ? rawBase.mimeType : 'image/png', data: rawBase.data }
      : null;

  if (!uploadedBase && description.length < 3) {
    return NextResponse.json({ error: 'Please describe the character (a few words), or upload a photo.' }, { status: 400 });
  }

  // Credit pre-check — fail clearly BEFORE doing any work. We debit only after a
  // sheet actually succeeds (see lib/characters/billing.ts for why).
  const cost = characterGenCost(tier);
  const service = createServiceClient();
  if (cost > 0) {
    const balance = await getTokenBalance(service, user.id);
    if (balance < cost) {
      return NextResponse.json(
        { error: 'INSUFFICIENT_TOKENS', message: `Not enough credits — this needs ${cost}.` },
        { status: 402 },
      );
    }
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = sheetModelForTier(tier);
  const uploadImage = makeCharacterImageUploader(supabase, user.id);
  const prompt = uploadedBase ? sheetFromImagePrompt(changes || undefined) : sheetFromDescriptionPrompt(description);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: SheetSetEvent) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));
      try {
        send({ type: 'start', total: SHEET_CANDIDATES });
        const succeeded = await streamSheetCandidates({ ai, model, prompt, source: uploadedBase ?? undefined, uploadImage, send });
        if (succeeded > 0) {
          await debitCharacterGeneration(service, user.id, cost, { tier, model, sheets: succeeded, flow: 'generate' });
        }
        send({ type: 'done' });
        controller.close();
      } catch (err: any) {
        console.error('[characters/generate] error:', err);
        try { send({ type: 'error', message: err?.message || 'Character generation failed' }); } catch {}
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' } });
}
