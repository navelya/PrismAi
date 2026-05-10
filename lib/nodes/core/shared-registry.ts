import { NodeSharedDef } from './types';
import { promptSharedDef } from '../plugins/prompt/definition';
import { mediaInputSharedDef } from '../plugins/media_input/definition';
import { compositorSharedDef } from '../plugins/compositor/definition';
import { blurSharedDef } from '../plugins/blur/definition';
import { levelsSharedDef } from '../plugins/levels/definition';
import { aiGeneratorSharedDef } from '../plugins/ai_generator/definition';

export const sharedRegistry: Record<string, NodeSharedDef<any>> = {
    prompt: promptSharedDef,
    media_input: mediaInputSharedDef,
    compositor: compositorSharedDef,
    blur: blurSharedDef,
    levels: levelsSharedDef,
    ai_generator: aiGeneratorSharedDef,
    group_container: {
        type: 'group_container',
        family: 'organization',
        category: 'organization',
        meta: {
            label: 'Group',
            color: 'rgb(var(--stroke-subtle))',
            icon: 'Group',
        },
        // Groups have no handles — they are visual containers, not executable nodes.
        handles: {
            inputs: [],
            outputs: [],
        },
        defaultConfig: {
            width: 400,
            height: 300,
        },
        nonExecutable: true,
    } as any,
};
