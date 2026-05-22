'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, Upload, Sparkles, Star, Loader2, Wand2 } from 'lucide-react';
import { uploadApi, charactersApi, generateCharacterStream, type Character, type CharacterRefImage, type CharacterInput } from '@/lib/api/client';
import ImageLightbox from '@/components/ui/ImageLightbox';

type GenSlot = CharacterRefImage | null | 'failed';

interface CharacterModalProps {
    open: boolean;
    initial?: Character | null;
    onClose: () => void;
    onSave: (input: CharacterInput, id?: string) => Promise<void>;
}

const MAX_IMAGES = 5;

export default function CharacterModal({ open, initial, onClose, onSave }: CharacterModalProps) {
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

    useEffect(() => {
        if (open) {
            setName(initial?.name ?? '');
            setDescription(initial?.description ?? '');
            setWeight(initial?.weight ?? 70);
            setImages(Array.isArray(initial?.reference_images) ? initial!.reference_images : []);
            setErrorMsg(null);
            setGenSlots([]);
            setLightboxIndex(null);
        }
    }, [open, initial]);

    if (!open) return null;

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

    // Generate 5 consistent reference poses from the description alone (Gemini
    // Nano Banana: a base front view + 4 poses conditioned on it). Replaces the
    // current image set with the generated poses.
    const handleGenerate = async () => {
        if (description.trim().length < 3) { setErrorMsg('Describe the character first, then generate'); return; }
        setGenerating(true);
        setErrorMsg(null);
        setImages([]);
        setGenSlots([]);

        // Local accumulator persists across stream callbacks; React state mirrors
        // it for rendering. Each pose fills its own slot the moment it arrives.
        const slots: GenSlot[] = [];
        try {
            await generateCharacterStream(description.trim(), {
                onStart: (total) => {
                    slots.length = 0;
                    for (let i = 0; i < total; i++) slots.push(null);
                    setGenSlots([...slots]);
                },
                onImage: ({ index, url, path }) => {
                    if (index >= 0 && index < slots.length) slots[index] = { url, path };
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

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
            <div
                className="w-full max-w-md rounded-2xl bg-surface-primary border border-stroke-subtle shadow-2xl p-5 space-y-4"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-content-primary">{initial ? 'Edit Character' : 'New Character'}</h2>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-interactive-hover text-content-tertiary">
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
                                    <img src={slot.url} alt="" className="w-full h-full object-cover animate-in fade-in duration-300" />
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
                                    <span className="absolute top-0.5 left-0.5 text-amber-300 pointer-events-none"><Star className="w-3 h-3 fill-current" /></span>
                                )}
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 pointer-events-none">
                                    {index !== 0 && (
                                        <button onClick={(e) => { e.stopPropagation(); makePrimary(index); }} title="Make primary" className="pointer-events-auto p-1 text-white hover:text-amber-300">
                                            <Star className="w-3.5 h-3.5" />
                                        </button>
                                    )}
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
                <p className="text-xs text-content-tertiary -mt-2">First image (★) is the primary. Click a pose to view it. Up to {MAX_IMAGES}.</p>

                {/* Generate the whole reference set from the description alone. */}
                <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={generating}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-accent-primary/30 bg-accent-primary/10 text-sm text-accent-primary hover:bg-accent-primary/20 disabled:opacity-60"
                >
                    {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                    {generating ? 'Generating 5 poses…' : 'Generate 5 poses from description'}
                </button>

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
                        rows={3}
                        placeholder="red hair, freckles, green eyes, leather jacket..."
                        className="w-full px-3 py-2 rounded-lg bg-surface-tertiary border border-stroke-subtle text-content-primary resize-none focus:outline-none focus:ring-2 focus:ring-accent-primary"
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
            </div>

            {lightboxIndex !== null && images.length > 0 && (
                <ImageLightbox
                    media={images.map((i) => i.url)}
                    type="any"
                    initialIndex={Math.min(lightboxIndex, images.length - 1)}
                    onClose={() => setLightboxIndex(null)}
                />
            )}
        </div>
    );
}
