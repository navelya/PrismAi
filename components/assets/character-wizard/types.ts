import type { CharacterRefImage } from '@/lib/api/client';

/** A candidate sheet slot: an image once it lands, null while loading, 'failed' on error. */
export type SheetSlot = CharacterRefImage | null | 'failed';
