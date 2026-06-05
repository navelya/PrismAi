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

/** Unique node `type` values present in a workflow, excluding non-executable group containers. */
export function deriveNodesUsed(wf: TemplateWorkflow | null | undefined): string[] {
  const types = (wf?.nodes ?? [])
    .map((n) => n.type)
    .filter((t): t is string => !!t && t !== 'group_container');
  return Array.from(new Set(types));
}
