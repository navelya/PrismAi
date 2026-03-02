import { NodeSharedDef } from '../../core/types';
import { AIGenerateImageConfig } from '../../types';

export const aiGenerateImageSharedDef: NodeSharedDef<AIGenerateImageConfig> = {
    type: 'ai_generate_image',
    family: 'generative',
    meta: {
        label: 'AI Generate',
        description: 'Generate images with AI',
        color: '#fbbf24',
        icon: 'Sparkles',
    },
    handles: {
        inputs: [{ id: 'prompt_in', label: 'Prompt', expectedType: 'text', isMandatory: true, color: '#94a3b8' }],
        outputs: [{ id: 'image_out', label: 'Image', dataType: 'image_array' }],
    },
    defaultConfig: {
        prompt: 'A beautiful image',
        model: 'gemini-2.5-flash-image',
        aspectRatio: '1:1',
    },
    aiSchema: {
        type: 'object',
        properties: {
            model: { type: 'string', enum: ['gemini-2.5-flash-image', 'gemini-3-pro-image-preview', 'pollinations', 'huggingface', 'gemini'] },
            aspectRatio: { type: 'string', enum: ['1:1', '16:9', '4:3'] }
        }
    }
};
