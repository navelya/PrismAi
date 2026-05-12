'use client';

import React, { useEffect, useCallback, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Download, ChevronDown } from 'lucide-react';
import { detectMediaTypeFromUrl } from '@/lib/workflow/result-format';
import { convertImageFormat, extensionForFormat, urlMatchesFormat, type DownloadFormat } from '@/lib/utils/image-format';


interface ImageLightboxProps {
    media: any; // Can be an array of objects/strings or a single object/string
    type: 'image' | 'video' | 'any';
    initialIndex: number;
    onClose: () => void;
}

export default function ImageLightbox({ media, type, initialIndex, onClose }: ImageLightboxProps) {
    const [currentIndex, setCurrentIndex] = React.useState(initialIndex);
    // Portal mount guard — prevents SSR mismatch
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    const [downloadFormat, setDownloadFormat] = useState<DownloadFormat>('png');
    const [formatMenuOpen, setFormatMenuOpen] = useState(false);
    const formatMenuRef = useRef<HTMLDivElement>(null);

    // Load persisted format choice on mount.
    useEffect(() => {
        try {
            const stored = window.localStorage.getItem('prismai.lightbox.downloadFormat');
            if (stored === 'png' || stored === 'jpeg' || stored === 'webp') {
                setDownloadFormat(stored);
            }
        } catch {
            // localStorage unavailable; stick with default
        }
    }, []);

    const persistFormat = useCallback((fmt: DownloadFormat) => {
        setDownloadFormat(fmt);
        try {
            window.localStorage.setItem('prismai.lightbox.downloadFormat', fmt);
        } catch {
            // ignore
        }
    }, []);

    // Close format menu on outside click.
    useEffect(() => {
        if (!formatMenuOpen) return;
        const onPointer = (e: PointerEvent) => {
            if (formatMenuRef.current && !formatMenuRef.current.contains(e.target as Node)) {
                setFormatMenuOpen(false);
            }
        };
        window.addEventListener('pointerdown', onPointer);
        return () => window.removeEventListener('pointerdown', onPointer);
    }, [formatMenuOpen]);

    // Normalize media to array
    const normalizedMedia = React.useMemo(() => {
        const items = Array.isArray(media) ? media : [media];
        return items.filter(Boolean).map(item => {
            if (typeof item === 'string') return { url: item };
            return {
                url: item.url,
                base64: item.base64
            };
        });
    }, [media]);

    const currentItem = normalizedMedia[currentIndex];
    const mediaSrc = currentItem?.url || currentItem?.base64 || '';
    
    const isVideo = React.useMemo(() => {
        if (type === 'video') return true;
        if (type === 'image') return false;
        return detectMediaTypeFromUrl(mediaSrc) === 'video';
    }, [type, mediaSrc]);

    const goToPrevious = useCallback(() => {
        setCurrentIndex((prev) => (prev > 0 ? prev - 1 : normalizedMedia.length - 1));
    }, [normalizedMedia.length]);

    const goToNext = useCallback(() => {
        setCurrentIndex((prev) => (prev < normalizedMedia.length - 1 ? prev + 1 : 0));
    }, [normalizedMedia.length]);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowLeft') goToPrevious();
            if (e.key === 'ArrowRight') goToNext();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose, goToPrevious, goToNext]);

    const triggerBlobDownload = useCallback((blob: Blob, filename: string) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }, []);

    const handleVideoDownload = useCallback(async () => {
        // Derive extension from the URL so .mov/.webm files don't get a wrong .mp4 suffix.
        const match = mediaSrc.match(/\.([a-z0-9]{2,5})(?:\?|#|$)/i);
        const ext = match ? match[1].toLowerCase() : 'mp4';
        try {
            const response = await fetch(mediaSrc);
            const blob = await response.blob();
            triggerBlobDownload(blob, `output_${currentIndex + 1}.${ext}`);
        } catch {
            window.open(mediaSrc, '_blank');
        }
    }, [mediaSrc, currentIndex, triggerBlobDownload]);

    const handleImageDownload = useCallback(async (format: DownloadFormat) => {
        const filename = `output_${currentIndex + 1}.${extensionForFormat(format)}`;
        try {
            if (urlMatchesFormat(mediaSrc, format)) {
                const response = await fetch(mediaSrc);
                if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
                triggerBlobDownload(await response.blob(), filename);
                return;
            }
            const blob = await convertImageFormat(mediaSrc, format);
            triggerBlobDownload(blob, filename);
        } catch (err) {
            console.error('Image download failed:', err);
            window.open(mediaSrc, '_blank');
        }
    }, [mediaSrc, currentIndex, triggerBlobDownload]);

    const handleDownload = useCallback(() => {
        if (isVideo) {
            void handleVideoDownload();
        } else {
            void handleImageDownload(downloadFormat);
        }
    }, [isVideo, handleVideoDownload, handleImageDownload, downloadFormat]);

    const handleFormatChoice = useCallback((fmt: DownloadFormat) => {
        persistFormat(fmt);
        setFormatMenuOpen(false);
        void handleImageDownload(fmt);
    }, [persistFormat, handleImageDownload]);

    const lightbox = (
        <div
            className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center placeholder-media-lightbox"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onClose(); }}
        >
            {!media || media.length === 0 ? (
                <div className="text-white opacity-50 font-black uppercase tracking-widest text-[10px]">No Media Loaded</div>
            ) : (
                <>
                    {/* Close button */}
            <button
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
                <X className="w-6 h-6" />
            </button>

            {/* Download control — split button for images, single button for videos */}
            {isVideo ? (
                <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                    className="absolute top-4 right-16 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                    title="Download video"
                >
                    <Download className="w-6 h-6" />
                </button>
            ) : (
                <div
                    ref={formatMenuRef}
                    className="absolute top-4 right-16 flex items-center"
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-l-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                        title={`Download as ${downloadFormat.toUpperCase()}`}
                    >
                        <Download className="w-5 h-5" />
                        <span className="text-xs font-medium uppercase">{downloadFormat}</span>
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); setFormatMenuOpen(o => !o); }}
                        className="px-2 py-2 rounded-r-full bg-white/10 hover:bg-white/20 text-white transition-colors border-l border-white/10"
                        title="Choose download format"
                        aria-expanded={formatMenuOpen}
                        aria-haspopup="menu"
                    >
                        <ChevronDown className="w-4 h-4" />
                    </button>
                    {formatMenuOpen && (
                        <div
                            role="menu"
                            className="absolute top-full right-0 mt-2 w-32 rounded-lg bg-black/90 backdrop-blur border border-white/10 shadow-2xl overflow-hidden"
                        >
                            {(['png', 'jpeg', 'webp'] as const).map(fmt => (
                                <button
                                    key={fmt}
                                    role="menuitem"
                                    onClick={(e) => { e.stopPropagation(); handleFormatChoice(fmt); }}
                                    className={`w-full text-left px-3 py-2 text-sm uppercase tracking-wide transition-colors ${
                                        fmt === downloadFormat ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10'
                                    }`}
                                >
                                    {fmt}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Counter */}
            <div className="absolute top-4 left-4 px-3 py-1 rounded-full bg-white/10 text-white text-sm">
                {currentIndex + 1} / {normalizedMedia.length}
            </div>

            {/* Previous button */}
            {normalizedMedia.length > 1 && (
                <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); goToPrevious(); }}
                    className="absolute left-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                >
                    <ChevronLeft className="w-8 h-8" />
                </button>
            )}

            {/* Image / Video */}
            {isVideo ? (
                <video
                    src={mediaSrc}
                    controls
                    autoPlay
                    className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                />
            ) : (
                <img
                    src={mediaSrc}
                    alt={`Media ${currentIndex + 1}`}
                    className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                />
            )}

            {/* Next button */}
            {normalizedMedia.length > 1 && (
                <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); goToNext(); }}
                    className="absolute right-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                >
                    <ChevronRight className="w-8 h-8" />
                </button>
            )}

            {/* Thumbnail strip at bottom */}
            {normalizedMedia.length > 1 && (
                <div 
                    className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 p-2 bg-black/50 rounded-lg max-w-[80vw] overflow-x-auto"
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    {normalizedMedia.map((item, idx) => {
                        const thumbSrc = item.url || item.base64;
                        const isThumbVideo = type === 'video';

                        return (
                            <button
                                key={idx}
                                onClick={(e) => { e.stopPropagation(); setCurrentIndex(idx); }}
                                className={`flex-shrink-0 w-12 h-12 rounded overflow-hidden border-2 transition-all ${idx === currentIndex
                                    ? 'border-white scale-110'
                                    : 'border-transparent opacity-60 hover:opacity-100'
                                    }`}
                            >
                                {((type === 'any' && detectMediaTypeFromUrl(thumbSrc) === 'video') || type === 'video') ? (
                                    <video src={thumbSrc} className="w-full h-full object-cover" />
                                ) : (
                                    <img
                                        src={thumbSrc}
                                        alt={`Thumbnail ${idx + 1}`}
                                        className="w-full h-full object-cover"
                                    />
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </>
        )}
        </div>
    );

    if (!mounted) return null;
    return createPortal(lightbox, document.body);
}
