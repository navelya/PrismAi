import { NodeServerDef } from './types';
import { aiGenerateImageSharedDef } from '../plugins/ai_generate_image';
import { aiGenerateImageExecutor } from '../plugins/ai_generate_image/executor';
import { mediaInputSharedDef } from '../plugins/media_input';
import { mediaInputExecutor } from '../plugins/media_input/executor';
import { promptSharedDef } from '../plugins/prompt';
import { promptExecutor } from '../plugins/prompt/executor';
import { compositorSharedDef } from '../plugins/compositor';
import { compositorExecutor } from '../plugins/compositor/executor';

// The server-side registry mapping definition types
// Only import this in Node.js/Backend execution environments
export const serverRegistry: Record<string, NodeServerDef> = {
    prompt: { ...promptSharedDef, executor: promptExecutor },
    ai_generate_image: { ...aiGenerateImageSharedDef, executor: aiGenerateImageExecutor },
    media_input: { ...mediaInputSharedDef, executor: mediaInputExecutor },
    compositor: { ...compositorSharedDef, executor: compositorExecutor },
};
