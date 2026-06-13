import { NodeSharedDef } from '../../core/types';

/**
 * Compare node — a side-by-side before/after inspector.
 *
 * Two polymorphic media inputs (`input_a` on the left, `input_b` on the right),
 * each accepting a single image OR video. A draggable vertical divider wipes
 * between them: left of the divider shows input A, right shows input B.
 *
 * The two outputs are PURE 1:1 PASSTHROUGHS — `output_a` re-emits whatever fed
 * `input_a`, `output_b` re-emits `input_b`, with no transformation. Their types
 * narrow to match the connected media (image vs video) just like the inputs.
 *
 * The engine reads one result per node, so genuine per-output routing relies on
 * a small carve-out (keyed on `node.type === 'compare'`) in the three input-
 * building choke points:
 *   - lib/hooks/use-node-auto-compute.ts  (live compute)
 *   - lib/workflow/orchestrator.ts        (server run)
 *   - lib/workflow/ephemeral-executor.ts  (standalone ephemeral)
 * The mapping is fixed: output_a → slot 0, output_b → slot 1.
 */
export interface CompareConfig {
    /** Divider position as a percentage of node width, 0 (full B) … 100 (full A). */
    dividerPosition: number;
}

export const compareSharedDef: NodeSharedDef<CompareConfig> = {
    type: 'compare',
    family: 'utility',
    category: 'utility',
    meta: {
        label: 'Compare',
        description:
            'Side-by-side before/after comparison of two images or videos with a draggable divider. ' +
            'Passes both inputs straight through to two outputs unchanged.',
        color: '#a855f7',
        icon: 'SplitSquareHorizontal',
        ephemeral: true,
    },
    handles: {
        inputs: [
            // Polymorphic single-media inputs. The component narrows the visible
            // label/color to whatever (image|video) is actually flowing in.
            { id: 'input_a', label: 'A', expectedType: ['image', 'video'] },
            { id: 'input_b', label: 'B', expectedType: ['image', 'video'] },
        ],
        // Pure passthroughs. Static dataType is the broad union; the component
        // narrows each handle to match its corresponding input. The fixed handle
        // ids (output_a / output_b) are what the per-handle routing carve-out
        // keys on — see definition header.
        outputs: [
            { id: 'output_a', label: 'A', dataType: ['image', 'video'] },
            { id: 'output_b', label: 'B', dataType: ['image', 'video'] },
        ],
    },
    defaultConfig: {
        dividerPosition: 50,
    },
    aiSchema: {
        type: 'object',
        properties: {
            dividerPosition: {
                type: 'number',
                description:
                    'Initial position of the comparison divider, as a percentage of the node width. ' +
                    '0 reveals only input B, 100 reveals only input A, 50 (default) is a centered split. ' +
                    'The user can drag the divider freely after the node is created.',
                minimum: 0,
                maximum: 100,
                default: 50,
            },
        },
    },
};
