import { NodeSharedDef } from '../../core/types';
import { RemoveBackgroundConfig } from '../../types';

export const removeBackgroundSharedDef: NodeSharedDef<RemoveBackgroundConfig> = {
    type: 'remove_background',
    family: 'utility', // UI menu
    category: 'generative', // Execution behavior
    creditCost: 1,
    meta: {
        label: 'Remove Background',
        description: 'Remove backgrounds from images',
        color: '#f093fb',
        icon: 'Scissors',
    },
    handles: {
        inputs: [{ id: 'images_in', label: 'Images', expectedType: ['image', 'image_array'], isMandatory: true }],
        outputs: [{ id: 'images_out', label: 'Images', dataType: 'image_array' }],
    },
    defaultConfig: {
        format: 'png',
    },
    aiSchema: {
        type: 'object',
        properties: {
            format: { type: 'string', enum: ['png', 'webp'] }
        }
    }
};
