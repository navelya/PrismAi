'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, UserCircle, Plus, X, Sparkles, Wand2 } from 'lucide-react';
import { PillTabs } from '@/components/ui/PillTabs';
import { Skeleton } from '@/components/ui/Skeleton';
import { useCharacters } from '@/lib/hooks/use-characters';
import { useAppStore } from '@/lib/store/app-store';
import CharacterModal from '@/components/assets/CharacterModal';
import CharacterVariantModal from '@/components/assets/CharacterVariantModal';
import type { Character, CharacterInput } from '@/lib/api/client';

/** Frozen snapshot seeded into a character node's config — see
 *  lib/nodes/plugins/character/definition.ts → CharacterConfig. */
function characterNodeConfig(character: Character) {
    return {
        characterId: character.id,
        name: character.name,
        referenceImages: (character.reference_images ?? []).map((r) => r.url),
        description: character.description ?? undefined,
        weight: character.weight,
    };
}

type CharacterScope = 'mine' | 'all';

interface CharactersPanelProps {
    onClose: () => void;
}

export function CharactersPanel({ onClose }: CharactersPanelProps) {
    const { characters, loading, createCharacter } = useCharacters();
    const [scope, setScope] = useState<CharacterScope>('mine');
    const [modalOpen, setModalOpen] = useState(false);
    const [variantSource, setVariantSource] = useState<Character | null>(null);

    const handleSave = async (input: CharacterInput) => {
        await createCharacter(input);
    };

    return (
        <div className="relative w-full h-full bg-surface-elevated/80 backdrop-blur-md border border-stroke-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Compact header */}
            <div className="flex items-center justify-between gap-2 px-2 py-2 border-b border-stroke-subtle/60">
                <PillTabs<CharacterScope>
                    items={[
                        { value: 'mine', label: 'My Characters', icon: UserCircle },
                        { value: 'all', label: 'All Characters', icon: Users, disabled: true, title: 'Prisfol characters — coming soon' },
                    ]}
                    value={scope}
                    onChange={setScope}
                />

                <div className="flex items-center gap-0.5">
                    <button
                        onClick={() => setModalOpen(true)}
                        className="p-1 hover:bg-white/10 rounded-md transition-colors group"
                        title="New character"
                    >
                        <Plus className="w-3.5 h-3.5 text-content-tertiary group-hover:text-content-primary transition-colors" />
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-white/10 rounded-md transition-colors group"
                        title="Close"
                    >
                        <X className="w-3.5 h-3.5 text-content-tertiary group-hover:text-content-primary" />
                    </button>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
                {loading ? (
                    <div className="p-3">
                        <div className="grid grid-cols-2 gap-2">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <Skeleton key={i} className="aspect-square rounded-xl border border-stroke-subtle" />
                            ))}
                        </div>
                    </div>
                ) : characters.length === 0 ? (
                    <EmptyState onCreate={() => setModalOpen(true)} />
                ) : (
                    <div className="p-3">
                        <div className="grid grid-cols-2 gap-2">
                            <AnimatePresence initial={false}>
                                {characters.map((c, i) => (
                                    <CharacterCard key={c.id} character={c} index={i} onVariant={setVariantSource} />
                                ))}
                            </AnimatePresence>
                        </div>
                    </div>
                )}
            </div>

            <CharacterModal open={modalOpen} initial={null} onClose={() => setModalOpen(false)} onSave={handleSave} />
            <CharacterVariantModal
                open={!!variantSource}
                source={variantSource}
                onClose={() => setVariantSource(null)}
                onSave={async (input) => { await createCharacter(input); }}
            />
        </div>
    );
}

function CharacterCard({ character, index, onVariant }: { character: Character; index: number; onVariant: (c: Character) => void }) {
    const thumb = character.thumbnail_url || character.reference_images?.[0]?.url;
    const extra = Math.max(0, (character.reference_images?.length ?? 0) - 1);

    const handleDragStart = (e: React.DragEvent) => {
        const payload = JSON.stringify({
            type: 'character',
            initialConfig: characterNodeConfig(character),
        });
        e.dataTransfer.setData('application/reactflow', payload);
        e.dataTransfer.effectAllowed = 'copy';
    };

    // Click drops the node at the viewport center via the same path as drag,
    // so it gets the standard "new node" pop animation.
    const handleClick = () => {
        useAppStore.getState().requestAddNode({ type: 'character', initialConfig: characterNodeConfig(character) });
    };

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, delay: Math.min(index, 12) * 0.03 }}
            draggable
            onDragStart={(e) => handleDragStart(e as unknown as React.DragEvent)}
            onClick={handleClick}
            className="relative aspect-square rounded-xl overflow-hidden border border-stroke-subtle bg-surface-primary cursor-pointer group hover:border-accent-primary/50 transition-all duration-200 shadow-sm hover:shadow-lg"
            title="Click or drag to add to canvas"
        >
            <button
                onClick={(e) => { e.stopPropagation(); onVariant(character); }}
                title="Create variant"
                className="absolute top-1.5 left-1.5 z-10 p-1.5 rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent-primary"
            >
                <Wand2 className="w-3.5 h-3.5" />
            </button>
            {thumb ? (
                <img src={thumb} alt={character.name} className="w-full h-full object-cover" />
            ) : (
                <div className="w-full h-full flex items-center justify-center text-content-tertiary bg-white/5">
                    <UserCircle className="w-10 h-10" />
                </div>
            )}

            {extra > 0 && (
                <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-black/60 text-white text-[10px] font-medium pointer-events-none">
                    +{extra}
                </span>
            )}

            {/* Name + hover hint */}
            <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
                <p className="text-[11px] font-semibold text-white truncate">{character.name}</p>
            </div>
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-200 flex items-center justify-center">
                <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/60 rounded-lg px-2 py-1">
                    <span className="text-[9px] font-bold text-white uppercase tracking-wider">Add to canvas</span>
                </div>
            </div>
        </motion.div>
    );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center h-full gap-5 p-8 text-center"
        >
            <div className="relative w-16 h-16">
                <div className="absolute inset-0 rounded-2xl bg-accent-primary/5 border border-accent-primary/10" />
                <div className="absolute inset-0 flex items-center justify-center">
                    <UserCircle className="w-7 h-7 text-content-tertiary/50" />
                </div>
                <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-surface-elevated border border-stroke-subtle flex items-center justify-center">
                    <Sparkles className="w-2.5 h-2.5 text-accent-primary/60" />
                </div>
            </div>

            <div className="space-y-2">
                <p className="text-sm font-semibold text-content-secondary">No characters yet</p>
                <p className="text-xs text-content-tertiary leading-relaxed max-w-[180px]">
                    Create a character to reuse them across generations — then drag it straight onto the canvas.
                </p>
            </div>

            <button
                onClick={onCreate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent-primary/10 border border-accent-primary/20 text-accent-primary rounded-lg text-xs font-medium hover:bg-accent-primary/15 transition-colors"
            >
                <Plus className="w-3.5 h-3.5" /> New Character
            </button>
        </motion.div>
    );
}
