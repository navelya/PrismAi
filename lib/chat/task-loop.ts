import {
  GROUP_PADDING_X,
  GROUP_PADDING_Y_TOP,
  GROUP_PADDING_Y_BOTTOM,
} from './config';
import type { TaskBlueprint } from './streaming/protocol';

/** Sleep helper. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Given a task with a `group` descriptor, produce the augmented nodes/edges
 * arrays the server will pass to `dispatchTool('add_node', ...)`. The synthesis
 * is deterministic and lives server-side — the model declares "these nodes go
 * in a group called X with icon Y" and we materialize the container.
 *
 * Returns the original arrays unchanged when task.group is absent or
 * task.nodes is empty (degenerate — bbox math would NaN).
 *
 * Modification ops (updatedNodes/removedNodeIds) pass through untouched — group
 * synthesis only concerns newly-added nodes, but a task may also edit or delete
 * existing canvas nodes, and those must reach applyBlueprintWithRepair.
 */
export function synthesizeTaskBlueprint(
  task: TaskBlueprint,
): { nodes: any[]; edges: any[]; updatedNodes?: any[]; removedNodeIds?: string[] } {
  const mutations = {
    ...(Array.isArray(task.updatedNodes) && task.updatedNodes.length > 0 ? { updatedNodes: task.updatedNodes } : {}),
    ...(Array.isArray(task.removedNodeIds) && task.removedNodeIds.length > 0 ? { removedNodeIds: task.removedNodeIds } : {}),
  };

  if (!task.group || task.nodes.length === 0) {
    return { nodes: task.nodes, edges: task.edges, ...mutations };
  }

  const xs = task.nodes.map((n: any) => n.position?.x ?? 0);
  const ys = task.nodes.map((n: any) => n.position?.y ?? 0);
  const ws = task.nodes.map((n: any) => n.measured?.width ?? n.width ?? 240);
  const hs = task.nodes.map((n: any) => n.measured?.height ?? n.height ?? 120);

  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs.map((x: number, i: number) => x + ws[i]));
  const maxY = Math.max(...ys.map((y: number, i: number) => y + hs[i]));

  const groupPos = { x: minX - GROUP_PADDING_X, y: minY - GROUP_PADDING_Y_TOP };
  const groupWidth = (maxX - minX) + GROUP_PADDING_X * 2;
  const groupHeight = (maxY - minY) + GROUP_PADDING_Y_TOP + GROUP_PADDING_Y_BOTTOM;

  const groupId = `group_${task.id}`;

  const groupNode = {
    id: groupId,
    type: 'group_container',
    position: groupPos,
    data: {
      label: task.group.label,
      config: {
        width: groupWidth,
        height: groupHeight,
        icon: task.group.icon,
        color: task.group.color ?? 'neutral',
      },
    },
    zIndex: 0,
  };

  // Children become parent-relative.
  const children = task.nodes.map((n: any) => ({
    ...n,
    parentNode: groupId,
    position: {
      x: (n.position?.x ?? 0) - groupPos.x,
      y: (n.position?.y ?? 0) - groupPos.y,
    },
  }));

  // Group BEFORE its children — React Flow requires parent-first order.
  return {
    nodes: [groupNode, ...children],
    edges: task.edges,
    ...mutations,
  };
}
