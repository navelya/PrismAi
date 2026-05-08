import type { Workflow } from '@/lib/nodes/types';

/**
 * Formats the current canvas state as a compact text block for the system
 * prompt. We do NOT include the full JSON — that's 10x the tokens for the
 * same information. ~20 lines max even for big graphs.
 */
export function formatWorkflowContext(workflow: Workflow | null | undefined): string {
  if (!workflow || !Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
    return 'CURRENT CANVAS: empty.';
  }

  const nodes = workflow.nodes;
  const edges = Array.isArray(workflow.edges) ? workflow.edges : [];

  // Build a map of node id -> outgoing edge targets for the "→" arrows.
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const sourceId = (edge as any).source;
    const targetId = (edge as any).target;
    if (!sourceId || !targetId) continue;
    if (!outgoing.has(sourceId)) outgoing.set(sourceId, []);
    outgoing.get(sourceId)!.push(targetId);
  }

  const lines = nodes.map(n => {
    const id = (n as any).id;
    const type = (n as any).type;
    const label = (n as any).data?.config?.label || (n as any).data?.config?.name || '';
    const labelPart = label ? ` "${label}"` : '';
    const targets = outgoing.get(id) || [];
    const arrowPart = targets.length > 0 ? ` → ${targets.join(', ')}` : '';
    return `- ${type}${labelPart} (id: ${id})${arrowPart}`;
  });

  return `CURRENT CANVAS — ${nodes.length} existing node${nodes.length === 1 ? '' : 's'} already on the canvas.
These nodes ALREADY EXIST. Do NOT re-add them. When the user asks to extend
or modify this workflow, only emit add_node for NEW nodes, and reference
the existing ids below as the "source" in new nodes' inputs[] to wire them
together. To change config of an existing node, use update_node with that id.

${lines.join('\n')}`;
}
