import { NodeSharedDef } from '../../core/types';

/**
 * Character Node — a snapshot of a reusable character.
 * Config is a frozen copy (not a live DB reference) so saved workflows render
 * even after the source character is edited or deleted. `characterId` is kept
 * for a future opt-in "character changed — refresh node?" affordance.
 */
export interface CharacterConfig {
    characterId: string;
    name: string;
    referenceImages: string[]; // snapshot URLs, 1-5; index 0 = primary
    description?: string;
    weight?: number;           // 0-100
}

export const characterSharedDef: NodeSharedDef<CharacterConfig> = {
    type: 'character',
    family: 'input',
    category: 'input',
    meta: {
        label: 'Character',
        description: 'A reusable character (reference images + identity) fed into reference-aware generators',
        color: '#a855f7',
        icon: 'UserCircle',
        // Reference images are persisted on the `characters` record, not as
        // workflow outputs. Flagging the node ephemeral makes the engine clean
        // up its node_results rows after a run (orchestrator.cleanupEphemeralResults)
        // and hides them from the asset views (AssetsPanel live filter) — so a
        // character's references never pile up as duplicate "assets". The node's
        // own files live in the chat-assets bucket and are untouched by cleanup
        // (which only lists the workflow-ephemeral-tmp bucket).
        ephemeral: true,
    },
    handles: {
        inputs: [],
        outputs: [{ id: 'character_out', label: 'Character', dataType: 'image_array' }],
    },
    defaultConfig: {
        characterId: '',
        name: '',
        referenceImages: [],
        description: '',
        weight: 70,
    },
    aiSchema: {
        type: 'object',
        properties: {
            characterId: { type: 'string', description: 'ID of an existing character the user referenced. The server fills in name/images/description/weight from this id — do not invent these.' },
        },
        required: ['characterId'],
    },
};
