'use client';

import React from 'react';
import { Loader2, UserCircle, Plus } from 'lucide-react';
import CharacterCard from './CharacterCard';
import type { Character } from '@/lib/api/client';

interface CharacterGridProps {
    characters: Character[];
    loading: boolean;
    onCreate: () => void;
    onEdit: (c: Character) => void;
    onDelete: (id: string) => void;
}

export default function CharacterGrid({ characters, loading, onCreate, onEdit, onDelete }: CharacterGridProps) {
    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
            </div>
        );
    }

    if (characters.length === 0) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-surface-tertiary flex items-center justify-center mx-auto">
                        <UserCircle className="w-8 h-8 text-content-tertiary" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-content-primary">No characters yet</h3>
                        <p className="text-content-secondary mt-1">Create a character to reuse them across generations</p>
                    </div>
                    <button onClick={onCreate} className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-premium text-white rounded-xl">
                        <Plus className="w-4 h-4" /> New Character
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {characters.map((c) => (
                <CharacterCard key={c.id} character={c} onEdit={onEdit} onDelete={onDelete} />
            ))}
        </div>
    );
}
