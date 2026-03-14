import { WorkflowNode, NodeType, NodeConfig } from '../nodes/types';
import { generateNodeId, generateEdgeId } from '../utils';

/**
 * Create a new node instance from a node type
 */
export function createNodeFromType(
    type: NodeType,
    position: { x: number; y: number }
): WorkflowNode {
    const id = generateNodeId();

    // Default configurations for each node type
    const defaultConfigs: Record<NodeType, NodeConfig> = {
        ai_generate_image: {
            prompt: 'A beautiful image',
            model: 'gemini-2.5-flash-image' as const,
            aspectRatio: '1:1' as const,
        },
        media_input: {
            images: [],
        },
        compositor: {
            canvasWidth: 1920,
            canvasHeight: 1080,
            backgroundColor: '#00000000',
            layers: [
                {
                    id: 'layer_0',
                    name: 'Layer 1',
                    sourceHandleId: 'layer_0',
                    selectedIndex: 0,
                    transform: {
                        x: 0,
                        y: 0,
                        width: 1920,
                        height: 1080,
                        rotation: 0,
                        opacity: 1,
                        flipX: false,
                        flipY: false,
                        crop: null,
                    },
                    visible: true,
                    locked: false,
                },
                {
                    id: 'layer_1',
                    name: 'Layer 2',
                    sourceHandleId: 'layer_1',
                    selectedIndex: 0,
                    transform: {
                        x: 100,
                        y: 100,
                        width: 400,
                        height: 300,
                        rotation: 0,
                        opacity: 1,
                        flipX: false,
                        flipY: false,
                        crop: null,
                    },
                    visible: true,
                    locked: false,
                }
            ],
            outputFormat: 'png',
            outputQuality: 1.0,
        },
        prompt: {
            text: '',
        },
        ai_generator: {
            control_values: {},
        },
    };

    const config = defaultConfigs[type];

    return {
        id,
        type,
        position,
        data: {
            label: type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
            config,
        },
    };
}
