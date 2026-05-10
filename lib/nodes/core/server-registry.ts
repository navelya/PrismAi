import { NodeServerDef } from './types';
import { mediaInputSharedDef } from '../plugins/media_input/definition';
import { mediaInputExecutor } from '../plugins/media_input/executor.server';
import { promptSharedDef } from '../plugins/prompt/definition';
import { promptExecutor } from '../plugins/prompt/executor.server';
import { compositorSharedDef } from '../plugins/compositor/definition';
import { compositorExecutor } from '../plugins/compositor/executor.server';
import { blurSharedDef } from '../plugins/blur/definition';
import { blurExecutor } from '../plugins/blur/executor.server';
import { levelsSharedDef } from '../plugins/levels/definition';
import { levelsExecutor } from '../plugins/levels/executor.server';
import { aiGeneratorSharedDef } from '../plugins/ai_generator/definition';
import { aiGeneratorExecutor } from '../plugins/ai_generator/executor.server';

// The server-side registry mapping definition types
// Only import this in Node.js/Backend execution environments
export const serverRegistry: Record<string, NodeServerDef> = {
    prompt: { ...promptSharedDef, executor: promptExecutor },
    media_input: { ...mediaInputSharedDef, executor: mediaInputExecutor },
    compositor: { ...compositorSharedDef, executor: compositorExecutor },
    blur: { ...blurSharedDef, executor: blurExecutor },
    levels: { ...levelsSharedDef, executor: levelsExecutor },
    ai_generator: { ...aiGeneratorSharedDef, executor: aiGeneratorExecutor },
};

export function isEphemeralNode(type: string): boolean {
    const def = serverRegistry[type];
    return !!def && def.family !== 'generative';
}
