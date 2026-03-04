import React from 'react';
import { ExecutionContext, NodeExecutionResult } from '../types';

// Define all possible data types that can flow through node edges
export type NodeDataType = 'image' | 'image_array' | 'text' | 'any' | 'prompt' | 'json';

// 1. Shared Definition (Isomorphic - Safe for DB, AI, and both bundles)
export interface NodeSharedDef<TConfig = any> {
    type: string;
    family: 'input' | 'generative' | 'utility' | 'output'; // Grouping for menus
    category: 'input' | 'utility' | 'generative'; // Execution rules category
    creditCost?: number; // Pre-flight check cost
    meta: {
        label: string;
        description: string;
        icon: string;    // String identifier for Lucide icons
        color: string;   // Hex or CSS variable for UI theme
        dynamicInputs?: boolean; // Flag for nodes with variable input counts
    };
    handles: {
        inputs: Array<{ id: string; label: string; expectedType: NodeDataType | NodeDataType[]; isMandatory?: boolean; color?: string; }>;
        outputs: Array<{ id: string; label: string; dataType: NodeDataType }>;
    };
    defaultConfig: TConfig;
    aiSchema: any;       // JSON Schema (Typebox/Zod compatible) for AI structured outputs
}

// 2. Client Definition (Browser Only - Contains React Components)
export interface NodeClientDef<TConfig = any> extends NodeSharedDef<TConfig> {
    component: React.ComponentType<any>; // React Flow custom node component
    propertyPanel?: React.ComponentType<any>; // Optional custom properties UI
}

// 3. Server Definition (Node.js Only - Contains Execution Logic)
export interface NodeServerDef<TConfig = any> extends NodeSharedDef<TConfig> {
    executor: (config: TConfig, inputs: Record<string, any>, context: ExecutionContext) => Promise<NodeExecutionResult>;
}
