import { NodeSharedDef } from './types';
import { promptSharedDef } from '../plugins/prompt';
import { mediaInputSharedDef } from '../plugins/media_input';
import { compositorSharedDef } from '../plugins/compositor';
import { blurSharedDef } from '../plugins/blur';

// The global shared registry mapping definition types
// This is safe to import { promptSharedDef } from '../plugins/prompt';

export const sharedRegistry: Record<string, NodeSharedDef<any>> = {
    prompt: promptSharedDef,
    media_input: mediaInputSharedDef,
    compositor: compositorSharedDef,
    blur: blurSharedDef,
    ai_generator: {
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
    } as any,
    group: {
        type: 'group',
        family: 'organization',
        category: 'organization',
        meta: {
            label: 'Group',
            color: 'rgb(var(--stroke-subtle))',
            icon: 'Group',
        },
        // Groups have no handles — they are visual containers, not executable nodes.
        handles: {
            inputs: [],
            outputs: [],
        },
        defaultConfig: {
            width: 400,
            height: 300,
        },
        nonExecutable: true,
    } as any,
};
