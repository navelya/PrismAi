import type { Workflow, AiModel } from '@/lib/nodes/types';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import { validateExecution, type ValidationError } from './validate-execution';

function formatError(e: ValidationError): string {
    switch (e.kind) {
        case 'missing-required-input':
            return `"${e.nodeLabel}" needs its "${e.inputLabel}" input connected before it can run.`;
        case 'type-mismatch':
            return `"${e.nodeLabel}"'s "${e.inputLabel}" expects ${e.expectedType} but got ${e.actualType}.`;
        case 'no-upstream-data':
            return `"${e.nodeLabel}" needs "${e.sourceNodeLabel}" to run first.`;
        default:
            return "This workflow can't run yet.";
    }
}

/**
 * Pre-flight validation for a chat-triggered (selection-mode) run, mirroring
 * the gate in SharedWorkflowEditor.commitExecution. Returns a short,
 * user-readable message for the first blocking issue, or null if the run can
 * dispatch.
 *
 * This lets the chat avoid optimistically marking a proposal "running" for a
 * run that commitExecution would silently abort (e.g. an AI-built node whose
 * mandatory input isn't wired yet), which otherwise left the card stuck on
 * "Running…" with nothing happening on the canvas.
 *
 * Note: selection-mode validation only surfaces missing-required-input and
 * type-mismatch — no-upstream-data is intentionally suppressed for selections
 * (the whole set runs together) — so completedNodeIds is irrelevant here.
 */
export function firstChatRunError(
    workflow: Workflow | null | undefined,
    runTargetIds: string[],
    models: AiModel[],
): string | null {
    if (!workflow || runTargetIds.length === 0) return null;
    const errors = validateExecution({
        workflow,
        runMode: 'selection',
        targetNodeId: null,
        targetNodeIds: runTargetIds,
        completedNodeIds: new Set<string>(),
        sharedRegistry,
        models: models ?? [],
    });
    return errors.length > 0 ? formatError(errors[0]) : null;
}
