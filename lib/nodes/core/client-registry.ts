import { NodeClientDef } from './types';
import { mediaInputClientDef } from '../plugins/media_input';
import { compositorClientDef } from '../plugins/compositor';
import { promptClientDef } from '../plugins/prompt';
import { blurClientDef } from '../plugins/blur';
import { aiGeneratorClientDef, AIGeneratorNode } from '../plugins/ai_generator';

export const clientRegistry: Record<string, NodeClientDef> = {
    prompt: promptClientDef,
    media_input: mediaInputClientDef,
    compositor: compositorClientDef,
    blur: blurClientDef,
    ai_generator: aiGeneratorClientDef,
};

export const FallbackNode = AIGeneratorNode;
