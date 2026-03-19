/**
 * Node State Validation Utilities
 * 
 * Validates consistency of node states, ensuring:
 * - Success nodes have output
 * - Error nodes have error messages
 * - Pending/running nodes don't have final states
 * - Status transitions are valid
 */

import { NodeStatus } from '@/lib/store/types';

export interface NodeStateValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * Validate a single node's state consistency
 */
export function validateNodeState(
    nodeId: string,
    nodeType: string,
    status: NodeStatus | undefined,
    data: any
): NodeStateValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check: Success nodes should have output
    if (status === 'success') {
        if (!data?.output && !data?.outputMetadata) {
            errors.push(`Node ${nodeId} (${nodeType}) has 'success' status but no output or outputMetadata`);
        }
    }

    // Check: Error nodes should have error message
    if (status === 'error') {
        if (!data?.error) {
            warnings.push(`Node ${nodeId} (${nodeType}) has 'error' status but no error message`);
        }
    }

    // Check: Pending/running nodes shouldn't have final states
    if (status === 'pending' || status === 'running') {
        if (data?.output) {
            warnings.push(`Node ${nodeId} (${nodeType}) has '${status}' status but already has output (stale state?)`);
        }
        if (data?.error) {
            warnings.push(`Node ${nodeId} (${nodeType}) has '${status}' status but has error message (inconsistent state)`);
        }
    }

    // Check: Idle nodes shouldn't have execution artifacts
    if (status === 'idle') {
        if (data?.error) {
            warnings.push(`Node ${nodeId} (${nodeType}) is 'idle' but has error message (should be cleared)`);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Validate all nodes in a workflow
 */
export function validateWorkflowState(workflow: any): NodeStateValidationResult {
    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    if (!workflow?.nodes) {
        allErrors.push('Workflow has no nodes');
        return { valid: false, errors: allErrors, warnings: allWarnings };
    }

    workflow.nodes.forEach((node: any) => {
        const result = validateNodeState(
            node.id,
            node.type,
            node.data?.status,
            node.data
        );
        allErrors.push(...result.errors);
        allWarnings.push(...result.warnings);
    });

    return {
        valid: allErrors.length === 0,
        errors: allErrors,
        warnings: allWarnings
    };
}

/**
 * Check if a status transition is valid
 * ✅ PHASE 3 FIX: Allow re-runs from completed states
 */
export function isValidStatusTransition(
    fromStatus: NodeStatus | undefined,
    toStatus: NodeStatus
): boolean {
    // Undefined/null (never set) can go to any status
    if (!fromStatus) return true;

    // Same status is always allowed (idempotent updates)
    if (fromStatus === toStatus) return true;

    // Define valid transitions
    const validTransitions: Record<NodeStatus, NodeStatus[]> = {
        idle: ['pending', 'running'],  // idle → pending (queued) or running (sync)
        pending: ['running', 'success', 'error', 'idle'],  // pending → running → terminal, or cancelled → idle
        running: ['success', 'error', 'pending', 'idle'],  // running → terminal, retry → pending, cancel → idle
        success: ['idle', 'pending', 'running'],  // ✅ FIX: Allow re-run directly to running (for sync execution)
        error: ['idle', 'pending', 'running'],  // ✅ FIX: Allow retry directly to running
    };

    const allowedNextStates = validTransitions[fromStatus] || [];
    return allowedNextStates.includes(toStatus);
}

/**
 * Log validation results (for debugging)
 */
export function logValidationResults(
    results: NodeStateValidationResult,
    context: string
): void {
    if (!results.valid && results.errors.length > 0) {
        console.error(`[${context}] Node state validation FAILED:`);
        results.errors.forEach(err => console.error(`  - ${err}`));
    }

    if (results.warnings.length > 0) {
        console.warn(`[${context}] Node state validation warnings:`);
        results.warnings.forEach(warn => console.warn(`  - ${warn}`));
    }

    if (results.valid && results.warnings.length === 0) {
        console.log(`[${context}] Node state validation PASSED`);
    }
}
