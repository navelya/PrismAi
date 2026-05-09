import { NodeServerDef } from './types';
import { mediaInputSharedDef } from '../plugins/media_input/definition';
import { mediaInputExecutor } from '../plugins/media_input/executor.server';
import { promptSharedDef } from '../plugins/prompt/definition';
import { promptExecutor } from '../plugins/prompt/executor.server';
import { compositorSharedDef } from '../plugins/compositor/definition';
import { compositorExecutor } from '../plugins/compositor/executor.server';
import { blurSharedDef } from '../plugins/blur/definition';
import { blurExecutor } from '../plugins/blur/executor.server';
import { aiGeneratorExecutor } from './ai-generator-executor';

// The server-side registry mapping definition types
// Only import this in Node.js/Backend execution environments
export const serverRegistry: Record<string, NodeServerDef> = {
    prompt: { ...promptSharedDef, executor: promptExecutor },
    media_input: { ...mediaInputSharedDef, executor: mediaInputExecutor },
    compositor: { ...compositorSharedDef, executor: compositorExecutor },
    blur: { ...blurSharedDef, executor: blurExecutor },
    ai_generator: {
        type: 'ai_generator',
        family: 'generative',
        category: 'generative',
        executor: aiGeneratorExecutor,
    } as any,
};
