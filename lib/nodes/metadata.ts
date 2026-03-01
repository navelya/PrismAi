/**
 * Node metadata for UI display
 * 
 * GENERIC INPUT HANDLES:
 * - `inputs` array defines all input handles for the node
 * - If not specified, defaults to single input handle
 * - Each input has: id (handle ID), label (display name), color (handle color)
 */
export const nodeMetadata: Record<string, {
    label: string;
    description: string;
    color: string;
    icon: string;
    inputs?: Array<{ id: string; label: string; color: string }>;
    dynamicInputs?: boolean;
}> = {
    scrape_images: {
        label: 'Scrape Images',
        description: 'Search and fetch images from the web',
        color: '#667eea',
        icon: 'Search',
        inputs: [{ id: 'prompt_in', label: 'Query', color: '#94a3b8' }],
    },
    remove_background: {
        label: 'Remove Background',
        description: 'Remove backgrounds from images',
        color: '#f093fb',
        icon: 'Scissors',
        // Single default input (handled by CustomNode)
    },
    filter_sort: {
        label: 'Filter & Sort',
        description: 'Filter and sort image arrays',
        color: '#4ade80',
        icon: 'ArrowUpDown',
    },
    ai_generate_image: {
        label: 'AI Generate',
        description: 'Generate images with AI',
        color: '#fbbf24',
        icon: 'Sparkles',
        inputs: [{ id: 'prompt_in', label: 'Prompt', color: '#94a3b8' }],
    },
    upscale_image: {
        label: 'Upscale Image',
        description: 'AI-powered image super-resolution (2x/4x)',
        color: '#ec4899',
        icon: 'Maximize2',
    },
    merge_image: {
        label: 'Merge Image',
        description: 'Composite overlay onto base image',
        color: '#14b8a6',
        icon: 'Layers',
        // TWO input handles for base and overlay
        inputs: [
            { id: 'base', label: 'BASE', color: '#22c55e' },
            { id: 'overlay', label: 'OVER', color: '#f59e0b' },
        ],
    },
    media_input: {
        label: 'Media Input',
        description: 'Upload images manually',
        color: '#3b82f6',
        icon: 'ImagePlus',
        // No inputs - this is a source node (manual upload)
    },
    compositor: {
        label: 'Compositor',
        description: 'Layer-based image compositing',
        color: '#8b5cf6',
        icon: 'Layers2',
        // Dynamic inputs - handled by CompositorNode
        dynamicInputs: true,
    },
    prompt: {
        label: 'Prompt',
        description: 'Text prompt generator',
        color: '#cbd5e1',
        icon: 'Type',
    },
};
