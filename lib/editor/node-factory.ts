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
        scrape_images: {
            searchTerm: 'images',
            limit: 10,
            imageSize: 'any',
            imageType: 'any',
            colorType: 'any',
            safeSearch: 'medium',
        },
        remove_background: {
            format: 'png' as const,
        },
        filter_sort: {
            criteria: 'resolution' as const,
            order: 'asc' as const,
        },
        ai_generate_image: {
            prompt: 'A beautiful image',
            aspectRatio: '1:1' as const,
        },
        upscale_image: {
            scale: 4 as const,
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
