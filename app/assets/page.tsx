'use client';

import React, { useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { useCharacters } from '@/lib/hooks/use-characters';
import type { Character, CharacterInput } from '@/lib/api/client';
import CharacterGrid from '@/components/assets/CharacterGrid';
import CharacterModal from '@/components/assets/CharacterModal';

const TABS = [
    { id: 'characters', label: 'Characters', enabled: true },
    { id: 'styles', label: 'Styles', enabled: false },
    { id: 'props', label: 'Props', enabled: false },
] as const;

export default function AssetsPage() {
    const { characters, loading, createCharacter, updateCharacter, deleteCharacter } = useCharacters();
    const [activeTab, setActiveTab] = useState<'characters' | 'styles' | 'props'>('characters');
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
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-content-primary">Assets</h1>
                        <p className="text-content-secondary mt-1">Reusable characters for your generations</p>
                    </div>
                    <button onClick={openCreate} className="flex items-center gap-2 px-6 py-3 bg-gradient-premium text-white rounded-xl hover:shadow-lg hover:shadow-accent-primary/25 transition-all">
                        <Plus className="w-5 h-5" />
                        <span>New Character</span>
                    </button>
                </div>

                <div className="flex gap-1 border-b border-stroke-subtle">
                    {TABS.map((tab) => (
                        <button
                            key={tab.id}
                            disabled={!tab.enabled}
                            onClick={() => tab.enabled && setActiveTab(tab.id)}
                            className={`relative px-4 py-2 text-sm font-medium transition-colors ${
                                activeTab === tab.id
                                    ? 'text-accent-primary'
                                    : tab.enabled
                                        ? 'text-content-secondary hover:text-content-primary'
                                        : 'text-content-tertiary cursor-not-allowed'
                            }`}
                        >
                            {tab.label}
                            {!tab.enabled && <span className="ml-1 text-[10px] uppercase tracking-wide text-content-tertiary">soon</span>}
                            {activeTab === tab.id && <span className="absolute left-0 -bottom-px h-0.5 w-full bg-accent-primary" />}
                        </button>
                    ))}
                </div>

                {activeTab === 'characters' && (
                    <>
                        <div className="relative group">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-content-tertiary group-focus-within:text-accent-primary transition-colors" />
                            <input
                                type="text"
                                placeholder="Search characters..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full pl-12 pr-4 py-3 bg-surface-tertiary border border-stroke-subtle rounded-xl text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                            />
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
