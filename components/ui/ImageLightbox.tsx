'use client';

import React, { useEffect, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react';


interface ImageLightboxProps {
    images: { url?: string; base64?: string }[];
    initialIndex: number;
    onClose: () => void;
}

export default function ImageLightbox({ images, initialIndex, onClose }: ImageLightboxProps) {
    const [currentIndex, setCurrentIndex] = React.useState(initialIndex);
    // Portal mount guard — prevents SSR mismatch
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    const currentImage = images[currentIndex];
    const imageSrc = currentImage?.url || currentImage?.base64 || '';

    const goToPrevious = useCallback(() => {
        setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
    }, [images.length]);

    const goToNext = useCallback(() => {
        setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
    }, [images.length]);

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
            const response = await fetch(imageSrc);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `image_${currentIndex + 1}.${blob.type.includes('png') ? 'png' : 'jpg'}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            // Fallback: open in new tab
            window.open(imageSrc, '_blank');
        }
    };

    const lightbox = (
        <div
            className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center"
            onClick={onClose}
        >
            {/* Close button */}
            <button
                onClick={onClose}
                className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
                <X className="w-6 h-6" />
            </button>

            {/* Download button */}
            <button
                onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                className="absolute top-4 right-16 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                title="Download image"
            >
                <Download className="w-6 h-6" />
            </button>

            {/* Counter */}
            <div className="absolute top-4 left-4 px-3 py-1 rounded-full bg-white/10 text-white text-sm">
                {currentIndex + 1} / {images.length}
            </div>

            {/* Previous button */}
            {images.length > 1 && (
                <button
                    onClick={(e) => { e.stopPropagation(); goToPrevious(); }}
                    className="absolute left-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                >
                    <ChevronLeft className="w-8 h-8" />
                </button>
            )}

            {/* Image */}
            <img
                src={imageSrc}
                alt={`Image ${currentIndex + 1}`}
                className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            />

            {/* Next button */}
            {images.length > 1 && (
                <button
                    onClick={(e) => { e.stopPropagation(); goToNext(); }}
                    className="absolute right-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                >
                    <ChevronRight className="w-8 h-8" />
                </button>
            )}

            {/* Thumbnail strip at bottom */}
            {images.length > 1 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 p-2 bg-black/50 rounded-lg max-w-[80vw] overflow-x-auto">
                    {images.map((img, idx) => (
                        <button
                            key={idx}
                            onClick={(e) => { e.stopPropagation(); setCurrentIndex(idx); }}
                            className={`flex-shrink-0 w-12 h-12 rounded overflow-hidden border-2 transition-all ${idx === currentIndex
                                ? 'border-white scale-110'
                                : 'border-transparent opacity-60 hover:opacity-100'
                                }`}
                        >
                            <img
                                src={img.url || img.base64}
                                alt={`Thumbnail ${idx + 1}`}
                                className="w-full h-full object-cover"
                            />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );

    if (!mounted) return null;
    return createPortal(lightbox, document.body);
}
