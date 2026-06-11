import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { GoogleGenAI } from '@google/genai';
import { fetchImageAsBase64, makeCharacterImageUploader, generateCover } from '@/lib/characters/reference-set';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Image generation unavailable (GEMINI_API_KEY not set)' }, { status: 503 });

  let body: any;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const sheetUrl = typeof body?.sheetUrl === 'string' ? body.sheetUrl : '';
  if (!sheetUrl) return NextResponse.json({ error: 'sheetUrl is required' }, { status: 400 });

  const ai = new GoogleGenAI({ apiKey });
  const uploadImage = makeCharacterImageUploader(supabase, user.id);
  try {
    const sheet = await fetchImageAsBase64(sheetUrl);
    const cover = await generateCover({ ai, sheet, uploadImage });
    if (!cover) return NextResponse.json({ error: 'Could not generate a cover from the sheet.' }, { status: 502 });
    return NextResponse.json(cover);
  } catch (err: any) {
    console.error('[characters/cover] error:', err);
    return NextResponse.json({ error: err?.message || 'Cover generation failed' }, { status: 500 });
  }
}
