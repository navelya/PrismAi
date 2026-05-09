import React from 'react';
import { clientRegistry, FallbackNode } from '@/lib/nodes/core/client-registry';
import AIGeneratorNode from '@/components/canvas/AIGeneratorNode';
import GroupNode from '@/components/canvas/GroupNode';

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

const concreteNodeTypes: Record<string, React.ComponentType<any>> = {
    ...baseNodeTypes,
    ai_generator: AIGeneratorNode,
    legacy: FallbackNode,
    group: GroupNode,
};

// Dynamic AI-generator node type ids come from the DB (ai_models.node_type_id)
// at runtime, so we can't enumerate them at module load. A Proxy lets any
// unknown id resolve to AIGeneratorNode without rebuilding the object — which
// keeps the reference stable and silences React Flow's "new nodeTypes object"
// warning.
export const stableNodeTypes: Record<string, React.ComponentType<any>> = new Proxy(concreteNodeTypes, {
    get(target, prop: string) {
        if (prop in target) return target[prop];
        if (typeof prop === 'string') return AIGeneratorNode;
        return undefined;
    },
    has(target, prop: string) {
        if (prop in target) return true;
        return typeof prop === 'string';
    },
});

export const stableEdgeTypes = {};
