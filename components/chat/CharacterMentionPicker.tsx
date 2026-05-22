'use client';

import React from 'react';
import { UserCircle, Plus } from 'lucide-react';
import type { Character } from '@/lib/api/client';

interface CharacterMentionPickerProps {
    characters: Character[];
    query: string;
    activeIndex: number;
    onSelect: (c: Character) => void;
    onCreateNew: () => void;
}

const TOP_N = 5;

export function filterCharacters(characters: Character[], query: string): Character[] {
    const q = query.trim().toLowerCase();
    if (!q) return characters.slice(0, TOP_N); // already recency-ordered from the API
    return characters.filter((c) => c.name.toLowerCase().includes(q));
}

export default function CharacterMentionPicker({
    characters,
    query,
    activeIndex,
    onSelect,
    onCreateNew,
}: CharacterMentionPickerProps) {
    const results = filterCharacters(characters, query);

    return (
        <div className="absolute bottom-full left-0 mb-2 w-72 max-h-72 overflow-y-auto rounded-xl border border-stroke-subtle bg-surface-primary shadow-2xl z-50 p-1">
            {results.length === 0 ? (
                <div className="px-3 py-3 text-sm text-content-tertiary">
                    No characters match "{query}"
                </div>
            ) : (
                results.map((c, i) => (
                    <button
                        key={c.id}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); onSelect(c); }}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${
                            i === activeIndex ? 'bg-accent-primary/10' : 'hover:bg-interactive-hover'
                        }`}
                    >
                        <span className="w-8 h-8 rounded-md overflow-hidden bg-surface-tertiary flex-shrink-0 flex items-center justify-center">
                            {c.thumbnail_url || c.reference_images?.[0]?.url ? (
                                <img src={c.thumbnail_url || c.reference_images[0].url} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <UserCircle className="w-5 h-5 text-content-tertiary" />
                            )}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-content-primary truncate">{c.name}</span>
                            {c.description && (
                                <span className="block text-xs text-content-tertiary truncate">{c.description}</span>
                            )}
                        </span>
                    </button>
                ))
            )}
            <div className="h-px bg-stroke-subtle my-1" />
            <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onCreateNew(); }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-sm text-accent-primary hover:bg-interactive-hover"
            >
                <Plus className="w-4 h-4" /> Create new character
            </button>
        </div>
    );
}
