'use client';

import React, { useEffect, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { detectMediaTypeFromUrl } from '@/lib/workflow/result-format';


interface ImageLightboxProps {
    media: any; // Can be an array of objects/strings or a single object/string
    type: 'image' | 'video' | 'any';
    initialIndex: number;
    onClose: () => void;
    /**
     * Optional CSS filter applied to the rendered media (e.g. `"blur(8px)"`
     * for a Blur node's lightbox view). Pixel values inside `blur(...)` are
     * interpreted in NATIVE-source-resolution units — they get scaled here
     * by `displayWidth / nativeMediaWidth` so the lightbox visual matches
     * the card preview and the eventual server render. Other filter
     * functions (saturate, contrast, etc.) pass through unscaled.
     */
    cssFilter?: string | null;
    /**
     * Natural pixel width of the rendered source. Used together with
     * `cssFilter` to scale `blur(Npx)` values by the lightbox's display
     * ratio. When omitted, `cssFilter` is applied as-is.
     */
    nativeMediaWidth?: number;
}

export default function ImageLightbox({ media, type, initialIndex, onClose, cssFilter, nativeMediaWidth }: ImageLightboxProps) {
    const [currentIndex, setCurrentIndex] = React.useState(initialIndex);
    // Portal mount guard — prevents SSR mismatch
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

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

    // Scale any blur(Npx) inside cssFilter by displayWidth / nativeMediaWidth
    // so the lightbox visual matches the card preview and the server render.
    // The displayed width changes when the media element loads (since size
    // is determined by `object-contain` + max-w/h constraints); read it on
    // load via the element ref and recompute the filter then.
    const mediaElRef = React.useRef<HTMLImageElement | HTMLVideoElement | null>(null);
    const [mediaDisplayWidth, setMediaDisplayWidth] = useState(0);
    const handleMediaLoaded = useCallback(() => {
        const el = mediaElRef.current;
        if (!el) return;
        setMediaDisplayWidth((el as any).clientWidth || 0);
    }, []);
    const scaledFilter = React.useMemo(() => {
        if (!cssFilter) return undefined;
        if (!nativeMediaWidth || !mediaDisplayWidth) return cssFilter;
        const ratio = mediaDisplayWidth / nativeMediaWidth;
        return cssFilter.replace(/blur\(([\d.]+)px\)/g, (_, n) => `blur(${parseFloat(n) * ratio}px)`);
    }, [cssFilter, mediaDisplayWidth, nativeMediaWidth]);

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

    // Download handler
    const handleDownload = async () => {
        try {
            const response = await fetch(mediaSrc);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const extension = isVideo ? 'mp4' : (blob.type.includes('png') ? 'png' : 'jpg');
            a.download = `output_${currentIndex + 1}.${extension}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            // Fallback: open in new tab
            window.open(mediaSrc, '_blank');
        }
    };

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

            {/* Download button */}
            <button
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                className="absolute top-4 right-16 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                title="Download image"
            >
                <Download className="w-6 h-6" />
            </button>

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
                    ref={(el) => { mediaElRef.current = el; }}
                    src={mediaSrc}
                    controls
                    autoPlay
                    onLoadedMetadata={handleMediaLoaded}
                    className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
                    style={scaledFilter ? { filter: scaledFilter } : undefined}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                />
            ) : (
                <img
                    ref={(el) => { mediaElRef.current = el; }}
                    src={mediaSrc}
                    alt={`Media ${currentIndex + 1}`}
                    onLoad={handleMediaLoaded}
                    className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
                    style={scaledFilter ? { filter: scaledFilter } : undefined}
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
