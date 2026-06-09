// app/api/admin/templates/auto-fill/route.ts
// Admin-only: read a workflow's graph (and optionally its final image) and let
// Gemini propose the template metadata — name, category, description, how-it-
// works, tags, use-cases — so the Convert-to-Template form can be auto-filled.
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { GoogleGenerativeAI, SchemaType, ResponseSchema } from '@google/generative-ai';
import { TEMPLATE_CATEGORIES } from '@/lib/templates/categories';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Compact a canvas node down to what's useful for describing the workflow:
 * its type, label, and config — minus base64/data-URI blobs and absurdly long
 * strings that would balloon the prompt without adding meaning.
 */
function summarizeNode(node: any) {
  const config = node?.data?.config ?? {};
  const slimConfig: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (typeof v === 'string') {
      if (v.startsWith('data:') || /^https?:\/\//.test(v)) continue; // drop blobs/urls
      slimConfig[k] = v.length > 600 ? `${v.slice(0, 600)}…` : v;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      slimConfig[k] = v;
    }
  }
  return {
    type: node?.type ?? 'unknown',
    label: node?.data?.label ?? null,
    config: slimConfig,
  };
}

const RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    name: { type: SchemaType.STRING, description: 'Short, punchy template name (3–6 words).' },
    category: { type: SchemaType.STRING, enum: [...TEMPLATE_CATEGORIES] },
    description: { type: SchemaType.STRING, description: 'One or two sentences on what this template produces.' },
    how_it_works: { type: SchemaType.STRING, description: 'Markdown. Explain the workflow step by step using short bullet points or numbered steps.' },
    tags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: '3–6 lowercase keyword tags.' },
    use_cases: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: '2–4 concrete use cases, one short phrase each.' },
  },
  required: ['name', 'category', 'description', 'how_it_works', 'tags', 'use_cases'],
};

const SYSTEM_INSTRUCTION =
  'You are a product copywriter for an AI image/video workflow tool. Given a workflow graph ' +
  '(and possibly its final output image), write gallery metadata for it as a reusable template. ' +
  'Be specific and concrete — infer the goal from the node types and their prompts. ' +
  `Pick the single best category from this fixed list: ${TEMPLATE_CATEGORIES.join(', ')}. ` +
  'Return ONLY the structured JSON object.';

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { supabase } = auth;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Auto-fill unavailable (GEMINI_API_KEY not set)' }, { status: 503 });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const sessionId = typeof body?.session_id === 'string' ? body.session_id : '';
  const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl : '';
  if (!sessionId) {
    return NextResponse.json({ error: 'session_id is required' }, { status: 400 });
  }

  const { data: session, error: sErr } = await supabase
    .from('sessions')
    .select('canvas_state')
    .eq('id', sessionId)
    .single();
  if (sErr || !session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const nodes = Array.isArray(session.canvas_state?.nodes) ? session.canvas_state.nodes : [];
  const edges = Array.isArray(session.canvas_state?.edges) ? session.canvas_state.edges : [];
  if (nodes.length === 0) {
    return NextResponse.json({ error: 'This workflow has no nodes to describe.' }, { status: 400 });
  }

  const summary = {
    nodes: nodes.map(summarizeNode),
    edgeCount: edges.length,
  };

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
    });

    const parts: any[] = [`Workflow graph (JSON):\n${JSON.stringify(summary)}`];

    // Multimodal: include the final image when we have one.
    if (imageUrl && /^https?:\/\//.test(imageUrl)) {
      try {
        const resp = await fetch(imageUrl);
        if (resp.ok) {
          const mimeType = resp.headers.get('content-type') || 'image/jpeg';
          const base64 = Buffer.from(await resp.arrayBuffer()).toString('base64');
          parts.push('The workflow\'s final output image:', { inlineData: { mimeType, data: base64 } });
        }
      } catch { /* image is best-effort; fall back to graph-only */ }
    }

    const result = await model.generateContent(parts);
    const text = result.response.text().trim();
    const fields = JSON.parse(text);

    return NextResponse.json({ fields });
  } catch (err: any) {
    console.error('[admin/templates/auto-fill] error:', err);
    return NextResponse.json({ error: err?.message || 'Auto-fill failed' }, { status: 500 });
  }
}
