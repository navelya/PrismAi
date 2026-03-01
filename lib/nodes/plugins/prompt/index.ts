import { NodeSharedDef } from '../../core/types';
import { PromptConfig } from '../../types';

export const promptSharedDef: NodeSharedDef<PromptConfig> = {
    type: 'prompt',
    family: 'input',
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
