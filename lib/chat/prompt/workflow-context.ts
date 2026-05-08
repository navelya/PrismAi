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
export function formatWorkflowContext(workflow: Workflow | null | undefined): string {
  if (!workflow || !Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
    return 'EXISTING WORKFLOW: empty canvas.';
  }

  const nodes = workflow.nodes.map((n: any) => ({
    id: n.id,
    type: n.type,
    data: n.data?.config !== undefined ? { config: n.data.config } : (n.data ?? {}),
  }));

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
