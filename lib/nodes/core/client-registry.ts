import { NodeClientDef } from './types';
import { mediaInputClientDef } from '../plugins/media_input/component';
import { compositorClientDef } from '../plugins/compositor/component';
import { promptClientDef } from '../plugins/prompt/component';
import { blurClientDef } from '../plugins/blur';
import AIGeneratorNode from '@/components/canvas/AIGeneratorNode';
import AIGeneratorProperties from '@/components/canvas/AIGeneratorProperties';

// The client-side registry mapping definition types
// Only import this in Browser/React components
export const clientRegistry: Record<string, NodeClientDef> = {
    prompt: promptClientDef,
    media_input: mediaInputClientDef,
    compositor: compositorClientDef,
    blur: blurClientDef,
    ai_generator: {
        component: AIGeneratorNode,
        propertyPanel: AIGeneratorProperties,
    } as any,
};

export const FallbackNode = AIGeneratorNode;

