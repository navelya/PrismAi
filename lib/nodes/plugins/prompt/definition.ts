import { NodeSharedDef } from '../../core/types';

/**
 * Prompt Node Configuration
 * Provides a string output to be used as a prompt or search term
 */
export interface PromptConfig {
    text: string;
}

export const promptSharedDef: NodeSharedDef<PromptConfig> = {
    type: 'prompt',
    family: 'input',
    category: 'input',
    meta: {
        label: 'Prompt',
        description: 'Provide text or a prompt',
        icon: 'Type',
        color: '#cbd5e1',
    },
    handles: {
        inputs: [],
        outputs: [
            { id: 'text_out', label: 'Prompt', dataType: 'text' }
        ],
    },
    defaultConfig: {
        text: '',
    },
    aiSchema: {
        type: 'object',
        properties: {
            text: {
                type: 'string',
                description: 'The text prompt or search query.',
            }
        },
        required: ['text']
    }
};
