import { WorkflowNode, NodeType } from '../nodes/types';
import { generateNodeId } from '../utils';

/**
 * Create a new node instance from a node type.
 * Pass `initialConfig` to pre-populate fields (e.g. images array for asset drag-to-canvas).
 */
export function createNodeFromType(
    type: NodeType,
    position: { x: number; y: number },
    nodeTypeId?: string,
    modelId?: number,
    initialConfig?: Partial<Record<string, any>>
): WorkflowNode {
    const id = generateNodeId();

    // Default configurations for each node type
    const defaultConfigs: Record<NodeType, Record<string, any>> = {
        media_input: {
            images: [],
        },
        compositor: {
            canvasWidth: 1080,
            canvasHeight: 1080,
            backgroundColor: '#00000000',
            layers: [],
            outputFormat: 'png',
            outputQuality: 1.0,
        },
        prompt: {
            text: '',
        },
        ai_generator: {
            node_type_id: nodeTypeId,
            model_id: modelId,
            control_values: {},
        },
        blur: {
            radius: 5,
        },
        levels: {
            black_point: 0,
            white_point: 255,
            gamma: 1.0,
        },
        group_container: {
            width: 400,
            height: 300,
        },
        note: {
            text: '',
            author: null,
        },
        collect: {
            takeOnlyActive: false,
        },
        compare: {
            dividerPosition: 50,
        },
    };

    // Merge caller-supplied initialConfig over the defaults
    const config = initialConfig
        ? { ...defaultConfigs[type], ...initialConfig }
        : defaultConfigs[type];

    return {
        id,
        type,
        position,
        data: {
            label: type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
            config,
            isNew: true,
        },
    };
}
