import React from 'react';
import { ExecutionContext, NodeExecutionResult } from '../types';

// Define all possible data types that can flow through node edges
// This should match the 'id' column in the public.data_types table
export type NodeDataType = 'image' | 'video' | 'audio' | '3d' | 'text' | 'json' | 'image_array' | 'any' | 'prompt';

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
        ephemeral?: boolean;     // If true, engine skips saving outputs to DB (live preview only)
    };
    handles: {
        inputs: Array<{ id: string; label: string; expectedType: NodeDataType | NodeDataType[]; isMandatory?: boolean; color?: string; is_array?: boolean; }>;
        outputs: Array<{ id: string; label: string; dataType: NodeDataType | NodeDataType[]; is_array?: boolean; }>;
    };
    defaultConfig: TConfig;
    aiSchema: any;       // JSON Schema (Typebox/Zod compatible) for AI structured outputs
}

/**
 * Output envelope produced by client-side executors.
 * Same shape as the server-side result envelope so consumers (notably
 * useResolvedNodeValue) can treat them identically.
 */
export type ClientExecutorResult = { type: NodeDataType; data: any[] } | null;

/**
 * Client-side executor signature.
 *
 * `inputs` is keyed by the target handle id (e.g. `"image"`), and each value
 * is the *resolved* upstream output — typically the envelope already in
 * `nodeOutputs`. The executor returns either a fresh envelope or null to
 * signal "no output yet" (e.g. missing input).
 *
 * Used by [useNodeAutoCompute](../../hooks/use-node-auto-compute.ts) to
 * recompute ephemeral nodes (Blur, Levels, ...) entirely in the browser so
 * downstream previews (Compositor) update without a server round-trip.
 */
export type ClientExecutor<TConfig = any> = (
    config: TConfig,
    inputs: Record<string, any>
) => Promise<ClientExecutorResult> | ClientExecutorResult;

// 2. Client Definition (Browser Only - Contains React Components)
export interface NodeClientDef<TConfig = any> extends NodeSharedDef<TConfig> {
    component: React.ComponentType<any>; // React Flow custom node component
    propertyPanel?: React.ComponentType<any>; // Optional custom properties UI
    /**
     * Optional pure-function executor that runs in the browser. When present,
     * `useNodeAutoCompute` will run it whenever this node's config or any
     * upstream resolved value changes, and write the result into nodeOutputs.
     */
    clientExecutor?: ClientExecutor<TConfig>;
}

// 3. Server Definition (Node.js Only - Contains Execution Logic)
export interface NodeServerDef<TConfig = any> extends NodeSharedDef<TConfig> {
    executor: (config: TConfig, inputs: Record<string, any>, context: ExecutionContext) => Promise<NodeExecutionResult>;
}
