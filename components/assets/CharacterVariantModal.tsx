'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Wand2 } from 'lucide-react';
import {
    charactersApi,
    generateCharacterVariantStream,
    type Character,
    type CharacterRefImage,
    type CharacterInput,
} from '@/lib/api/client';
import SheetCandidateGrid from '@/components/assets/character-wizard/SheetCandidateGrid';
import CharacterConfirmStep from '@/components/assets/character-wizard/CharacterConfirmStep';
import type { SheetSlot } from '@/components/assets/character-wizard/types';

interface CharacterVariantModalProps {
    open: boolean;
    source: Character | null;
    onClose: () => void;
    onSave: (input: CharacterInput) => Promise<void>;
    /** Called when the variant is dismissed without Cancel and has a sheet
     *  picked — persists it as a draft. */
    onSaveDraft?: (input: CharacterInput) => Promise<void>;
}

type WizardStep = 'changes' | 'candidates' | 'confirm';

export default function CharacterVariantModal({
    open,
    source,
    onClose,
    onSave,
    onSaveDraft,
}: CharacterVariantModalProps) {
    // Wizard navigation
    const [step, setStep] = useState<WizardStep>('changes');

    // Changes step
    const [changes, setChanges] = useState('');

    // Character metadata
    const [name, setName] = useState('');
    const [weight, setWeight] = useState(70);

    // Candidate grid
    const [slots, setSlots] = useState<SheetSlot[]>([]);
    const [generating, setGenerating] = useState(false);
    const [selectedSheet, setSelectedSheet] = useState<CharacterRefImage | null>(null);
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

    // Confirm step
    const [cover, setCover] = useState<CharacterRefImage | null>(null);
    const [coverLoading, setCoverLoading] = useState(false);
    const [description, setDescription] = useState('');

    // UI state
    const [describing, setDescribing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const dismissingRef = useRef(false);

    // Portal to <body> so the fixed-inset overlay centers on the viewport even
    // when a parent has a CSS transform that would otherwise become the
    // containing block for `fixed`.
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    // Reset all state on open
    useEffect(() => {
        if (!open) return;
        dismissingRef.current = false;
        setStep('changes');
        setChanges('');
        setName(source ? `${source.name} (variant)` : '');
        setWeight(source?.weight ?? 70);
        setSlots([]);
        setGenerating(false);
        setSelectedSheet(null);
        setSelectedIndex(null);
        setCover(null);
        setCoverLoading(false);
        setDescription('');
        setDescribing(false);
        setSaving(false);
        setErrorMsg(null);
    }, [open, source]);

    // --- Generation ---

    const runGeneration = async () => {
        if (!source) return;
        if (changes.trim().length < 3) { setErrorMsg('Describe the changes first (a few words)'); return; }
        setGenerating(true);
        setErrorMsg(null);
        setStep('candidates');
        setSelectedIndex(null);
        setSelectedSheet(null);

        const localSlots: SheetSlot[] = [];
        try {
            await generateCharacterVariantStream(source.id, { changes: changes.trim() }, {
                onStart: (total) => {
                    localSlots.length = 0;
                    for (let i = 0; i < total; i++) localSlots.push(null);
                    setSlots([...localSlots]);
                },
                onSheet: ({ index, url, path }) => {
                    if (index >= 0 && index < localSlots.length) localSlots[index] = { url, path };
                    setSlots([...localSlots]);
                },
                onSheetFailed: (index) => {
                    if (index >= 0 && index < localSlots.length && localSlots[index] === null)
                        localSlots[index] = 'failed';
                    setSlots([...localSlots]);
                },
                onError: (m) => setErrorMsg(m),
            });
        } catch (e) {
            setErrorMsg(e instanceof Error ? e.message : 'Variant generation failed');
        } finally {
            setGenerating(false);
        }
    };

    // --- Sheet selection / cover generation ---

    const handleSelectSheet = async (index: number) => {
        const slot = slots[index];
        if (!slot || slot === 'failed') return;
        setSelectedSheet(slot);
        setSelectedIndex(index);
        setCover(null);
        setDescription((d) => d || changes.trim());
        setStep('confirm');
        setCoverLoading(true);
        try {
            const c = await charactersApi.generateCover(slot.url);
            setCover({ url: c.url, path: c.path });
        } catch {
            // Fall back to using the sheet as the cover
            setCover(slot);
        } finally {
            setCoverLoading(false);
        }
    };

    // --- Auto-describe ---

    const handleAutoDescribe = async () => {
        if (!selectedSheet) { setErrorMsg('No sheet selected'); return; }
        setDescribing(true);
        setErrorMsg(null);
        try {
            const result = await charactersApi.autoDescribe(selectedSheet.url);
            setDescription(result.description);
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Auto-describe failed');
        } finally {
            setDescribing(false);
        }
    };

    // --- Save ---

    const handleSave = async () => {
        if (!name.trim()) { setErrorMsg('Name is required'); return; }
        if (!selectedSheet) { setErrorMsg('Pick a sheet first'); return; }
        setSaving(true);
        setErrorMsg(null);
        try {
            await onSave({
                name: name.trim(),
                description: description.trim() || null,
                sheetUrl: selectedSheet.url,
                sheetPath: selectedSheet.path,
                coverUrl: (cover ?? selectedSheet).url,
                coverPath: (cover ?? selectedSheet).path,
                weight,
            });
            onClose();
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Failed to save variant');
        } finally {
            setSaving(false);
        }
    };

    // --- Dismiss / draft ---

    const handleDismiss = async () => {
        if (dismissingRef.current) return;
        dismissingRef.current = true;
        if (onSaveDraft && selectedSheet) {
            try {
                await onSaveDraft({
                    name: name.trim(),
                    description: description.trim() || null,
                    sheetUrl: selectedSheet.url,
                    sheetPath: selectedSheet.path,
                    coverUrl: (cover ?? selectedSheet).url,
                    coverPath: (cover ?? selectedSheet).path,
                    weight,
                });
            } catch {
                // Best-effort: never block closing on a failed draft save.
            }
        }
        onClose();
    };

    // Escape key handling
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') void handleDismiss(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
        // handleDismiss closes over current field state; re-bind when it changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, onSaveDraft, name, description, selectedSheet, cover, weight]);

    if (!mounted) return null;

    // Widen the dialog per step: widest for the 2×2 candidate grid.
    const dialogMaxW = step === 'changes' ? 'max-w-md' : step === 'candidates' ? 'max-w-5xl' : 'max-w-4xl';

    const sourceThumb =
        source?.cover_url ||
        source?.sheet_url ||
        source?.thumbnail_url ||
        source?.reference_images?.[0]?.url;

    return createPortal(
        <AnimatePresence>
            {open && source && (
                <motion.div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
                    onClick={() => void handleDismiss()}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                >
                    <motion.div
                        className={`w-full ${dialogMaxW} rounded-2xl bg-surface-primary border border-stroke-subtle shadow-2xl p-5 space-y-4`}
                        onClick={(e) => e.stopPropagation()}
                        initial={{ opacity: 0, scale: 0.96, y: 12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 12 }}
                        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-bold text-content-primary">Create variant</h2>
                            <button
                                onClick={() => void handleDismiss()}
                                className="p-1.5 rounded-lg hover:bg-interactive-hover text-content-tertiary"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Step: changes */}
                        {step === 'changes' && (
                            <div className="space-y-4">
                                {/* Source character chip */}
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-lg overflow-hidden border border-stroke-subtle bg-white/5 shrink-0">
                                        {sourceThumb && (
                                            <img src={sourceThumb} alt={source.name} className="w-full h-full object-cover" />
                                        )}
                                    </div>
                                    <p className="text-xs text-content-tertiary">
                                        Restyle{' '}
                                        <span className="text-content-secondary font-medium">{source.name}</span>
                                        {' '}— same person, your changes applied.
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-content-secondary mb-1">
                                        Changes *
                                    </label>
                                    <textarea
                                        value={changes}
                                        onChange={(e) => setChanges(e.target.value)}
                                        rows={4}
                                        placeholder="cyberpunk streetwear, neon palette, glossy jacket; change hair to white…"
                                        className="w-full px-3 py-2 rounded-lg bg-surface-tertiary border border-stroke-subtle text-content-primary resize-y min-h-[5rem] focus:outline-none focus:ring-2 focus:ring-accent-primary"
                                    />
                                </div>

                                {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}

                                <button
                                    type="button"
                                    onClick={() => void runGeneration()}
                                    disabled={changes.trim().length < 3}
                                    className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-accent-primary text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                                >
                                    <Wand2 className="w-4 h-4" />
                                    Generate variants
                                </button>
                            </div>
                        )}

                        {/* Step: candidates */}
                        {step === 'candidates' && (
                            <div className="space-y-4">
                                <SheetCandidateGrid
                                    slots={slots}
                                    selectedIndex={selectedIndex}
                                    onSelect={handleSelectSheet}
                                    generating={generating}
                                />

                                {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}

                                <div className="flex items-center justify-between pt-1">
                                    <button
                                        type="button"
                                        onClick={() => setStep('changes')}
                                        className="px-3 py-2 rounded-lg text-sm text-content-secondary hover:bg-interactive-hover"
                                    >
                                        ← Back
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void runGeneration()}
                                        disabled={generating}
                                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-stroke-subtle text-content-secondary hover:bg-interactive-hover disabled:opacity-50"
                                    >
                                        {generating ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <Wand2 className="w-4 h-4" />
                                        )}
                                        Regenerate
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Step: confirm */}
                        {step === 'confirm' && selectedSheet && (
                            <div className="space-y-4">
                                <CharacterConfirmStep
                                    sheet={selectedSheet}
                                    cover={cover}
                                    coverLoading={coverLoading}
                                    name={name}
                                    onName={setName}
                                    description={description}
                                    onDescription={setDescription}
                                    weight={weight}
                                    onWeight={setWeight}
                                    onAutoDescribe={handleAutoDescribe}
                                    describing={describing}
                                    onBack={() => setStep('candidates')}
                                />

                                {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}

                                <div className="flex justify-end gap-2 pt-1">
                                    <button
                                        onClick={onClose}
                                        className="px-4 py-2 rounded-lg text-content-secondary hover:bg-interactive-hover"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => void handleSave()}
                                        disabled={saving}
                                        className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-hover disabled:opacity-50 flex items-center gap-2"
                                    >
                                        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                                        Save variant
                                    </button>
                                </div>
                            </div>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body,
    );
}
