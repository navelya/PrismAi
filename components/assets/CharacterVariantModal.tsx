'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Wand2, ArrowLeft, ArrowRight, Check, Coins } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import {
    charactersApi,
    generateCharacterVariantStream,
    CHARACTER_TIER_COST,
    CHARACTER_SHEET_COUNT,
    type Character,
    type CharacterRefImage,
    type CharacterInput,
} from '@/lib/api/client';
import SheetCandidateGrid from '@/components/assets/character-wizard/SheetCandidateGrid';
import CharacterConfirmStep from '@/components/assets/character-wizard/CharacterConfirmStep';
import WizardStepper, { stepSlideVariants } from '@/components/assets/character-wizard/WizardStepper';
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

const STEPS: WizardStep[] = ['changes', 'candidates', 'confirm'];
const STEP_LABELS = ['Changes', 'Choose', 'Details'];

export default function CharacterVariantModal({
    open,
    source,
    onClose,
    onSave,
    onSaveDraft,
}: CharacterVariantModalProps) {
    // Wizard navigation
    const [step, setStep] = useState<WizardStep>('changes');
    const [direction, setDirection] = useState(1);

    // Changes step
    const [changes, setChanges] = useState('');
    const [tier, setTier] = useState<'pro' | 'flash'>('pro');

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

    // Reset all state on open
    useEffect(() => {
        if (!open) return;
        dismissingRef.current = false;
        setStep('changes');
        setDirection(1);
        setChanges('');
        setTier('pro');
        setName(source ? `${source?.name} (variant)` : '');
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

    // --- Step navigation ---
    const goTo = (to: WizardStep) => {
        setDirection(STEPS.indexOf(to) >= STEPS.indexOf(step) ? 1 : -1);
        setStep(to);
    };

    // --- Generation ---

    const runGeneration = async () => {
        if (!source) return;
        if (changes.trim().length < 3) { setErrorMsg('Describe the changes first (a few words)'); return; }
        setGenerating(true);
        setErrorMsg(null);
        setSelectedIndex(null);
        setSelectedSheet(null);
        goTo('candidates');
        // Show the skeleton grid immediately — don't wait for the server 'start'.
        setSlots(Array.from({ length: CHARACTER_SHEET_COUNT }, () => null));

        const localSlots: SheetSlot[] = [];
        try {
            await generateCharacterVariantStream(source.id, { changes: changes.trim(), tier }, {
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
                onError: (m) => { setErrorMsg(m); setSlots([]); },
            });
        } catch (e) {
            setErrorMsg(e instanceof Error ? e.message : 'Variant generation failed');
        } finally {
            setGenerating(false);
        }
    };

    // --- Sheet selection (mark only — Continue advances) ---

    const handleSelectSheet = (index: number) => {
        const slot = slots[index];
        if (!slot || slot === 'failed') return;
        setSelectedSheet(slot);
        setSelectedIndex(index);
    };

    const handleContinueToConfirm = async () => {
        if (!selectedSheet) return;
        setDescription((d) => d || changes.trim());
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
        // Persist a draft as soon as there is ANY generated sheet — selected or not.
        const draftSheet =
            selectedSheet ?? slots.find((s): s is CharacterRefImage => s !== null && s !== 'failed') ?? null;
        if (onSaveDraft && draftSheet) {
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
    const sourceThumb =
        source?.cover_url ||
        source?.sheet_url ||
        source?.thumbnail_url ||
        source?.reference_images?.[0]?.url;

    return (
        <Modal
            open={open && !!source}
            // X / backdrop / Escape route through handleDismiss (persists a draft);
            // the footer Cancel button calls onClose directly.
            onOpenChange={(o) => { if (!o) void handleDismiss(); }}
            size="full"
            contentClassName="max-w-4xl h-[min(88vh,820px)] flex flex-col overflow-hidden"
            showClose={false}
        >
                        {/* Header */}
                        <div className="flex items-center justify-between p-5 pb-3 shrink-0">
                            <Modal.Title className="text-lg font-bold">Create variant</Modal.Title>
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
                                    {/* Step: changes */}
                                    {step === 'changes' && (
                                        <div className="h-full flex items-center justify-center">
                                            <div className="w-full max-w-lg space-y-4">
                                                {/* Source character chip */}
                                                <div className="flex items-center gap-3">
                                                    <div className="w-14 h-14 rounded-lg overflow-hidden border border-stroke-subtle bg-white/5 shrink-0">
                                                        {sourceThumb && (
                                                            <img src={sourceThumb} alt={source?.name} className="w-full h-full object-cover" />
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-content-tertiary">
                                                        Restyle{' '}
                                                        <span className="text-content-secondary font-medium">{source?.name}</span>
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
                                                        rows={5}
                                                        placeholder="cyberpunk streetwear, neon palette, glossy jacket; change hair to white…"
                                                        className="w-full px-3 py-2 rounded-lg bg-surface-tertiary border border-stroke-subtle text-content-primary resize-y min-h-[7rem] focus:outline-none focus:ring-2 focus:ring-accent-primary"
                                                    />
                                                </div>

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
                                {step === 'changes' ? (
                                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-content-secondary hover:bg-interactive-hover">
                                        Cancel
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => goTo(step === 'confirm' ? 'candidates' : 'changes')}
                                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-content-secondary hover:bg-interactive-hover"
                                    >
                                        <ArrowLeft className="w-4 h-4" />
                                        Back
                                    </button>
                                )}

                                {/* Right: primary action per step */}
                                {step === 'changes' && (
                                    <button
                                        onClick={() => void runGeneration()}
                                        disabled={changes.trim().length < 3}
                                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Wand2 className="w-4 h-4" />
                                        <span className="inline-flex items-center gap-1">Generate variants · {CHARACTER_TIER_COST[tier]}<Coins className="w-3.5 h-3.5" /></span>
                                    </button>
                                )}

                                {step === 'candidates' && (
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => void runGeneration()}
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
