/**
 * Template search for the chat brain.
 *
 * Lets the AI find a published workflow_template whose SKELETON STRUCTURE
 * roughly matches what the user wants to build, so it can use it as a starting
 * point instead of inventing the topology from scratch. Model choices and
 * prompt text inside the template are *not* part of the match — the brain
 * adapts those to the user's request after the fact.
 *
 * Pipeline per call (target wall-clock ~700ms–1.3s):
 *   1. Load published-template metadata (id, name, description, tags,
 *      category) from a module-level TTL cache (90s) — fetch on cache miss.
 *   2. Ask Gemini Flash to pick the BEST match by name+description+tags+
 *      category, with a structured JSON response schema. Forced to return
 *      { matched: false } when nothing is genuinely close — no forced picks.
 *   3. On a hit, fetch the full workflow JSONB for the chosen template id.
 *
 * Per CLAUDE.md, this runs with a user-scoped Supabase client (RLS allows
 * authed reads of published templates) — never the service-role client.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

const MATCHER_MODEL = 'gemini-2.5-flash';
const CACHE_TTL_MS = 90_000;
const MAX_QUERY_CHARS = 600;

interface TemplateMetaRow {
  id: string;
  name: string;
  description: string | null;
  tags: string[] | null;
  category: string | null;
}

export interface MatchedTemplate {
  id: string;
  name: string;
  description: string | null;
  workflow: { nodes: any[]; edges: any[] };
}

export interface TemplateSearchResult {
  matched: boolean;
  template: MatchedTemplate | null;
  /** Short reason from the matcher (or a fallback message). Shown internally
   *  to the brain — never surfaced raw to the user. */
  why: string;
}

let cache: { fetchedAt: number; rows: TemplateMetaRow[] } | null = null;

async function loadMetadata(supabase: SupabaseClient): Promise<TemplateMetaRow[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;

  const { data, error } = await supabase
    .from('workflow_templates')
    .select('id, name, description, tags, category')
    .eq('status', 'published')
    .order('usage_count', { ascending: false })
    .limit(200);

  if (error) {
    console.warn('[template-search] metadata fetch failed:', error.message);
    return cache?.rows ?? [];
  }

  cache = { fetchedAt: now, rows: (data ?? []) as TemplateMetaRow[] };
  return cache.rows;
}

function buildCatalog(rows: TemplateMetaRow[]): string {
  return rows
    .map((t) => {
      const parts: string[] = [`id=${t.id}`, `name: ${t.name}`];
      if (t.description) parts.push(`desc: ${t.description.slice(0, 220)}`);
      if (t.tags?.length) parts.push(`tags: ${t.tags.slice(0, 8).join(', ')}`);
      if (t.category) parts.push(`category: ${t.category}`);
      return `- ${parts.join(' | ')}`;
    })
    .join('\n');
}

function buildPrompt(query: string, catalog: string): string {
  return `You are matching a user's build request to a library of workflow templates.

Below is the user's request, then a list of published templates with their names, descriptions, tags, and categories. Decide whether one template's SKELETON STRUCTURE (which node types are connected to which) would meaningfully reduce the work of building this from scratch.

Critical rules:
- The TEMPLATE'S MODEL CHOICES AND PROMPT TEXT DO NOT MATTER. Only the topology / skeleton matters. The brain will swap models and rewrite prompts after.
- Do NOT force a match. If nothing is genuinely close, return matched=false. A weak match is worse than no match — the brain will just build from scratch instead.
- Pick at most ONE template. If two are similar, pick the closer one.
- Your "why" must be one short sentence (<= 120 chars).

USER REQUEST:
"""
${query}
"""

TEMPLATES:
${catalog}`;
}

/**
 * Cheap input gate before paying for Gemini + a DB round-trip. Empty queries,
 * no API key, no published templates → instant `matched: false`.
 */
function quickReject(query: string): TemplateSearchResult | null {
  if (!genAI) return { matched: false, template: null, why: 'gemini not configured' };
  if (!query || !query.trim()) return { matched: false, template: null, why: 'empty query' };
  return null;
}

export async function doTemplateSearch(params: {
  query: string;
  supabase: SupabaseClient;
}): Promise<TemplateSearchResult> {
  const rejected = quickReject(params.query);
  if (rejected) return rejected;

  const query = params.query.trim().slice(0, MAX_QUERY_CHARS);
  const rows = await loadMetadata(params.supabase);
  if (rows.length === 0) return { matched: false, template: null, why: 'no published templates' };

  // Ask Flash for a binary match decision with structured JSON output.
  const model = genAI!.getGenerativeModel({
    model: MATCHER_MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          matched: { type: SchemaType.BOOLEAN },
          template_id: { type: SchemaType.STRING },
          why: { type: SchemaType.STRING, maxLength: 140 },
        },
        required: ['matched', 'why'],
      } as any,
    },
  });

  let parsed: { matched?: boolean; template_id?: string; why?: string } = {};
  try {
    const result = await model.generateContent(buildPrompt(query, buildCatalog(rows)));
    const text = result.response.text();
    parsed = JSON.parse(text);
  } catch (err: any) {
    console.warn('[template-search] gemini failed:', err?.message ?? err);
    return { matched: false, template: null, why: 'matcher unavailable' };
  }

  if (!parsed.matched || !parsed.template_id) {
    return { matched: false, template: null, why: parsed.why ?? 'no good fit' };
  }

  // Validate the returned id is actually one we offered. Flash can occasionally
  // hallucinate ids — fail closed rather than fetching arbitrary rows.
  const hit = rows.find((r) => r.id === parsed.template_id);
  if (!hit) {
    console.warn('[template-search] gemini returned unknown id', parsed.template_id);
    return { matched: false, template: null, why: 'matcher returned unknown id' };
  }

  // Fetch the full workflow for the matched template.
  const { data: full, error: fullErr } = await params.supabase
    .from('workflow_templates')
    .select('id, name, description, workflow')
    .eq('id', hit.id)
    .eq('status', 'published')
    .single();

  if (fullErr || !full) {
    console.warn('[template-search] full fetch failed:', fullErr?.message ?? 'no row');
    return { matched: false, template: null, why: 'template fetch failed' };
  }

  const workflow = full.workflow as { nodes?: any[]; edges?: any[] } | null;
  if (!workflow || !Array.isArray(workflow.nodes) || !Array.isArray(workflow.edges)) {
    return { matched: false, template: null, why: 'template workflow malformed' };
  }

  return {
    matched: true,
    template: {
      id: full.id,
      name: full.name,
      description: full.description ?? null,
      workflow: { nodes: workflow.nodes, edges: workflow.edges },
    },
    why: parsed.why ?? 'match',
  };
}
