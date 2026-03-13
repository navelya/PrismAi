import { NodeSharedDef } from './types';
import { promptSharedDef } from '../plugins/prompt';
import { aiGenerateImageSharedDef } from '../plugins/ai_generate_image';
import { mediaInputSharedDef } from '../plugins/media_input';
import { compositorSharedDef } from '../plugins/compositor';

// The global shared registry mapping definition types
// This is safe to import { promptSharedDef } from '../plugins/prompt';

export const sharedRegistry: Record<string, NodeSharedDef<any>> = {
    prompt: promptSharedDef,
    ai_generate_image: aiGenerateImageSharedDef,
    media_input: mediaInputSharedDef,
    compositor: compositorSharedDef,
    ai_generator: {
        type: 'ai_generator',
        family: 'generative',
        category: 'generative',
        meta: {
            label: 'AI Model',
            color: 'rgb(var(--accent-primary))',
            icon: 'Zap',
        },
        handles: {
            inputs: [],
            outputs: [],
        },
    } as any,
};
