import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { GoogleGenAI } from '@google/genai';
import {
  type GenImage, type SheetSetEvent, SHEET_CANDIDATES,
  sheetVariantPrompt, fetchImageAsBase64, makeCharacterImageUploader, streamSheetCandidates,
} from '@/lib/characters/reference-set';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Image generation unavailable (GEMINI_API_KEY not set)' }, { status: 503 });

  const id = params.id;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: any;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const changes = typeof body?.changes === 'string' ? body.changes.trim() : '';
  if (changes.length < 3) return NextResponse.json({ error: 'Describe the changes first (a few words).' }, { status: 400 });

  const { data: character, error } = await supabase
    .from('characters')
    .select('id, name, sheet_url, reference_images')
    .eq('id', id).eq('user_id', user.id).is('deleted_at', null).single();
  if (error || !character) return NextResponse.json({ error: 'Character not found' }, { status: 404 });

  const sheetUrl: string | undefined =
    (character as any).sheet_url || (Array.isArray((character as any).reference_images) ? (character as any).reference_images[0]?.url : undefined);
  if (!sheetUrl) return NextResponse.json({ error: 'Source character has no sheet to restyle.' }, { status: 400 });

  const ai = new GoogleGenAI({ apiKey });
  const uploadImage = makeCharacterImageUploader(supabase, user.id);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: SheetSetEvent) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));
      try {
        send({ type: 'start', total: SHEET_CANDIDATES });
        let source: GenImage;
        try { source = await fetchImageAsBase64(sheetUrl); }
        catch { send({ type: 'error', message: 'Could not load the source sheet.' }); controller.close(); return; }
        await streamSheetCandidates({ ai, prompt: sheetVariantPrompt(changes), source, uploadImage, send });
        send({ type: 'done' });
        controller.close();
      } catch (err: any) {
        console.error('[characters/variant] error:', err);
        try { send({ type: 'error', message: err?.message || 'Variant generation failed' }); } catch {}
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' } });
}
