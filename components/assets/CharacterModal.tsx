'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Upload, Sparkles, Star, Loader2, Wand2, ScanFace } from 'lucide-react';
import { uploadApi, charactersApi, generateCharacterStream, type Character, type CharacterRefImage, type CharacterInput } from '@/lib/api/client';
import { downscaleImageToBase64 } from '@/lib/utils/image-processing';
import ImageLightbox from '@/components/ui/ImageLightbox';

type GenSlot = CharacterRefImage | null | 'failed';

interface CharacterModalProps {
    open: boolean;
    initial?: Character | null;
    /** Reference images to pre-seed a NEW character with (create mode only). */
    seedImages?: CharacterRefImage[];
    onClose: () => void;
    onSave: (input: CharacterInput, id?: string) => Promise<void>;
    /** Called when a NEW character is dismissed without Cancel (X/backdrop/Escape)
     *  and has >=1 image — persists it as a draft. */
    onSaveDraft?: (input: CharacterInput) => Promise<void>;
}

const MAX_IMAGES = 6;

export default function CharacterModal({ open, initial, seedImages, onClose, onSave, onSaveDraft }: CharacterModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [weight, setWeight] = useState(70);
    const [images, setImages] = useState<CharacterRefImage[]>([]);
    const [uploading, setUploading] = useState(false);
    const [describing, setDescribing] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [genSlots, setGenSlots] = useState<GenSlot[]>([]);
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const photoInputRef = useRef<HTMLInputElement>(null);
    const dismissingRef = useRef(false);

    // Portal to <body> so the fixed-inset overlay centers on the viewport even
    // when a parent (e.g. the framer-motion slide-in side panel) has a CSS
    // transform that would otherwise become the containing block for `fixed`.
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    useEffect(() => {
        if (open) {
            setName(initial?.name ?? '');
            setDescription(initial?.description ?? '');
            setWeight(initial?.weight ?? 70);
            const seeded = Array.isArray(initial?.reference_images)
                ? initial!.reference_images
                : (Array.isArray(seedImages) ? seedImages.slice(0, MAX_IMAGES) : []);
            setImages(seeded);
            setErrorMsg(null);
            setGenSlots([]);
            setLightboxIndex(null);
            dismissingRef.current = false;
        }
    }, [open, initial, seedImages]);

    const handleFiles = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        setUploading(true);
        setErrorMsg(null);
        let failures = 0;
        try {
            const room = MAX_IMAGES - images.length;
            const chosen = Array.from(files).slice(0, Math.max(0, room));
            const results = await Promise.all(
                chosen.map(async (file) => {
                    if (!file.type.startsWith('image/')) { failures++; return null; }
                    try {
                        const r = await uploadApi.upload(file, { filename: `character-${Date.now()}-${file.name}` });
                        return { url: r.publicUrl, path: r.path } as CharacterRefImage;
                    } catch { failures++; return null; }
                })
            );
            const ok = results.filter((r): r is CharacterRefImage => r !== null);
            if (ok.length > 0) setImages((prev) => [...prev, ...ok].slice(0, MAX_IMAGES));
            if (failures > 0) setErrorMsg(`${failures} image(s) failed to upload`);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const removeImage = (index: number) => setImages((prev) => prev.filter((_, i) => i !== index));
    const makePrimary = (index: number) =>
        setImages((prev) => {
            if (index === 0) return prev;
            const copy = [...prev];
            const [picked] = copy.splice(index, 1);
            return [picked, ...copy];
        });

    // Mark/unmark an image as the close-up face reference. Only one face at a
    // time; toggling the current face off clears it. The face role is what the
    // multi-character image pipeline uses (face + primary per character).
    const toggleFace = (index: number) =>
        setImages((prev) => {
            const target = prev[index];
            if (!target) return prev;
            const makingFace = target.role !== 'face';
            return prev.map((img, i) => {
                if (i === index) return makingFace ? { ...img, role: 'face' as const } : { url: img.url, path: img.path };
                return makingFace && img.role === 'face' ? { url: img.url, path: img.path } : img;
            });
        });

    const handleAutoDescribe = async () => {
        if (images.length === 0) { setErrorMsg('Add a reference image first'); return; }
        setDescribing(true);
        setErrorMsg(null);
        try {
            const { description } = await charactersApi.autoDescribe(images[0].url);
            setDescription(description);
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Auto-describe failed');
        } finally {
            setDescribing(false);
        }
    };

    // Generate a consistent reference set (Gemini Nano Banana). With a text
    // description: a base front view + 4 poses + a face close-up, all
    // conditioned on the base. With an uploaded photo: that photo becomes the
    // base (kept as-is) and the rest are generated from it. Each image fills its
    // own slot the moment it arrives; replaces the current image set.
    const runGeneration = async (params: { description?: string; baseImage?: { mimeType: string; data: string } }) => {
        setGenerating(true);
        setErrorMsg(null);
        setImages([]);
        setGenSlots([]);

        // Local accumulator persists across stream callbacks; React state mirrors
        // it for rendering. Each pose fills its own slot the moment it arrives.
        const slots: GenSlot[] = [];
        try {
            await generateCharacterStream(params, {
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
            setErrorMsg(err instanceof Error ? err.message : 'Generation failed');
        } finally {
            setGenerating(false);
            setGenSlots([]);
        }
    };

    const handleGenerate = () => {
        if (description.trim().length < 3) { setErrorMsg('Describe the character first, then generate'); return; }
        void runGeneration({ description: description.trim() });
    };

    // Build the character FROM an uploaded photo: it becomes the base and the
    // remaining poses + face close-up are generated conditioned on it.
    const handlePhotoFiles = async (files: FileList | null) => {
        const file = files?.[0];
        if (photoInputRef.current) photoInputRef.current.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) { setErrorMsg('Please choose an image file'); return; }
        setErrorMsg(null);
        try {
            // Downscale before base64-encoding: a full-res photo (9 MB+) would
            // overflow the JSON body limit on /api/characters/generate and fail
            // silently. Capping the long edge keeps the payload small for any input.
            const baseImage = await downscaleImageToBase64(file);
            await runGeneration({ baseImage });
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Could not read the photo');
        }
    };

    const handleSave = async () => {
        if (!name.trim()) { setErrorMsg('Name is required'); return; }
        if (images.length === 0) { setErrorMsg('At least one reference image is required'); return; }
        setSaving(true);
        setErrorMsg(null);
        try {
            await onSave(
                {
                    name: name.trim(),
                    description: description.trim() || null,
                    referenceImages: images,
                    thumbnailUrl: images[0].url,
                    weight,
                },
                initial?.id
            );
            onClose();
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Failed to save character');
        } finally {
            setSaving(false);
        }
    };

    // Dismiss WITHOUT Cancel (X button, backdrop, Escape). For a brand-new
    // character with at least one image, persist what we have as a draft;
    // otherwise just close. Edits to an existing character are discarded.
    const handleDismiss = async () => {
        if (dismissingRef.current) return;
        dismissingRef.current = true;
        if (!initial && onSaveDraft && images.length > 0) {
            try {
                await onSaveDraft({
                    name: name.trim(),
                    description: description.trim() || null,
                    referenceImages: images,
                    thumbnailUrl: images[0].url,
                    weight,
                });
            } catch {
                // Best-effort: never block closing on a failed draft save.
            }
        }
        onClose();
    };

    useEffect(() => {
        if (!open) return;
        // Don't dismiss on Escape while the image lightbox is open — Escape there
        // should only close the lightbox (which also listens on window).
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && lightboxIndex === null) void handleDismiss(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
        // handleDismiss closes over current field state; re-bind when it changes.
    }, [open, initial, onSaveDraft, name, description, images, weight, lightboxIndex]);

    if (!mounted) return null;

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
                        className="w-full max-w-md rounded-2xl bg-surface-primary border border-stroke-subtle shadow-2xl p-5 space-y-4"
                        onClick={(e) => e.stopPropagation()}
                        initial={{ opacity: 0, scale: 0.96, y: 12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 12 }}
                        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    >
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-content-primary">{initial ? 'Edit Character' : 'New Character'}</h2>
                    <button onClick={() => void handleDismiss()} className="p-1.5 rounded-lg hover:bg-interactive-hover text-content-tertiary">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {generating ? (
                    // Progressive generation: one tile per pose. Each shows a
                    // pulsing skeleton until its image streams in.
                    <div className="flex flex-wrap gap-2">
                        {genSlots.map((slot, index) => (
                            <div key={index} className="relative w-16 h-16 rounded-lg overflow-hidden border border-stroke-subtle">
                                {slot && slot !== 'failed' ? (
                                    <>
                                        <img src={slot.url} alt="" className="w-full h-full object-cover animate-in fade-in duration-300" />
                                        {slot.role === 'face' && (
                                            <span className="absolute top-0.5 right-0.5 text-sky-300" title="Face close-up"><ScanFace className="w-3.5 h-3.5" /></span>
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
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {images.map((img, index) => (
                            <div key={img.path || img.url} className="relative w-16 h-16 rounded-lg overflow-hidden group border border-stroke-subtle">
                                <img
                                    src={img.url}
                                    alt=""
                                    onClick={() => setLightboxIndex(index)}
                                    className="w-full h-full object-cover cursor-zoom-in"
                                />
                                {index === 0 && (
                                    <span className="absolute top-0.5 left-0.5 text-amber-300 pointer-events-none" title="Primary"><Star className="w-3 h-3 fill-current" /></span>
                                )}
                                {img.role === 'face' && (
                                    <span className="absolute top-0.5 right-0.5 text-sky-300 pointer-events-none" title="Face close-up"><ScanFace className="w-3.5 h-3.5" /></span>
                                )}
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 pointer-events-none">
                                    {index !== 0 && (
                                        <button onClick={(e) => { e.stopPropagation(); makePrimary(index); }} title="Make primary" className="pointer-events-auto p-1 text-white hover:text-amber-300">
                                            <Star className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                    <button onClick={(e) => { e.stopPropagation(); toggleFace(index); }} title={img.role === 'face' ? 'Unmark as face' : 'Mark as face close-up'} className={`pointer-events-auto p-1 hover:text-sky-300 ${img.role === 'face' ? 'text-sky-300' : 'text-white'}`}>
                                        <ScanFace className="w-3.5 h-3.5" />
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); removeImage(index); }} title="Remove" className="pointer-events-auto p-1 text-white hover:text-red-400">
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        ))}
                        {images.length < MAX_IMAGES && (
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="w-16 h-16 rounded-lg border border-dashed border-stroke-subtle flex items-center justify-center text-content-tertiary hover:text-accent-primary hover:border-accent-primary/50"
                            >
                                {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                            </button>
                        )}
                    </div>
                )}
                <p className="text-xs text-content-tertiary -mt-2">★ primary · <ScanFace className="inline w-3 h-3 -mt-0.5 text-sky-300" /> face close-up. Hover an image to set either. Click to view. Up to {MAX_IMAGES}.</p>

                {/* Build the whole reference set automatically — either from the
                    description alone, or from an uploaded photo of the character. */}
                <div className="grid grid-cols-2 gap-2">
                    <button
                        type="button"
                        onClick={handleGenerate}
                        disabled={generating}
                        className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-accent-primary/30 bg-accent-primary/10 text-sm text-accent-primary hover:bg-accent-primary/20 disabled:opacity-60"
                    >
                        {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                        {generating ? 'Generating…' : 'From description'}
                    </button>
                    <button
                        type="button"
                        onClick={() => photoInputRef.current?.click()}
                        disabled={generating}
                        className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-accent-primary/30 bg-accent-primary/10 text-sm text-accent-primary hover:bg-accent-primary/20 disabled:opacity-60"
                    >
                        <Upload className="w-4 h-4" />
                        From my photo
                    </button>
                </div>
                <p className="text-xs text-content-tertiary -mt-2">Auto-generates a front view, 4 poses and a face close-up. “From my photo” uses your photo as the identity source for clean, consistent studio shots.</p>

                <div>
                    <label className="block text-xs font-medium text-content-secondary mb-1">Name *</label>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Alice"
                        className="w-full px-3 py-2 rounded-lg bg-surface-tertiary border border-stroke-subtle text-content-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                    />
                </div>

                <div>
                    <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-medium text-content-secondary">Description</label>
                        <button
                            type="button"
                            onClick={handleAutoDescribe}
                            disabled={describing}
                            className="flex items-center gap-1 text-xs text-accent-primary hover:underline disabled:opacity-50"
                        >
                            {describing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                            Auto-describe
                        </button>
                    </div>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={6}
                        placeholder="red hair, freckles, green eyes, leather jacket..."
                        className="w-full px-3 py-2 rounded-lg bg-surface-tertiary border border-stroke-subtle text-content-primary resize-y min-h-[7rem] focus:outline-none focus:ring-2 focus:ring-accent-primary"
                    />
                </div>

                <div>
                    <label className="block text-xs font-medium text-content-secondary mb-1">Reference weight: {weight}</label>
                    <input type="range" min={0} max={100} value={weight} onChange={(e) => setWeight(Number(e.target.value))} className="w-full accent-accent-primary" />
                </div>

                {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}

                <div className="flex justify-end gap-2 pt-1">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-content-secondary hover:bg-interactive-hover">Cancel</button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-hover disabled:opacity-50 flex items-center gap-2"
                    >
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                        Save Character
                    </button>
                </div>

                        <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={(e) => handleFiles(e.target.files)} className="hidden" />
                        <input ref={photoInputRef} type="file" accept="image/*" onChange={(e) => handlePhotoFiles(e.target.files)} className="hidden" />
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
