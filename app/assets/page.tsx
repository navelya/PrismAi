'use client';

import React, { useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { useCharacters } from '@/lib/hooks/use-characters';
import type { Character, CharacterInput } from '@/lib/api/client';
import CharacterGrid from '@/components/assets/CharacterGrid';
import CharacterModal from '@/components/assets/CharacterModal';
import AssetsGallery from '@/components/assets/AssetsGallery';

const TABS = [
    { id: 'assets', label: 'Assets' },
    { id: 'characters', label: 'Characters' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function AssetsPage() {
    const { characters, loading, createCharacter, updateCharacter, deleteCharacter } = useCharacters();
    const [activeTab, setActiveTab] = useState<TabId>('assets');
    const [search, setSearch] = useState('');
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<Character | null>(null);

    const filtered = characters.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

    const openCreate = () => { setEditing(null); setModalOpen(true); };
    const openEdit = (c: Character) => { setEditing(c); setModalOpen(true); };

    const handleSave = async (input: CharacterInput, id?: string) => {
        if (id) await updateCharacter(id, input);
        else await createCharacter(input);
    };

    return (
        <div className="w-full h-full overflow-y-auto bg-surface-secondary">
            <div className="max-w-7xl mx-auto p-8 space-y-6">
                <div>
                    <h1 className="text-3xl font-bold text-content-primary">Assets</h1>
                    <p className="text-content-secondary mt-1">Your generated results and reusable characters</p>
                </div>

                <div className="flex gap-1 border-b border-stroke-subtle">
                    {TABS.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`relative px-4 py-2 text-sm font-medium transition-colors ${
                                activeTab === tab.id
                                    ? 'text-accent-primary'
                                    : 'text-content-secondary hover:text-content-primary'
                            }`}
                        >
                            {tab.label}
                            {activeTab === tab.id && <span className="absolute left-0 -bottom-px h-0.5 w-full bg-accent-primary" />}
                        </button>
                    ))}
                </div>

                {activeTab === 'assets' && <AssetsGallery />}

                {activeTab === 'characters' && (
                    <>
                        <div className="flex items-center gap-3">
                            <div className="relative group flex-1">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-content-tertiary group-focus-within:text-accent-primary transition-colors" />
                                <input
                                    type="text"
                                    placeholder="Search characters..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="w-full pl-12 pr-4 py-3 bg-surface-tertiary border border-stroke-subtle rounded-xl text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                                />
                            </div>
                            <button
                                onClick={openCreate}
                                className="flex items-center gap-2 px-4 py-2.5 bg-accent-primary/10 border border-accent-primary/20 text-accent-primary rounded-lg font-medium hover:bg-accent-primary/15 transition-colors whitespace-nowrap"
                            >
                                <Plus className="w-4 h-4" />
                                <span>New Character</span>
                            </button>
                        </div>
                        <CharacterGrid
                            characters={filtered}
                            loading={loading}
                            onCreate={openCreate}
                            onEdit={openEdit}
                            onDelete={deleteCharacter}
                        />
                    </>
                )}

                <CharacterModal open={modalOpen} initial={editing} onClose={() => setModalOpen(false)} onSave={handleSave} />
            </div>
        </div>
    );
}
