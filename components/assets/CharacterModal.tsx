'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Upload, Sparkles, Loader2, Wand2, ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import {
    charactersApi,
    generateCharacterStream,
    CHARACTER_TIER_COST,
    type Character,
    type CharacterRefImage,
    type CharacterInput,
} from '@/lib/api/client';
import { downscaleImageToBase64 } from '@/lib/utils/image-processing';
import SheetCandidateGrid from '@/components/assets/character-wizard/SheetCandidateGrid';
import CharacterConfirmStep from '@/components/assets/character-wizard/CharacterConfirmStep';
import WizardStepper, { stepSlideVariants } from '@/components/assets/character-wizard/WizardStepper';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
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

const STEPS: WizardStep[] = ['method', 'candidates', 'confirm'];
const STEP_LABELS = ['Create', 'Choose', 'Details'];

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
    const [direction, setDirection] = useState(1); // 1 = forward, -1 = back (drives the slide)
    const [method, setMethod] = useState<MethodTab>('describe');
    const [tier, setTier] = useState<'pro' | 'flash'>('pro'); // generation quality / cost

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

    // Seed state on open
    useEffect(() => {
        if (!open) return;
        dismissingRef.current = false;
        setErrorMsg(null);
        setGenerating(false);
        setSaving(false);
        setDescribing(false);
        setCoverLoading(false);
        setDirection(1);
        setTier('pro');

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
                setUploadPreview(seed.url);
                setUploadedBase(null);
                // Load the seed URL into base64 so "Generate sheets" is enabled
                // without the user needing to re-pick the file. Best-effort.
                void (async () => {
                    try {
                        const resp = await fetch(seed.url);
                        const blob = await resp.blob();
                        const file = new File([blob], 'seed', { type: blob.type || 'image/png' });
                        const b = await downscaleImageToBase64(file);
                        setUploadedBase(b);
                    } catch {
                        // Leave uploadedBase null; user can re-pick if needed.
                    }
                })();
            } else {
                setMethod('describe');
                setUploadedBase(null);
                setUploadPreview(null);
            }

            setStep('method');
        }
    }, [open, initial, seedImages]);

    // --- Step navigation ---
    const goTo = (to: WizardStep) => {
        setDirection(STEPS.indexOf(to) >= STEPS.indexOf(step) ? 1 : -1);
        setStep(to);
    };

    // --- Generation ---

    const runGeneration = async (params: {
        description?: string;
        baseImage?: { mimeType: string; data: string };
        changes?: string;
    }) => {
        lastGenParams.current = params;
        setGenerating(true);
        setErrorMsg(null);
        setSelectedIndex(null);
        setSelectedSheet(null);
        goTo('candidates');

        const localSlots: SheetSlot[] = [];
        try {
            await generateCharacterStream({ ...params, tier }, {
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

    const handleGenerate = () => {
        if (method === 'describe') void runGeneration({ description: description.trim() });
        else if (uploadedBase) void runGeneration({ baseImage: uploadedBase, changes: changes.trim() || undefined });
    };

    const canGenerate = method === 'describe' ? description.trim().length >= 3 : !!uploadedBase;

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

    // --- Sheet selection (mark only — Continue advances) ---

    const handleSelectSheet = (index: number) => {
        const slot = slots[index];
        if (!slot || slot === 'failed') return;
        setSelectedSheet(slot);
        setSelectedIndex(index);
    };

    // Continue from the candidate grid → generate the cover in the background and
    // advance to the confirm step.
    const handleContinueToConfirm = async () => {
        if (!selectedSheet) return;
        goTo('confirm');
        setCover(null);
        setCoverLoading(true);
        try {
            const c = await charactersApi.generateCover(selectedSheet.url);
            setCover({ url: c.url, path: c.path });
        } catch {
            setCover(selectedSheet); // fall back to the sheet as the cover
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
        // Persist a draft as soon as there is ANY generated sheet — selected or not —
        // so closing after generation (X / backdrop / Escape) never loses the work.
        const draftSheet =
            selectedSheet ?? slots.find((s): s is CharacterRefImage => s !== null && s !== 'failed') ?? null;
        if (!initial && onSaveDraft && draftSheet) {
            try {
                await onSaveDraft({
                    name: name.trim(),
                    description: description.trim() || null,
                    sheetUrl: draftSheet.url,
                    sheetPath: draftSheet.path,
                    coverUrl: (cover ?? draftSheet).url,
                    coverPath: (cover ?? draftSheet).path,
                    weight,
                });
            } catch {
                // Best-effort: never block closing on a failed draft save.
            }
        }
        onClose();
    };

    const stepIndex = STEPS.indexOf(step);

    return (
        <Modal
            open={open}
            // X / backdrop / Escape all route through handleDismiss, which
            // persists a draft for an unsaved NEW character. The footer "Cancel"
            // button calls onClose directly (no draft) instead.
            onOpenChange={(o) => { if (!o) void handleDismiss(); }}
            size="full"
            contentClassName="max-w-4xl h-[min(88vh,820px)] flex flex-col overflow-hidden"
            showClose={false}
        >
                        {/* Header */}
                        <div className="flex items-center justify-between p-5 pb-3 shrink-0">
                            <Modal.Title className="text-lg font-bold">
                                {initial ? 'Edit Character' : 'New Character'}
                            </Modal.Title>
                            <button
                                onClick={() => void handleDismiss()}
                                className="p-1.5 rounded-lg hover:bg-interactive-hover text-content-tertiary"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Stepper */}
                        <div className="px-5 pb-4 shrink-0">
                            <WizardStepper steps={STEP_LABELS} current={stepIndex} />
                        </div>

                        {/* Sliding content area (fixed height) */}
                        <div className="relative flex-1 min-h-0 overflow-hidden">
                            <AnimatePresence custom={direction} initial={false}>
                                <motion.div
                                    key={step}
                                    custom={direction}
                                    variants={stepSlideVariants}
                                    initial="enter"
                                    animate="center"
                                    exit="exit"
                                    transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                                    className="absolute inset-0 px-5"
                                >
                                    {/* Step: method */}
                                    {step === 'method' && (
                                        <div className="h-full flex items-center justify-center">
                                            <div className="w-full max-w-lg space-y-4">
                                                {/* Method toggle — glass sliding-pill segmented control */}
                                                <div className="flex justify-center">
                                                    <SegmentedTabs
                                                        layoutId="char-method-tabs"
                                                        value={method}
                                                        onChange={setMethod}
                                                        options={[
                                                            { key: 'describe', label: 'Describe', icon: Sparkles },
                                                            { key: 'upload', label: 'Upload image', icon: Upload },
                                                        ]}
                                                    />
                                                </div>

                                                {method === 'describe' && (
                                                    <textarea
                                                        value={description}
                                                        onChange={(e) => setDescription(e.target.value)}
                                                        rows={5}
                                                        placeholder="red hair, freckles, green eyes, leather jacket…"
                                                        className="w-full px-3 py-2 rounded-lg bg-surface-tertiary border border-stroke-subtle text-content-primary resize-y min-h-[8rem] focus:outline-none focus:ring-2 focus:ring-accent-primary"
                                                    />
                                                )}

                                                {method === 'upload' && (
                                                    <div className="space-y-3">
                                                        {uploadPreview ? (
                                                            <div className="flex items-start gap-3">
                                                                <div className="w-24 h-24 rounded-lg overflow-hidden border border-stroke-subtle shrink-0">
                                                                    <img src={uploadPreview} alt="Uploaded reference" className="w-full h-full object-cover" />
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
                                                                className="flex flex-col items-center justify-center gap-2 w-full py-10 rounded-lg border-2 border-dashed border-stroke-subtle text-content-tertiary hover:text-accent-primary hover:border-accent-primary/50 transition-colors"
                                                            >
                                                                <Upload className="w-6 h-6" />
                                                                <span className="text-sm">Choose a photo</span>
                                                            </button>
                                                        )}

                                                        {uploadPreview && (
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

                                                {/* Quality / cost selector */}
                                                <div className="pt-1">
                                                    <span className="block text-xs font-medium text-content-secondary mb-1.5">Quality</span>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {([
                                                            { key: 'pro' as const, label: 'Pro', hint: 'Best quality' },
                                                            { key: 'flash' as const, label: 'Flash', hint: 'Faster' },
                                                        ]).map((opt) => (
                                                            <button
                                                                key={opt.key}
                                                                type="button"
                                                                onClick={() => setTier(opt.key)}
                                                                className={`flex flex-col items-start gap-0.5 px-3 py-2 rounded-lg border text-left transition-colors ${
                                                                    tier === opt.key
                                                                        ? 'border-accent-primary bg-accent-primary/10 ring-1 ring-accent-primary'
                                                                        : 'border-stroke-subtle hover:bg-interactive-hover'
                                                                }`}
                                                            >
                                                                <span className="text-sm font-medium text-content-primary">{opt.label}</span>
                                                                <span className="text-[11px] text-content-tertiary">{opt.hint} · {CHARACTER_TIER_COST[opt.key]} credits</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Step: candidates */}
                                    {step === 'candidates' && (
                                        <div className="h-full">
                                            <SheetCandidateGrid
                                                slots={slots}
                                                selectedIndex={selectedIndex}
                                                onSelect={handleSelectSheet}
                                                generating={generating}
                                            />
                                        </div>
                                    )}

                                    {/* Step: confirm */}
                                    {step === 'confirm' && selectedSheet && (
                                        <div className="h-full">
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
                                            />
                                        </div>
                                    )}
                                </motion.div>
                            </AnimatePresence>
                        </div>

                        {/* Error + footer (fixed) */}
                        <div className="shrink-0 px-5 pb-5 pt-3 border-t border-stroke-subtle/60">
                            {errorMsg && <p className="text-xs text-red-400 mb-2">{errorMsg}</p>}
                            <div className="flex items-center justify-between gap-2">
                                {/* Left: Cancel (step 0) or Back */}
                                {step === 'method' ? (
                                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-content-secondary hover:bg-interactive-hover">
                                        Cancel
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => goTo(step === 'confirm' ? 'candidates' : 'method')}
                                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-content-secondary hover:bg-interactive-hover"
                                    >
                                        <ArrowLeft className="w-4 h-4" />
                                        Back
                                    </button>
                                )}

                                {/* Right: primary action per step */}
                                {step === 'method' && (
                                    <button
                                        onClick={handleGenerate}
                                        disabled={!canGenerate}
                                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Wand2 className="w-4 h-4" />
                                        Generate sheets · {CHARACTER_TIER_COST[tier]} cr
                                    </button>
                                )}

                                {step === 'candidates' && (
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={handleRegenerate}
                                            disabled={generating}
                                            className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-stroke-subtle text-content-secondary hover:bg-interactive-hover disabled:opacity-50"
                                        >
                                            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                                            Regenerate
                                        </button>
                                        <button
                                            onClick={() => void handleContinueToConfirm()}
                                            disabled={!selectedSheet}
                                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            Continue
                                            <ArrowRight className="w-4 h-4" />
                                        </button>
                                    </div>
                                )}

                                {step === 'confirm' && (
                                    <button
                                        onClick={() => void handleSave()}
                                        disabled={saving || !name.trim() || !selectedSheet}
                                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                        Finish
                                    </button>
                                )}
                            </div>
                        </div>
        </Modal>
    );
}
