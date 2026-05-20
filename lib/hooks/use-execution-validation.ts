import { useMemo } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import { validateExecution, type ValidationError } from '@/lib/workflow/validate-execution';

export function useExecutionValidation(): {
    errors: ValidationError[];
    errorsByNode: Record<string, ValidationError[]>;
} {
    const workflow = useAppStore((s) => s.currentWorkflow);
    const runFromNodeId = useAppStore((s) => s.runFromNodeId);
    const runMode = useAppStore((s) => s.runMode);
    const nodeOutputs = useAppStore((s) => s.nodeOutputs);
    const models = useAppStore((s) => s.models);

    // A node is "complete with usable data" iff we have a non-null cached
    // output for it (live or persisted). Status alone isn't enough — a node
    // can be 'success' but the output may not be a usable envelope.
    const completedNodeIds = useMemo(() => {
        const ids = new Set<string>();
        if (!workflow) return ids;
        for (const n of workflow.nodes) {
            const liveOut = nodeOutputs?.[n.id];
            const persistedOut = (n.data as any)?.output;
            if (liveOut != null || persistedOut != null) {
                ids.add(n.id);
            }
        }
        return ids;
    }, [workflow, nodeOutputs]);

    // Map store runMode (possibly null / 'ab_test') to validator runMode.
    // No runFromNodeId means "Run Workflow" → 'all'. ab_test runs one node at
    // a time, so validate it like solo. 'selection' is a transient trigger
    // signal for the multi-select toolbar — fall back to 'all' here because
    // the toolbar runs its own per-selection validation.
    const { effectiveMode, targetNodeId } = useMemo<{
        effectiveMode: 'all' | 'solo' | 'chain';
        targetNodeId: string | null;
    }>(() => {
        if (!runFromNodeId || runMode === 'selection') return { effectiveMode: 'all', targetNodeId: null };
        if (runMode === 'chain') return { effectiveMode: 'chain', targetNodeId: runFromNodeId };
        return { effectiveMode: 'solo', targetNodeId: runFromNodeId };
    }, [runFromNodeId, runMode]);

    const errors = useMemo(() => {
        if (!workflow) return [] as ValidationError[];
        return validateExecution({
            workflow,
            runMode: effectiveMode,
            targetNodeId,
            completedNodeIds,
            sharedRegistry,
            models: models,
        });
    }, [workflow, effectiveMode, targetNodeId, completedNodeIds, models]);

    const errorsByNode = useMemo(() => {
        const map: Record<string, ValidationError[]> = {};
        for (const e of errors) {
            (map[e.nodeId] ||= []).push(e);
        }
        return map;
    }, [errors]);

    return { errors, errorsByNode };
}
