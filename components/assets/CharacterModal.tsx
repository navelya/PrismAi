'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Upload, Sparkles, Loader2, Wand2 } from 'lucide-react';
import {
    charactersApi,
    generateCharacterStream,
    type Character,
    type CharacterRefImage,
    type CharacterInput,
} from '@/lib/api/client';
import { downscaleImageToBase64 } from '@/lib/utils/image-processing';
import SheetCandidateGrid from '@/components/assets/character-wizard/SheetCandidateGrid';
import CharacterConfirmStep from '@/components/assets/character-wizard/CharacterConfirmStep';
import type { SheetSlot } from '@/components/assets/character-wizard/types';

interface CharacterModalProps {
    open: boolean;
    initial?: Character | null;
    /** Reference images to pre-seed a NEW character with (create mode only). */
    seedImages?: CharacterRefImage[];
    onClose: () => void;
    onSave: (input: CharacterInput, id?: string) => Promise<void>;
    /** Called when a NEW character is dismissed without Cancel (X/backdrop/Escape)
     *  and has a sheet picked — persists it as a draft. */
    onSaveDraft?: (input: CharacterInput) => Promise<void>;
}

type WizardStep = 'method' | 'candidates' | 'confirm';
type MethodTab = 'describe' | 'upload';

export default function CharacterModal({
    open,
    initial,
    seedImages,
    onClose,
    onSave,
    onSaveDraft,
}: CharacterModalProps) {
    // Wizard navigation
    const [step, setStep] = useState<WizardStep>('method');
    const [method, setMethod] = useState<MethodTab>('describe');

    // Method step fields
    const [description, setDescription] = useState('');
    const [changes, setChanges] = useState('');
    const [uploadedBase, setUploadedBase] = useState<{ mimeType: string; data: string } | null>(null);
    const [uploadPreview, setUploadPreview] = useState<string | null>(null);

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

    // UI state
    const [describing, setDescribing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Remember last generation params for "Regenerate"
    const lastGenParams = useRef<{ description?: string; baseImage?: { mimeType: string; data: string }; changes?: string } | null>(null);

    // File input for upload method
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const dismissingRef = useRef(false);

    // Portal to <body> so the fixed-inset overlay centers on the viewport even
    // when a parent (e.g. the framer-motion slide-in side panel) has a CSS
    // transform that would otherwise become the containing block for `fixed`.
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    // Seed state on open
    useEffect(() => {
        if (!open) return;
        dismissingRef.current = false;
        setErrorMsg(null);
        setGenerating(false);
        setSaving(false);
        setDescribing(false);
        setCoverLoading(false);

        if (initial) {
            // Edit mode: jump straight to confirm with existing data
            setName(initial.name);
            setDescription(initial.description ?? '');
            setWeight(initial.weight ?? 70);
            setChanges('');
            setUploadedBase(null);
            setUploadPreview(null);

            // Resolve the sheet — prefer sheet_url, fall back to first reference image
            const sheetRef: CharacterRefImage | null = initial.sheet_url
                ? { url: initial.sheet_url, path: initial.sheet_path ?? '' }
                : (initial.reference_images?.[0] ?? null);
            setSelectedSheet(sheetRef);
            setSelectedIndex(null);
            setSlots(sheetRef ? [sheetRef] : []);

            const coverRef: CharacterRefImage | null = initial.cover_url
                ? { url: initial.cover_url, path: initial.cover_path ?? '' }
                : null;
            setCover(coverRef);

            setStep('confirm');
        } else {
            // New character — check for seed images
            const seed = Array.isArray(seedImages) && seedImages.length > 0 ? seedImages[0] : null;

            setName('');
            setDescription('');
            setChanges('');
            setWeight(70);
            setSlots([]);
            setSelectedSheet(null);
            setSelectedIndex(null);
            setCover(null);

            if (seed) {
                // A seed image was provided — pre-populate the upload tab
                setMethod('upload');
                setUploadedBase(null); // We don't have base64; user can swap
                setUploadPreview(seed.url);
            } else {
                setMethod('describe');
                setUploadedBase(null);
                setUploadPreview(null);
            }

            setStep('method');
        }
    }, [open, initial, seedImages]);

    // --- Generation ---

    const runGeneration = async (params: {
        description?: string;
        baseImage?: { mimeType: string; data: string };
        changes?: string;
    }) => {
        lastGenParams.current = params;
        setGenerating(true);
        setErrorMsg(null);
        setStep('candidates');
        setSelectedIndex(null);
        setSelectedSheet(null);

        const localSlots: SheetSlot[] = [];
        try {
            await generateCharacterStream(params, {
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
            setErrorMsg(e instanceof Error ? e.message : 'Generation failed');
        } finally {
            setGenerating(false);
        }
    };

    const handleRegenerate = () => {
        if (lastGenParams.current) void runGeneration(lastGenParams.current);
    };

    // --- Upload-method file handling ---

    const handleUploadFile = async (files: FileList | null) => {
        const file = files?.[0];
        if (uploadInputRef.current) uploadInputRef.current.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) { setErrorMsg('Please choose an image file'); return; }
        setErrorMsg(null);
        try {
            const b = await downscaleImageToBase64(file);
            setUploadedBase(b);
            setUploadPreview(URL.createObjectURL(file));
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Could not read the image');
        }
    };

    // --- Sheet selection / cover generation ---

    const handleSelectSheet = async (index: number) => {
        const slot = slots[index];
        if (!slot || slot === 'failed') return;
        setSelectedSheet(slot);
        setSelectedIndex(index);
        setCover(null);
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
        if (!selectedSheet) { setErrorMsg('Pick a character sheet first'); return; }
        setSaving(true);
        setErrorMsg(null);
        try {
            await onSave(
                {
                    name: name.trim(),
                    description: description.trim() || null,
                    sheetUrl: selectedSheet.url,
                    sheetPath: selectedSheet.path,
                    coverUrl: (cover ?? selectedSheet).url,
                    coverPath: (cover ?? selectedSheet).path,
                    weight,
                },
                initial?.id,
            );
            onClose();
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Failed to save character');
        } finally {
            setSaving(false);
        }
    };

    // --- Dismiss / draft ---

    const handleDismiss = async () => {
        if (dismissingRef.current) return;
        dismissingRef.current = true;
        if (!initial && onSaveDraft && selectedSheet) {
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

    // Escape key handling (no lightbox, so no guard needed)
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') void handleDismiss(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
        // handleDismiss closes over current field state; re-bind when it changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, initial, onSaveDraft, name, description, selectedSheet, cover, weight]);

    if (!mounted) return null;

    // Widen the dialog for the multi-column candidate/confirm steps
    const dialogMaxW = step === 'method' ? 'max-w-md' : 'max-w-3xl';

    return createPortal(
        <AnimatePresence>
            {open && (
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
                            <h2 className="text-lg font-bold text-content-primary">
                                {initial ? 'Edit Character' : 'New Character'}
                            </h2>
                            <button
                                onClick={() => void handleDismiss()}
                                className="p-1.5 rounded-lg hover:bg-interactive-hover text-content-tertiary"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Step: method */}
                        {step === 'method' && (
                            <div className="space-y-4">
                                {/* Tab switcher */}
                                <div className="flex gap-1 p-0.5 rounded-lg bg-surface-tertiary border border-stroke-subtle w-fit">
                                    <button
                                        type="button"
                                        onClick={() => setMethod('describe')}
                                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                                            method === 'describe'
                                                ? 'bg-surface-primary text-content-primary shadow-sm'
                                                : 'text-content-tertiary hover:text-content-secondary'
                                        }`}
                                    >
                                        <span className="flex items-center gap-1.5">
                                            <Sparkles className="w-3.5 h-3.5" />
                                            Describe
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setMethod('upload')}
                                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                                            method === 'upload'
                                                ? 'bg-surface-primary text-content-primary shadow-sm'
                                                : 'text-content-tertiary hover:text-content-secondary'
                                        }`}
                                    >
                                        <span className="flex items-center gap-1.5">
                                            <Upload className="w-3.5 h-3.5" />
                                            Upload image
                                        </span>
                                    </button>
                                </div>

                                {/* Describe tab */}
                                {method === 'describe' && (
                                    <div className="space-y-3">
                                        <textarea
                                            value={description}
                                            onChange={(e) => setDescription(e.target.value)}
                                            rows={5}
                                            placeholder="red hair, freckles, green eyes, leather jacket…"
                                            className="w-full px-3 py-2 rounded-lg bg-surface-tertiary border border-stroke-subtle text-content-primary resize-y min-h-[6rem] focus:outline-none focus:ring-2 focus:ring-accent-primary"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => void runGeneration({ description: description.trim() })}
                                            disabled={description.trim().length < 3}
                                            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-accent-primary text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                                        >
                                            <Wand2 className="w-4 h-4" />
                                            Generate sheets
                                        </button>
                                    </div>
                                )}

                                {/* Upload tab */}
                                {method === 'upload' && (
                                    <div className="space-y-3">
                                        {uploadPreview ? (
                                            <div className="flex items-start gap-3">
                                                <div className="w-20 h-20 rounded-lg overflow-hidden border border-stroke-subtle shrink-0">
                                                    <img
                                                        src={uploadPreview}
                                                        alt="Uploaded reference"
                                                        className="w-full h-full object-cover"
                                                    />
                                                </div>
                                                <div className="flex-1 space-y-1">
                                                    <p className="text-xs text-content-secondary">Reference photo ready.</p>
                                                    <button
                                                        type="button"
                                                        onClick={() => uploadInputRef.current?.click()}
                                                        className="text-xs text-accent-primary hover:underline"
                                                    >
                                                        Change photo
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => uploadInputRef.current?.click()}
                                                className="flex flex-col items-center justify-center gap-2 w-full py-8 rounded-lg border-2 border-dashed border-stroke-subtle text-content-tertiary hover:text-accent-primary hover:border-accent-primary/50 transition-colors"
                                            >
                                                <Upload className="w-6 h-6" />
                                                <span className="text-sm">Choose a photo</span>
                                            </button>
                                        )}

                                        {uploadPreview && (
                                            <>
                                                <div>
                                                    <label className="block text-xs font-medium text-content-secondary mb-1">
                                                        Changes <span className="text-content-tertiary font-normal">(optional)</span>
                                                    </label>
                                                    <textarea
                                                        value={changes}
                                                        onChange={(e) => setChanges(e.target.value)}
                                                        rows={3}
                                                        placeholder="make the pants high-waisted, change hair color to auburn…"
                                                        className="w-full px-3 py-2 rounded-lg bg-surface-tertiary border border-stroke-subtle text-content-primary resize-y min-h-[4rem] focus:outline-none focus:ring-2 focus:ring-accent-primary"
                                                    />
                                                </div>
                                                <button
                                                    type="button"
                                                    disabled={!uploadedBase}
                                                    onClick={() =>
                                                        void runGeneration({
                                                            baseImage: uploadedBase!,
                                                            changes: changes.trim() || undefined,
                                                        })
                                                    }
                                                    className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-accent-primary text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                                                >
                                                    <Wand2 className="w-4 h-4" />
                                                    Generate sheets
                                                </button>
                                            </>
                                        )}

                                        <input
                                            ref={uploadInputRef}
                                            type="file"
                                            accept="image/*"
                                            onChange={(e) => void handleUploadFile(e.target.files)}
                                            className="hidden"
                                        />
                                    </div>
                                )}

                                {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}
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
                                        onClick={() => setStep('method')}
                                        className="px-3 py-2 rounded-lg text-sm text-content-secondary hover:bg-interactive-hover"
                                    >
                                        ← Back
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleRegenerate}
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
                                        Save Character
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
