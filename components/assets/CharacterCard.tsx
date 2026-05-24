'use client';

import React from 'react';
import { Pencil, Trash2, UserCircle, Wand2 } from 'lucide-react';
import type { Character } from '@/lib/api/client';

interface CharacterCardProps {
    character: Character;
    onEdit: (c: Character) => void;
    onDelete: (id: string) => void;
    onVariant: (c: Character) => void;
}

export default function CharacterCard({ character, onEdit, onDelete, onVariant }: CharacterCardProps) {
    const thumb = character.thumbnail_url || character.reference_images?.[0]?.url;

    return (
        <div className="group relative rounded-2xl overflow-hidden border border-stroke-subtle bg-surface-tertiary hover:border-accent-primary/40 transition-all">
            <div className="relative aspect-square w-full bg-white/5">
                {character.is_draft && (
                    <span className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-md bg-amber-500/90 text-white text-[10px] font-semibold uppercase tracking-wide">
                        Draft
                    </span>
                )}
                {thumb ? (
                    <img src={thumb} alt={character.name || 'Untitled draft'} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-content-tertiary">
                        <UserCircle className="w-12 h-12" />
                    </div>
                )}
            </div>
            <div className="p-3">
                <p className="font-semibold text-content-primary truncate">{character.name || 'Untitled draft'}</p>
                {character.description && (
                    <p className="text-xs text-content-tertiary line-clamp-2 mt-0.5">{character.description}</p>
                )}
            </div>
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => onVariant(character)} title="Create variant" className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-accent-primary">
                    <Wand2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onEdit(character)} title="Edit" className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80">
                    <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onDelete(character.id)} title="Delete" className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
}
