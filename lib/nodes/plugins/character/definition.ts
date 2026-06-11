import { NodeSharedDef } from '../../core/types';

/**
 * Character Node — a frozen snapshot of a reusable character.
 * Config is a frozen copy (not a live DB reference) so saved workflows render
 * even after the source character is edited or deleted. `characterId` is kept
 * for a future opt-in "character changed — refresh node?" affordance.
 *
 * New snapshots carry a `sheetUrl` (the single character-sheet image that the
 * node outputs) and an optional `coverUrl` (display-only portrait shown in the
 * canvas node). Legacy saved-workflow snapshots may only have `referenceImages`;
 * the executor falls back to that array when `sheetUrl` is absent.
 */
export interface CharacterConfig {
    characterId: string;
    name: string;
    sheetUrl?: string;          // present on new snapshots — the character sheet
    coverUrl?: string;          // display-only cover portrait
    referenceImages?: string[]; // legacy snapshots only
    description?: string;
    weight?: number;            // 0-100
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
    },
    handles: {
        inputs: [],
        outputs: [{ id: 'character_out', label: 'Character', dataType: 'image_array' }],
    },
    defaultConfig: {
        characterId: '',
        name: '',
        sheetUrl: undefined,
        coverUrl: undefined,
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
