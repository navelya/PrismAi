import { NodeSharedDef } from './types';
import { promptSharedDef } from '../plugins/prompt/definition';
import { mediaInputSharedDef } from '../plugins/media_input/definition';
import { compositorSharedDef } from '../plugins/compositor/definition';
import { blurSharedDef } from '../plugins/blur/definition';
import { extractFrameSharedDef } from '../plugins/extract_frame/definition';
import { levelsSharedDef } from '../plugins/levels/definition';
import { aiGeneratorSharedDef } from '../plugins/ai_generator/definition';
import { characterSharedDef } from '../plugins/character/definition';

export const sharedRegistry: Record<string, NodeSharedDef<any>> = {
    prompt: promptSharedDef,
    media_input: mediaInputSharedDef,
    compositor: compositorSharedDef,
    blur: blurSharedDef,
    extract_frame: extractFrameSharedDef,
    levels: levelsSharedDef,
    ai_generator: aiGeneratorSharedDef,
    character: characterSharedDef,
    group_container: {
        type: 'group_container',
        family: 'organization',
        category: 'organization',
        meta: {
            label: 'Group',
            color: 'rgb(var(--stroke-subtle))',
            icon: 'Group',
        },
        handles: {
            inputs: [],
            outputs: [],
        },
        defaultConfig: {
            width: 400,
            height: 300,
            icon: 'Folder',
            color: 'neutral',
        },
        aiSchema: {
            type: 'object',
            properties: {
                label:  { type: 'string', maxLength: 40 },
                icon:   { type: 'string', description: 'Lucide PascalCase name (Folder, Film, Camera, Music, Wand2, ...). Falls back to Folder if unknown.' },
                color:  { type: 'string', enum: ['neutral','indigo','emerald','rose','amber','sky'], default: 'neutral' },
                width:  { type: 'number', default: 400 },
                height: { type: 'number', default: 300 },
            },
        },
        nonExecutable: true,
    } as any,
    note: {
        type: 'note',
        family: 'organization',
        category: 'organization',
        meta: {
            label: 'Note',
            color: 'rgb(var(--stroke-subtle))',
            icon: 'StickyNote',
        },
        handles: {
            inputs: [],
            outputs: [],
        },
        defaultConfig: {
            text: '',
            author: null,
        },
        aiSchema: {
            type: 'object',
            properties: {
                text: { type: 'string' },
            },
        },
        nonExecutable: true,
    } as any,
};
