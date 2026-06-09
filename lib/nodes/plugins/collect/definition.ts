import { NodeSharedDef, NodeDataType } from '../../core/types';

/**
 * Collect — a utility aggregator. It accepts many inputs of the SAME type and
 * emits a single array of all of them, to feed an array-consuming downstream
 * node (or to gather variations into one collection).
 *
 * - `lockedType` is set from the FIRST wired input's output type. Every
 *   subsequent input must be compatible with it (enforced by the connection
 *   validator + onConnect in the store). Clearing all inputs unlocks it.
 *   The output handle's dataType is dynamic — it resolves to `lockedType`
 *   (see `resolveDynamicOutputType` in lib/editor/handle-compatibility.ts).
 * - `takeOnlyActive` (default false) is the "Take only active" switch:
 *     OFF  → every item of every input is flattened into one straight array
 *            (an upstream that produced N results contributes all N).
 *     ON   → only each input's active/primary item is added (one per input).
 */
export interface CollectConfig {
    /** When true, take only each input's active item instead of flattening all. */
    takeOnlyActive: boolean;
    /** Data type locked by the first connected input; drives the dynamic output type. */
    lockedType?: NodeDataType | NodeDataType[];
}

export const collectSharedDef: NodeSharedDef<CollectConfig> = {
    type: 'collect',
    family: 'utility',
    category: 'utility',
    meta: {
        label: 'Collect',
        description:
            'Collect multiple inputs of the same type into a single array to pass downstream. ' +
            'The first wired input locks the type; every other input must match it. ' +
            'By default every item of every input is flattened into one array; toggle ' +
            '"Take only active" to instead take just each input\'s selected item.',
        color: '#a855f7',
        icon: 'Combine',
        dynamicInputs: true,
        ephemeral: true,
    },
    handles: {
        inputs: [
            // One variadic slot: many edges plug into `values`. expectedType is
            // 'any' until the first connection locks it (the validator then
            // narrows it via lockedType). is_array lets the store stack edges
            // instead of swapping (see onConnect's single-input enforcement).
            { id: 'values', label: 'Items', expectedType: 'any', is_array: true, isMandatory: false },
        ],
        outputs: [
            // Dynamic dataType: resolves to lockedType at runtime. Static 'any'
            // is the broad fallback when nothing is connected yet.
            { id: 'output', label: '', dataType: 'any', is_array: true },
        ],
    },
    defaultConfig: {
        takeOnlyActive: false,
    },
    aiSchema: {
        type: 'object',
        description:
            'A Collect node gathers several inputs of the same type into one array. ' +
            'Wire every source you want to collect into its single `values` input handle ' +
            '(use targetHandle "values" on each edge). All sources must share one type ' +
            '(all images, all videos, all text, etc.).',
        properties: {
            takeOnlyActive: {
                type: 'boolean',
                default: false,
                description:
                    'How inputs that themselves carry multiple results are handled. ' +
                    'false (default): flatten EVERY item of every input into one combined array. ' +
                    'true: add only each input\'s active/selected item (one per input).',
            },
        },
    },
};
