import { NodeSharedDef } from '../../core/types';
import { FilterSortConfig } from '../../types';

export const filterSortSharedDef: NodeSharedDef<FilterSortConfig> = {
    type: 'filter_sort',
    family: 'utility',
    meta: {
        label: 'Filter & Sort',
        description: 'Filter and sort image arrays',
        color: '#4ade80',
        icon: 'ArrowUpDown',
    },
    handles: {
        inputs: [{ id: 'images_in', label: 'Images', expectedType: ['image', 'image_array'], isMandatory: true }],
        outputs: [{ id: 'images_out', label: 'Images', dataType: 'image_array' }],
    },
    defaultConfig: {
        criteria: 'resolution',
        order: 'asc',
    },
    aiSchema: {
        type: 'object',
        properties: {
            criteria: { type: 'string', enum: ['resolution', 'size', 'format'] },
            order: { type: 'string', enum: ['asc', 'desc'] },
            limit: { type: 'number', description: 'Optional limit' }
        },
        required: ['criteria', 'order']
    }
};
