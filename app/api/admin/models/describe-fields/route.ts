// app/api/admin/models/describe-fields/route.ts
// Admin-only: given a model's identity (name, provider, category, node type) and
// its list of fields (controls + input/output handles), let Gemini write a short
// end-user help tooltip for each. Used by the "Auto-generate descriptions" button
// in the model editor. Returns a map keyed by `${kind}:${api_mapping_key}`.
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { GoogleGenerativeAI, SchemaType, ResponseSchema } from '@google/generative-ai';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface FieldIn {
    kind: 'control' | 'input' | 'output';
    api_mapping_key: string;
    label?: string;
    component?: string;
    type?: string;
    options?: string[];
    min?: number;
    max?: number;
}

const RESPONSE_SCHEMA: ResponseSchema = {
    type: SchemaType.OBJECT,
    properties: {
        items: {
            type: SchemaType.ARRAY,
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    key: { type: SchemaType.STRING, description: 'The exact `key` from the input field list.' },
                    description: { type: SchemaType.STRING, description: 'One concise sentence of end-user help.' },
                },
                required: ['key', 'description'],
            },
        },
    },
    required: ['items'],
};

const SYSTEM_INSTRUCTION =
    'You write concise in-product help tooltips for the parameters of an AI image/video ' +
    'generation model. For each field, write ONE short, plain-language sentence explaining ' +
    'what it does and, when useful, when to change it. Assume a non-technical creator. ' +
    'No marketing fluff, no restating the field name, no "this field" preamble. ' +
    'Input handles are wires the user connects (e.g. a reference image); output handles are ' +
    'what the model produces. Return ONLY the structured JSON, one item per provided key.';

function fieldKey(f: { kind: string; api_mapping_key: string }) {
    return `${f.kind}:${f.api_mapping_key}`;
}

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

    const model = body?.model ?? {};
    const fields: FieldIn[] = Array.isArray(body?.fields) ? body.fields : [];
    if (fields.length === 0) {
        return NextResponse.json({ error: 'No fields to describe' }, { status: 400 });
    }

    // Compact prompt payload: each field with a stable composite key Gemini echoes back.
    const promptFields = fields.map((f) => ({
        key: fieldKey(f),
        kind: f.kind,
        name: f.label || f.api_mapping_key,
        api_key: f.api_mapping_key,
        ...(f.component ? { component: f.component } : {}),
        ...(f.type ? { type: f.type } : {}),
        ...(Array.isArray(f.options) && f.options.length ? { options: f.options } : {}),
        ...(typeof f.min === 'number' ? { min: f.min } : {}),
        ...(typeof f.max === 'number' ? { max: f.max } : {}),
    }));

    const modelContext = {
        name: model.display_name || 'Unknown model',
        provider: model.provider || undefined,
        category: model.category || undefined,
        node_type: model.node_type || undefined,
        archetype: model.archetype || undefined,
    };

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const gen = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: SYSTEM_INSTRUCTION,
            generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
        });

        const prompt =
            `Model: ${JSON.stringify(modelContext)}\n\n` +
            `Write a one-sentence help tooltip for each of these fields. ` +
            `Return one item per key, using the exact key string.\n\n` +
            `Fields:\n${JSON.stringify(promptFields)}`;

        const result = await gen.generateContent(prompt);
        const text = result.response.text().trim();
        const parsed = JSON.parse(text);
        const items: Array<{ key: string; description: string }> = Array.isArray(parsed?.items) ? parsed.items : [];

        const descriptions: Record<string, string> = {};
        const validKeys = new Set(promptFields.map((f) => f.key));
        for (const it of items) {
            if (it && typeof it.key === 'string' && validKeys.has(it.key) && typeof it.description === 'string') {
                descriptions[it.key] = it.description.trim();
            }
        }

        return NextResponse.json({ descriptions });
    } catch (err: any) {
        console.error('[admin/models/describe-fields] error:', err);
        return NextResponse.json({ error: err?.message || 'Auto-generate failed' }, { status: 500 });
    }
}
