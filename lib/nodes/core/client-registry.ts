import { NodeClientDef } from './types';
import { aiGenerateImageClientDef } from '../plugins/ai_generate_image/component';
import { mediaInputClientDef } from '../plugins/media_input/component';
import { compositorClientDef } from '../plugins/compositor/component';
import { promptClientDef } from '../plugins/prompt/component';
import LegacyNode from '@/components/canvas/LegacyNode';
import AIGeneratorNode from '@/components/canvas/AIGeneratorNode';
import AIGeneratorProperties from '@/components/canvas/AIGeneratorProperties';

// The client-side registry mapping definition types
// Only import this in Browser/React components
export const clientRegistry: Record<string, NodeClientDef> = {
    prompt: promptClientDef,
    ai_generate_image: aiGenerateImageClientDef,
    media_input: mediaInputClientDef,
    compositor: compositorClientDef,
    ai_generator: {
        component: AIGeneratorNode,
        propertyPanel: AIGeneratorProperties,
    } as any,
};

export const FallbackNode = LegacyNode;

