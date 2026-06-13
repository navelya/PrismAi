import { NodeClientDef } from './types';
import { mediaInputClientDef } from '../plugins/media_input';
import { compositorClientDef } from '../plugins/compositor';
import { promptClientDef } from '../plugins/prompt';
import { blurClientDef } from '../plugins/blur';
import { extractFrameClientDef } from '../plugins/extract_frame';
import { levelsClientDef } from '../plugins/levels';
import { aiGeneratorClientDef, AIGeneratorNode } from '../plugins/ai_generator';
import { characterClientDef } from '../plugins/character';
import { collectClientDef } from '../plugins/collect';
import { compareClientDef } from '../plugins/compare';

export const clientRegistry: Record<string, NodeClientDef> = {
    prompt: promptClientDef,
    media_input: mediaInputClientDef,
    compositor: compositorClientDef,
    blur: blurClientDef,
    extract_frame: extractFrameClientDef,
    levels: levelsClientDef,
    ai_generator: aiGeneratorClientDef,
    character: characterClientDef,
    collect: collectClientDef,
};

export const FallbackNode = AIGeneratorNode;
