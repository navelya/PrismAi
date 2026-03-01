import { NodeSharedDef } from '../../core/types';

export interface TextInputConfig {
    text: string;
}

export const textInputSharedDef: NodeSharedDef<TextInputConfig> = {
    type: 'text_input',
    family: 'input',
    meta: {
        label: 'Text Input',
        description: 'Provide text or a prompt',
        icon: 'Type',
        color: 'rgb(var(--accent-primary))',
    },
    handles: {
        inputs: [],
        outputs: [
            { id: 'text_out', label: 'Text', dataType: 'text' }
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
