// app/api/admin/node-types/describe/route.ts
// Admin-only: given a list of node types (sub categories) — each with its
// display name and parent categories — let Gemini Flash write a VERY short
// (a few words) blurb for each, shown under the title in the Add Node panel.
// Used by the per-form "Generate" button and the bulk "Generate descriptions"
// button in the admin Sub Categories tab. Returns a map keyed by node type id.
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { GoogleGenerativeAI, SchemaType, ResponseSchema } from '@google/generative-ai';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface NodeTypeIn {
    id: string;
    display_name: string;
    parent_categories?: string[];
}

const RESPONSE_SCHEMA: ResponseSchema = {
    type: SchemaType.OBJECT,
    properties: {
        items: {
            type: SchemaType.ARRAY,
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    id: { type: SchemaType.STRING, description: 'The exact `id` from the input list.' },
                    description: { type: SchemaType.STRING, description: 'A 2-5 word lowercase blurb.' },
                },
                required: ['id', 'description'],
            },
        },
    },
    required: ['items'],
};

const SYSTEM_INSTRUCTION =
    'You write ultra-short labels for the categories of nodes in an AI media ' +
    'generation app. Each "node type" groups AI models by what they do (e.g. ' +
    '"Image Generation", "Video Upscaler", "Background Removal"). For each one, ' +
    'write a tiny blurb of 2-5 words that fits under the title in a compact "add ' +
    'node" menu. Describe what it does for a non-technical creator. ' +
    'No trailing period, no restating the title verbatim, no marketing fluff. ' +
    'Sentence case (e.g. "Create & edit images", "Sharpen and enlarge video"). ' +
    'Return ONLY the structured JSON, one item per provided id.';

export async function POST(req: NextRequest) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return NextResponse.json({ error: 'Auto-generate unavailable (GEMINI_API_KEY not set)' }, { status: 503 });
    }

    let body: any;
    try { body = await req.json(); }
    catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

    const items: NodeTypeIn[] = Array.isArray(body?.items) ? body.items : [];
    const categories: Array<{ id: string; display_name: string }> = Array.isArray(body?.categories) ? body.categories : [];
    if (items.length === 0) {
        return NextResponse.json({ error: 'No node types to describe' }, { status: 400 });
    }

    const catName = (id: string) => categories.find((c) => c.id === id)?.display_name || id;
    const promptItems = items.map((nt) => ({
        id: nt.id,
        name: nt.display_name,
        categories: (nt.parent_categories || []).map(catName),
    }));

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const gen = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: SYSTEM_INSTRUCTION,
            generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
        });

        const prompt =
            `Write a 2-5 word blurb for each of these node types. ` +
            `Return one item per id, using the exact id string.\n\n` +
            `Node types:\n${JSON.stringify(promptItems)}`;

        const result = await gen.generateContent(prompt);
        const text = result.response.text().trim();
        const parsed = JSON.parse(text);
        const out: Array<{ id: string; description: string }> = Array.isArray(parsed?.items) ? parsed.items : [];

        const descriptions: Record<string, string> = {};
        const validIds = new Set(items.map((i) => i.id));
        for (const it of out) {
            if (it && typeof it.id === 'string' && validIds.has(it.id) && typeof it.description === 'string') {
                descriptions[it.id] = it.description.trim();
            }
        }

        return NextResponse.json({ descriptions });
    } catch (err: any) {
        console.error('[admin/node-types/describe] error:', err);
        return NextResponse.json({ error: err?.message || 'Auto-generate failed' }, { status: 500 });
    }
}
