import { NodeClientDef } from './types';
import { mediaInputClientDef } from '../plugins/media_input';
import { compositorClientDef } from '../plugins/compositor';
import { promptClientDef } from '../plugins/prompt';
import { blurClientDef } from '../plugins/blur';
import { levelsClientDef } from '../plugins/levels';
import { aiGeneratorClientDef, AIGeneratorNode } from '../plugins/ai_generator';
import { characterClientDef } from '../plugins/character';

export const clientRegistry: Record<string, NodeClientDef> = {
    prompt: promptClientDef,
    media_input: mediaInputClientDef,
    compositor: compositorClientDef,
    blur: blurClientDef,
    levels: levelsClientDef,
    ai_generator: aiGeneratorClientDef,
    character: characterClientDef,
};

export const FallbackNode = AIGeneratorNode;
