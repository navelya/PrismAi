import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const dynamic = 'force-dynamic';

const PROMPT =
    'Describe this character for an image-generation reference in one or two sentences. ' +
    'Focus on stable visual identity: age range, hair, eyes, distinctive facial features, ' +
    'build, and signature clothing. Do not mention the background or pose. Plain text only.';

export async function POST(request: NextRequest) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return NextResponse.json({ error: 'Auto-describe unavailable (GEMINI_API_KEY not set)' }, { status: 503 });
    }

    let body: any;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

    const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl : '';
    if (!imageUrl || !/^https?:\/\//.test(imageUrl)) {
        return NextResponse.json({ error: 'A valid imageUrl is required' }, { status: 400 });
    }

    try {
        const resp = await fetch(imageUrl);
        if (!resp.ok) throw new Error(`Failed to fetch image (HTTP ${resp.status})`);
        const mimeType = resp.headers.get('content-type') || 'image/jpeg';
        const base64 = Buffer.from(await resp.arrayBuffer()).toString('base64');

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent([
            PROMPT,
            { inlineData: { mimeType, data: base64 } },
        ]);
        const description = result.response.text().trim();

        return NextResponse.json({ description });
    } catch (err: any) {
        console.error('[characters/auto-describe] error:', err);
        return NextResponse.json({ error: err?.message || 'Auto-describe failed' }, { status: 500 });
    }
}
