import { useMemo } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import { validateExecution, type ValidationError } from '@/lib/workflow/validate-execution';

/**
 * Solo-run pre-flight validation for ONE node — the SAME validateExecution the
 * multi-select toolbar uses for `selectionRunErrors` (see EditorCanvas), but
 * scoped to `runMode: 'solo'` for `nodeId`. Returns the wiring errors that would
 * stop this node's Run button from doing anything (empty = runnable).
 *
 * Unlike useNodeValidationErrors (which only populates during the run-time error
 * flash, to keep the canvas-wide badge pass cheap), this is always live so a
 * per-node Run button can disable + explain itself BEFORE the user clicks. Only
 * a handful of generative nodes render a Run button, so the per-node
 * validateExecution pass is bounded — this is not the O(n²) per-node case the
 * shared NodeValidationProvider was built to avoid.
 */
export function useNodeRunValidation(nodeId: string | undefined): ValidationError[] {
    const workflow = useAppStore((s) => s.currentWorkflow);
    const nodeOutputs = useAppStore((s) => s.nodeOutputs);
    const models = useAppStore((s) => s.models);

    return useMemo(() => {
        if (!nodeId || !workflow) return [];
        // Mirror the selection-toolbar completed-set: a node counts as "has
        // usable data" iff it has a non-null live or persisted output.
        const completedNodeIds = new Set<string>();
        for (const n of workflow.nodes) {
            const liveOut = nodeOutputs?.[n.id];
            const persistedOut = (n.data as any)?.output;
            if (liveOut != null || persistedOut != null) completedNodeIds.add(n.id);
        }
        return validateExecution({
            workflow,
            runMode: 'solo',
            targetNodeId: nodeId,
            completedNodeIds,
            sharedRegistry,
            models: models ?? [],
        });
    }, [nodeId, workflow, nodeOutputs, models]);
}
