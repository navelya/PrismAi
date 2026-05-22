'use client';

import React, { createContext, useContext, useMemo, useRef } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { useExecutionValidation } from './use-execution-validation';
import type { ValidationError } from '@/lib/workflow/validate-execution';

const EMPTY_ERRORS: ValidationError[] = [];
const EMPTY_MAP: Record<string, ValidationError[]> = {};

const NodeValidationContext = createContext<Record<string, ValidationError[]>>(EMPTY_MAP);

/**
 * Computes pre-flight wiring validation ONCE for the whole canvas and shares the
 * per-node error map via context. Previously every BaseNode called
 * useExecutionValidation itself, which (a) ran validateExecution per node →
 * O(n²) across the canvas, and (b) subscribed every node to `currentWorkflow`,
 * so a single node's selection flip re-rendered (and re-validated) all of them.
 *
 * Two things keep selection O(1) for nodes:
 *   1. Validation only runs while the run-time error flash is active — the only
 *      time the per-node badges are shown. The rest of the time it's skipped.
 *   2. The provided map reference is stabilized by content signature, so a
 *      currentWorkflow change that doesn't alter validation (selecting a node)
 *      leaves the context value identical and consumers don't re-render.
 */
export function NodeValidationProvider({ children }: { children: React.ReactNode }) {
    const errorFlashActive = useAppStore((s) => s.errorFlashActive);
    const { errorsByNode } = useExecutionValidation(errorFlashActive);

    // Cheap when there are no errors (the common case → "{}"). Errors are few.
    const signature = useMemo(() => JSON.stringify(errorsByNode), [errorsByNode]);
    const mapRef = useRef<Record<string, ValidationError[]>>(errorsByNode);
    const sigRef = useRef<string>(signature);
    if (signature !== sigRef.current) {
        sigRef.current = signature;
        mapRef.current = errorsByNode;
    }

    return (
        <NodeValidationContext.Provider value={mapRef.current}>
            {children}
        </NodeValidationContext.Provider>
    );
}

/** Per-node pre-flight validation errors. Empty unless the error flash is active. */
export function useNodeValidationErrors(nodeId: string): ValidationError[] {
    const map = useContext(NodeValidationContext);
    return map[nodeId] ?? EMPTY_ERRORS;
}
