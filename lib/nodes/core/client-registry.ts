import { NodeClientDef } from './types';
import { aiGenerateImageClientDef } from '../plugins/ai_generate_image/component';
import { mediaInputClientDef } from '../plugins/media_input/component';
import { compositorClientDef } from '../plugins/compositor/component';
import { promptClientDef } from '../plugins/prompt/component';
import LegacyNode from '@/components/canvas/LegacyNode';

// The client-side registry mapping definition types
// Only import this in Browser/React components
export const clientRegistry: Record<string, NodeClientDef> = {
    prompt: promptClientDef,
    ai_generate_image: aiGenerateImageClientDef,
    media_input: mediaInputClientDef,
    compositor: compositorClientDef,
};

export const FallbackNode = LegacyNode;

