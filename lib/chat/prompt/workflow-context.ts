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

  return `EXISTING WORKFLOW ALREADY ON CANVAS (${nodes.length} node${nodes.length === 1 ? '' : 's'}):
${lines.join('\n')}`;
}
