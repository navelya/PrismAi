// lib/templates/snapshot.ts
// Pure helpers shared by the convert API and the clone API. No Node/sharp/browser deps.

export interface TemplateWorkflow {
  nodes: any[];
  edges: any[];
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string | null;
  workflow: TemplateWorkflow;
  thumbnail_url: string | null;
  how_it_works: string | null;
  category: string | null;
  tags: string[];
  use_cases: string[];
  nodes_used: string[];
  source: 'official' | 'community';
  status: 'draft' | 'published' | 'archived';
  created_by: string | null;
  created_by_name: string | null;
  source_session_id: string | null;
  usage_count: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Strip per-node runtime/output state so a stored template (or a clone of one)
 * starts clean. Keeps type/position/config/parentNode/measured/width/height.
 */
export function sanitizeTemplateWorkflow(wf: TemplateWorkflow | null | undefined): TemplateWorkflow {
  const nodes = (wf?.nodes ?? []).map((n) => {
    const data = { ...(n.data ?? {}) };
    delete data.output;
    delete data.outputMetadata;
    delete data.status;
    delete data.errorMessage;
    delete data.isNew;
    return { ...n, data, selected: false };
  });
  const edges = (wf?.edges ?? []).map((e) => ({ ...e, selected: false }));
  return { nodes, edges };
}

/**
 * Collapse every node's accumulated results down to just its currently-active
 * one, so a stored template carries only the result the author selected — not
 * the other N iterations they generated and discarded. The active item is kept
 * (not stripped) so the template detail view still renders a faithful preview;
 * a clone later runs {@link sanitizeTemplateWorkflow} to drop even that.
 *
 * Today only `ai_generator` accumulates multiple results, in
 * `config.outputs` (newest-first) with `config.selected_output_index` marking
 * the active one. Single-output nodes pass through untouched.
 */
export function collapseToActiveResults(wf: TemplateWorkflow | null | undefined): TemplateWorkflow {
  const nodes = (wf?.nodes ?? []).map((n) => {
    const config = n?.data?.config;
    const outputs = config?.outputs;
    if (!Array.isArray(outputs) || outputs.length <= 1) return n;

    const len = outputs.length;
    const raw = config.selected_output_index;
    const idx = Math.max(0, Math.min(len - 1, Number.isFinite(raw) ? Math.trunc(raw) : 0));
    const active = outputs[idx];

    return {
      ...n,
      data: {
        ...n.data,
        config: {
          ...config,
          outputs: active ? [active] : [],
          selected_output_index: 0,
          last_output: active?.value ?? config.last_output ?? null,
        },
      },
    };
  });
  return { nodes, edges: wf?.edges ?? [] };
}

/** Unique node `type` values present in a workflow, excluding non-executable group containers. */
export function deriveNodesUsed(wf: TemplateWorkflow | null | undefined): string[] {
  const types = (wf?.nodes ?? [])
    .map((n) => n.type)
    .filter((t): t is string => !!t && t !== 'group_container');
  return Array.from(new Set(types));
}
