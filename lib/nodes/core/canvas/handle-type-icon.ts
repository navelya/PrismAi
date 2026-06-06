import { Image, Video, Music, Box, Type, Braces, Asterisk, type LucideIcon } from 'lucide-react';

/**
 * Maps a handle's data type to a monochrome lucide icon. Handles are typed
 * ports, so the icon — not a color — is what tells the user what flows through
 * the wire. Kept in its own module so the canvas and any future handle UI
 * (menus, legends) resolve types to icons the same way.
 */
const TYPE_ICONS: Record<string, LucideIcon> = {
    image: Image,
    video: Video,
    audio: Music,
    '3d': Box,
    text: Type,
    json: Braces,
    any: Asterisk,
};

/** Strip an `_array` suffix so `image_array` resolves like `image`, etc. */
function normalizeBase(type: string): string {
    return type.endsWith('_array') ? type.slice(0, -'_array'.length) : type;
}

/**
 * Resolve the icon for a handle's data type.
 *
 * - A single type maps directly (unknown types fall back to Asterisk).
 * - An array with one distinct base type maps to that type's icon.
 * - A union of 2+ distinct types (e.g. blur's `['image','video']`,
 *   compositor's `['image','video','text','audio']`) maps to Asterisk —
 *   the "accepts several" signal, same as the explicit `any` type.
 */
export function iconForHandleType(type: string | string[] | undefined): LucideIcon {
    if (Array.isArray(type)) {
        const distinct = Array.from(new Set(type.map(normalizeBase)));
        if (distinct.length === 1) return TYPE_ICONS[distinct[0]] ?? Asterisk;
        return Asterisk;
    }
    if (!type) return Asterisk;
    return TYPE_ICONS[normalizeBase(type)] ?? Asterisk;
}
