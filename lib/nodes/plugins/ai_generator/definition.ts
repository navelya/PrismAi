import { NodeSharedDef } from '../../core/types';
import type { GeneratedOutput } from './outputs';

/**
 * AI Generator Node Configuration
 * Dynamic node that adapts based on selected model from the catalog
 */
export interface AIGeneratorConfig {
    model_id?: number;
    node_type_id?: string;
    control_values?: Record<string, any>;
    /** Selected output value, mirrored for preview/hydration. */
    last_output?: any;
    /** All outputs this node has produced, newest-first. */
    outputs?: GeneratedOutput[];
    /** Index into `outputs` of the active/selected output. Default 0. */
    selected_output_index?: number;
    /** Number of independent generations per run (1–8). Multiplies cost. Never sent to the model. */
    iterations?: number;
}

export const aiGeneratorSharedDef: NodeSharedDef<AIGeneratorConfig> = {
    type: 'ai_generator',
    family: 'generative',
    category: 'generative',
    meta: {
        label: 'AI Model',
        color: 'rgb(var(--accent-primary))',
        icon: 'Zap',
    },
    // ✅ PHASE 2 FIX: Populate handles for AI visibility
    // ISSUE: Empty handles prevented AI agent from connecting nodes to ai_generator
    // SOLUTION: Define standard input/output handles that work with all Replicate models
    handles: {
        inputs: [
            {
                id: 'trigger',
                type: 'trigger',
                label: 'Trigger',
                description: 'Execute this node',
                position: 'left' as const,
            },
            {
                id: 'prompt',
                type: 'string',
                label: 'Prompt',
                description: 'Text prompt for generation (if model supports it)',
                position: 'left' as const,
                optional: true,
            },
            {
                id: 'image',
                type: 'image',
                label: 'Image Input',
                description: 'Optional image input for models that support it',
                position: 'left' as const,
                optional: true,
            }
        ],
        outputs: [
            {
                id: 'output',
                type: 'any',
                label: 'Result',
                description: 'Generated output (image, text, or other data)',
                position: 'right' as const,
            },
            {
                id: 'trigger_out',
                type: 'trigger',
                label: 'Complete',
                description: 'Fires when generation completes successfully',
                position: 'right' as const,
            }
        ],
    },
    defaultConfig: {
        model_id: null,
        control_values: {}
    }
} as any;
