import type { Workflow } from '@/lib/nodes/types';

/**
 * Formats the current canvas state for the system prompt.
 *
 * We send the workflow as JSON (lightly stripped of UI-only noise) rather
 * than a custom textual summary. Reasons:
 *   - The model already understands the workflow JSON shape (it emits
 *     the same shape in tool calls), so no translation is needed.
 *   - It carries every field that matters: model_id, prompt text, edge
 *     handles. The previous "compact" format hid these and the model
 *     ended up rebuilding workflows instead of extending them.
 *   - Forward-compatible: new node types or config fields automatically
 *     appear here without updating a formatter.
 *
 * Stripped fields (UI-only or noisy):
 *   - node.position             auto-calculated, distracts the model
 *   - node.data.label           usually a default like "Ai Generator"
 *   - node.data.isNew           internal UI flag
 *   - edge.id                   uuid never referenced by the model
 */

// ai_generator stores dynamic controls (duration, resolution, aspect_ratio,
// negative_prompt, ...) under data.config.control_values.<key>. Older saved
// workflows — and a brain bug fixed in this same change — could leave those
// keys flat in data.config alongside model_id. The UI doesn't read flat keys,
// so they're invisible state. If we send them to the AI it sees a populated
// value and replies "already set" while the property panel shows defaults.
// Stripping them forces the AI to re-emit the value into control_values,
// where the UI and executor actually look.
const AI_GENERATOR_META_KEYS = new Set([
  'model_id',
  'node_type_id',
  'control_values',
  'ui_state',
  'last_output',
]);

function sanitizeNodeConfigForBrain(type: string, config: any): any {
  if (type !== 'ai_generator' || !config || typeof config !== 'object') return config;
  const cleaned: Record<string, any> = {};
  for (const [key, val] of Object.entries(config)) {
    if (AI_GENERATOR_META_KEYS.has(key)) cleaned[key] = val;
  }
  return cleaned;
}

export function formatWorkflowContext(workflow: Workflow | null | undefined): string {
  if (!workflow || !Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
    return 'EXISTING WORKFLOW: empty canvas.';
  }

  const nodes = workflow.nodes.map((n: any) => {
    const sanitizedConfig = n.data?.config !== undefined
      ? sanitizeNodeConfigForBrain(n.type, n.data.config)
      : undefined;
    return {
      id: n.id,
      type: n.type,
      data: sanitizedConfig !== undefined ? { config: sanitizedConfig } : (n.data ?? {}),
    };
  });

  const edges = (Array.isArray(workflow.edges) ? workflow.edges : []).map((e: any) => {
    const out: Record<string, any> = { source: e.source, target: e.target };
    if (e.sourceHandle) out.sourceHandle = e.sourceHandle;
    if (e.targetHandle) out.targetHandle = e.targetHandle;
    return out;
  });

  const json = JSON.stringify({ nodes, edges }, null, 2);

  return `EXISTING WORKFLOW (already on canvas — extend it, don't rebuild):

${json}`;
}
