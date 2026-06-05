// lib/templates/merge-into-canvas.ts
import { sanitizeTemplateWorkflow, type TemplateWorkflow } from './snapshot';

export interface PreparedTemplate {
  nodes: any[];
  edges: any[];
}

/**
 * Prepare a template's workflow to be ADDED to an existing canvas (not replace it):
 * - strip outputs/runtime state so the added nodes start clean and ready to run
 * - give every node + edge a fresh id so nothing collides with / overwrites
 *   current nodes
 * - offset the whole graph to the right of existing content so it lands in empty
 *   space
 * Mirrors how AI-generated nodes are merged onto the canvas.
 */
export function prepareTemplateForCanvas(
  partial: TemplateWorkflow,
  existingNodes: any[],
  stamp: number,
): PreparedTemplate {
  const clean = sanitizeTemplateWorkflow(partial);
  const idMap = new Map<string, string>();
  clean.nodes.forEach((n, i) => idMap.set(n.id, `tpl_${stamp}_${i}`));

  let dx = 0, dy = 0;
  if (existingNodes.length && clean.nodes.length) {
    const exMaxX = Math.max(...existingNodes.map((n) => (n.position?.x ?? 0) + (n.width ?? n.measured?.width ?? 320)));
    const exMinY = Math.min(...existingNodes.map((n) => n.position?.y ?? 0));
    const tplMinX = Math.min(...clean.nodes.map((n) => n.position?.x ?? 0));
    const tplMinY = Math.min(...clean.nodes.map((n) => n.position?.y ?? 0));
    dx = exMaxX + 120 - tplMinX;
    dy = exMinY - tplMinY;
  }

  const nodes = clean.nodes.map((n) => ({
    ...n,
    id: idMap.get(n.id)!,
    position: { x: (n.position?.x ?? 0) + dx, y: (n.position?.y ?? 0) + dy },
    parentNode: n.parentNode && idMap.has(n.parentNode) ? idMap.get(n.parentNode) : n.parentNode,
    selected: false,
    data: { ...(n.data ?? {}), isNew: true },
  }));

  const edges = (clean.edges ?? []).map((e, i) => ({
    ...e,
    id: `tple_${stamp}_${i}`,
    source: idMap.get(e.source) ?? e.source,
    target: idMap.get(e.target) ?? e.target,
    selected: false,
  }));

  return { nodes, edges };
}
