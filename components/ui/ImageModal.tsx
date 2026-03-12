'use client';

import React, { useState, useCallback } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { X, Download, ChevronLeft, ChevronRight } from 'lucide-react';

interface ImageModalProps {
    imageUrl: string;
    isOpen: boolean;
    onClose: () => void;
    imageIndex?: number;
    totalImages?: number;
    onPrevious?: () => void;
    onNext?: () => void;
}

export function ImageModal({
    imageUrl,
    isOpen,
    onClose,
    imageIndex,
    totalImages,
    onPrevious,
    onNext,
}: ImageModalProps) {
    const [isDownloading, setIsDownloading] = useState(false);

    const canGoPrevious = imageIndex !== undefined && imageIndex > 0;
    const canGoNext = imageIndex !== undefined && totalImages !== undefined && imageIndex < totalImages - 1;

    const handleDownload = async () => {
        try {
            setIsDownloading(true);
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `prism-image-${Date.now()}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Download failed:', error);
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <RadixDialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <RadixDialog.Portal>
                <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
                <RadixDialog.Content
                    className="fixed inset-0 z-50 flex items-center justify-center data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 outline-none"
                    onPointerDownOutside={onClose}
                >
                    <VisuallyHidden.Root>
                        <RadixDialog.Title>Image Preview</RadixDialog.Title>
                        <RadixDialog.Description>Full size image preview with navigation</RadixDialog.Description>
                    </VisuallyHidden.Root>

                    {/* Previous Arrow */}
                    {canGoPrevious && onPrevious && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onPrevious(); }}
                            className="absolute left-4 md:left-8 z-20 p-3 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-full transition-all duration-200 group border border-white/20 hover:border-white/40"
                            aria-label="Previous image"
                        >
                            <ChevronLeft className="w-8 h-8 text-white group-hover:scale-110 transition-transform" />
                        </button>
                    )}

                    {/* Next Arrow */}
                    {canGoNext && onNext && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onNext(); }}
                            className="absolute right-4 md:right-8 z-20 p-3 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-full transition-all duration-200 group border border-white/20 hover:border-white/40"
                            aria-label="Next image"
                        >
                            <ChevronRight className="w-8 h-8 text-white group-hover:scale-110 transition-transform" />
                        </button>
                    )}

                    <div className="relative max-w-7xl max-h-[90vh] p-6 bg-surface-elevated rounded-2xl shadow-2xl border border-stroke-subtle" onClick={(e) => e.stopPropagation()}>
                        {/* Close button */}
                        <RadixDialog.Close asChild>
                            <button
                                className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors z-10"
                                aria-label="Close"
                            >
                                <X className="w-5 h-5 text-white" />
                            </button>
                        </RadixDialog.Close>

                        {/* Image counter */}
                        {imageIndex !== undefined && totalImages !== undefined && (
                            <div className="absolute top-4 left-4 px-3 py-1 bg-black/60 rounded-full text-white text-sm font-medium z-10">
                                {imageIndex + 1} / {totalImages}
                            </div>
                        )}

                        {/* Image */}
                        <div className="flex items-center justify-center mb-4">
                            <img
                                src={imageUrl}
                                alt="Full size preview"
                                className="max-w-full max-h-[70vh] object-contain rounded-lg"
                            />
                        </div>

                        {/* Download button and keyboard hints */}
                        <div className="flex flex-col items-center gap-2">
                            <button
                                onClick={handleDownload}
                                disabled={isDownloading}
                                className="flex items-center gap-2 px-6 py-3 bg-accent-primary hover:bg-accent-secondary disabled:bg-surface-tertiary text-white font-medium rounded-lg transition-colors shadow-lg"
                            >
                                <Download className="w-5 h-5" />
                                {isDownloading ? 'Downloading...' : 'Download PNG'}
                            </button>

                            {(canGoPrevious || canGoNext) && (
                                <p className="text-xs text-content-tertiary">
                                    Use <kbd className="px-1.5 py-0.5 bg-surface-tertiary rounded border border-stroke-subtle text-content-secondary font-mono text-[10px]">←</kbd> <kbd className="px-1.5 py-0.5 bg-surface-tertiary rounded border border-stroke-subtle text-content-secondary font-mono text-[10px]">→</kbd> to navigate
                                </p>
                            )}
                        </div>
                    </div>
                </RadixDialog.Content>
            </RadixDialog.Portal>
        </RadixDialog.Root>
    );
}
