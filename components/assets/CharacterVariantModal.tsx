'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Wand2, ScanFace, Star } from 'lucide-react';
import { generateCharacterVariantStream, type Character, type CharacterRefImage, type CharacterInput } from '@/lib/api/client';
import ImageLightbox from '@/components/ui/ImageLightbox';

type GenSlot = CharacterRefImage | null | 'failed';

interface CharacterVariantModalProps {
    open: boolean;
    source: Character | null;
    onClose: () => void;
    onSave: (input: CharacterInput) => Promise<void>;
    /** Called when the variant is dismissed without Cancel and has generated
     *  images — persists it as a draft. */
    onSaveDraft?: (input: CharacterInput) => Promise<void>;
}

const MAX_IMAGES = 6;

export default function CharacterVariantModal({ open, source, onClose, onSave, onSaveDraft }: CharacterVariantModalProps) {
    const [style, setStyle] = useState('');
    const [name, setName] = useState('');
    const [images, setImages] = useState<CharacterRefImage[]>([]);
    const [genSlots, setGenSlots] = useState<GenSlot[]>([]);
    const [generating, setGenerating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    useEffect(() => {
        if (open) {
            setStyle('');
            setName(source ? `${source.name} (variant)` : '');
            setImages([]);
            setGenSlots([]);
            setGenerating(false);
            setSaving(false);
            setErrorMsg(null);
            setLightboxIndex(null);
        }
    }, [open, source]);

    const runGeneration = async () => {
        if (!source) return;
        if (style.trim().length < 3) { setErrorMsg('Describe the new style first (at least a few words)'); return; }
        setGenerating(true);
        setErrorMsg(null);
        setImages([]);
        setGenSlots([]);

        const slots: GenSlot[] = [];
        try {
            await generateCharacterVariantStream(source.id, { style: style.trim() }, {
                onStart: (total) => {
                    slots.length = 0;
                    for (let i = 0; i < total; i++) slots.push(null);
                    setGenSlots([...slots]);
                },
                onImage: ({ index, url, path, role }) => {
                    if (index >= 0 && index < slots.length) slots[index] = role ? { url, path, role } : { url, path };
                    setGenSlots([...slots]);
                },
                onPoseFailed: (index) => {
                    if (index >= 0 && index < slots.length && slots[index] === null) slots[index] = 'failed';
                    setGenSlots([...slots]);
                },
                onError: (message) => { setErrorMsg(message); },
                onDone: () => {
                    const final = slots.filter((s): s is CharacterRefImage => !!s && s !== 'failed');
                    if (final.length > 0) setImages(final.slice(0, MAX_IMAGES));
                },
            });
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Variant generation failed');
        } finally {
            setGenerating(false);
            setGenSlots([]);
        }
    };

    const handleSave = async () => {
        if (!name.trim()) { setErrorMsg('Name is required'); return; }
        if (images.length === 0) { setErrorMsg('Generate the variant first'); return; }
        setSaving(true);
        setErrorMsg(null);
        try {
            await onSave({
                name: name.trim(),
                description: style.trim() || null,
                referenceImages: images,
                thumbnailUrl: images[0].url,
                weight: source?.weight ?? 70,
            });
            onClose();
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Failed to save variant');
        } finally {
            setSaving(false);
        }
    };

    // Dismiss WITHOUT Cancel (X/backdrop/Escape). A variant exists only after
    // generation, so persist as a draft when there are images.
    const handleDismiss = async () => {
        if (onSaveDraft && images.length > 0) {
            try {
                await onSaveDraft({
                    name: name.trim(),
                    description: style.trim() || null,
                    referenceImages: images,
                    thumbnailUrl: images[0].url,
                    weight: source?.weight ?? 70,
                });
            } catch {
                // Best-effort: never block closing on a failed draft save.
            }
        }
        onClose();
    };

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') void handleDismiss(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onSaveDraft, name, style, images, source]);

    if (!mounted) return null;

    const sourceThumb = source?.thumbnail_url || source?.reference_images?.[0]?.url;

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
                        className="w-full max-w-md rounded-2xl bg-surface-primary border border-stroke-subtle shadow-2xl p-5 space-y-4"
                        onClick={(e) => e.stopPropagation()}
                        initial={{ opacity: 0, scale: 0.96, y: 12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 12 }}
                        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    >
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-bold text-content-primary">Create variant</h2>
                            <button onClick={() => void handleDismiss()} className="p-1.5 rounded-lg hover:bg-interactive-hover text-content-tertiary">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-lg overflow-hidden border border-stroke-subtle bg-white/5 shrink-0">
                                {sourceThumb && <img src={sourceThumb} alt={source.name} className="w-full h-full object-cover" />}
                            </div>
                            <p className="text-xs text-content-tertiary">
                                Restyle <span className="text-content-secondary font-medium">{source.name}</span> with a new look —
                                same person, new outfit/art-style. All positions are regenerated.
                            </p>
                        </div>

                        {generating ? (
                            <div className="flex flex-wrap gap-2">
                                {genSlots.map((slot, index) => (
                                    <div key={index} className="relative w-16 h-16 rounded-lg overflow-hidden border border-stroke-subtle">
                                        {slot && slot !== 'failed' ? (
                                            <>
                                                <img src={slot.url} alt="" className="w-full h-full object-cover animate-in fade-in duration-300" />
                                                {slot.role === 'face' && (
                                                    <span className="absolute top-0.5 right-0.5 text-sky-300"><ScanFace className="w-3.5 h-3.5" /></span>
                                                )}
                                            </>
                                        ) : slot === 'failed' ? (
                                            <div className="w-full h-full flex items-center justify-center bg-surface-tertiary text-content-tertiary">
                                                <X className="w-4 h-4" />
                                            </div>
                                        ) : (
                                            <div className="w-full h-full bg-surface-tertiary animate-pulse" />
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : images.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                                {images.map((img, index) => (
                                    <div key={img.path || img.url} className="relative w-16 h-16 rounded-lg overflow-hidden border border-stroke-subtle">
                                        <img src={img.url} alt="" onClick={() => setLightboxIndex(index)} className="w-full h-full object-cover cursor-zoom-in" />
                                        {index === 0 && (
                                            <span className="absolute top-0.5 left-0.5 text-amber-300 pointer-events-none"><Star className="w-3 h-3 fill-current" /></span>
                                        )}
                                        {img.role === 'face' && (
                                            <span className="absolute top-0.5 right-0.5 text-sky-300 pointer-events-none"><ScanFace className="w-3.5 h-3.5" /></span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        <div>
                            <label className="block text-xs font-medium text-content-secondary mb-1">New style *</label>
                            <textarea
                                value={style}
                                onChange={(e) => setStyle(e.target.value)}
                                rows={4}
                                placeholder="cyberpunk streetwear, neon palette, glossy jacket..."
                                className="w-full px-3 py-2 rounded-lg bg-surface-tertiary border border-stroke-subtle text-content-primary resize-y min-h-[5rem] focus:outline-none focus:ring-2 focus:ring-accent-primary"
                            />
                        </div>

                        <button
                            type="button"
                            onClick={runGeneration}
                            disabled={generating || saving}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-accent-primary/30 bg-accent-primary/10 text-sm text-accent-primary hover:bg-accent-primary/20 disabled:opacity-60"
                        >
                            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                            {generating ? 'Generating…' : images.length > 0 ? 'Regenerate' : 'Generate variant'}
                        </button>

                        <div>
                            <label className="block text-xs font-medium text-content-secondary mb-1">Name *</label>
                            <input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Alice (cyberpunk)"
                                className="w-full px-3 py-2 rounded-lg bg-surface-tertiary border border-stroke-subtle text-content-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                            />
                        </div>

                        {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}

                        <div className="flex justify-end gap-2 pt-1">
                            <button onClick={onClose} className="px-4 py-2 rounded-lg text-content-secondary hover:bg-interactive-hover">Cancel</button>
                            <button
                                onClick={handleSave}
                                disabled={saving || generating || images.length === 0}
                                className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-hover disabled:opacity-50 flex items-center gap-2"
                            >
                                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                                Save variant
                            </button>
                        </div>
                    </motion.div>

                    {lightboxIndex !== null && images.length > 0 && (
                        <ImageLightbox
                            media={images.map((i) => i.url)}
                            type="any"
                            initialIndex={Math.min(lightboxIndex, images.length - 1)}
                            onClose={() => setLightboxIndex(null)}
                        />
                    )}
                </motion.div>
            )}
        </AnimatePresence>,
        document.body,
    );
}
