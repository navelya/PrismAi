import React from 'react';
import { clientRegistry, FallbackNode } from '@/lib/nodes/core/client-registry';

// 🛡️ STABILITY FIX: Create the base node types in a separate utility module.
// Next.js Fast Refresh often re-evaluates files that export React components,
// which breaks referential equality for module-level variables in those files.
// By isolating the types here, they are guaranteed to persist exactly once.
const baseNodeTypes = Object.entries(clientRegistry).reduce((acc, [type, def]) => {
    if (def.component) {
        acc[type] = def.component;
    }
    return acc;
}, {} as Record<string, React.ComponentType<any>>);

export const stableNodeTypes: Record<string, React.ComponentType<any>> = {
    ...baseNodeTypes,
    legacy: FallbackNode,
};

export const stableEdgeTypes = {};
