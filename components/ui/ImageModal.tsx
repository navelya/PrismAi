'use client';

import React, { useState } from 'react';
import { X, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { Modal } from './Modal';
import { downloadUrlAsFile } from '@/lib/workflow/download-output';

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
        setIsDownloading(true);
        try {
            await downloadUrlAsFile(imageUrl, 'prism-image');
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <Modal
            open={isOpen}
            onOpenChange={(open) => !open && onClose()}
            size="full"
            contentClassName="max-w-7xl max-h-[90vh] p-6"
            showClose={false}
            srTitle="Image preview"
        >
            {/* Previous Arrow */}
            {canGoPrevious && onPrevious && (
                <button
                    onClick={(e) => { e.stopPropagation(); onPrevious(); }}
                    className="absolute left-2 top-1/2 -translate-y-1/2 z-20 p-3 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-full transition-all duration-200 group border border-white/20 hover:border-white/40"
                    aria-label="Previous image"
                >
                    <ChevronLeft className="w-8 h-8 text-white group-hover:scale-110 transition-transform" />
                </button>
            )}

            {/* Next Arrow */}
            {canGoNext && onNext && (
                <button
                    onClick={(e) => { e.stopPropagation(); onNext(); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 z-20 p-3 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-full transition-all duration-200 group border border-white/20 hover:border-white/40"
                    aria-label="Next image"
                >
                    <ChevronRight className="w-8 h-8 text-white group-hover:scale-110 transition-transform" />
                </button>
            )}

            {/* Close button (dark treatment to read over imagery) */}
            <button
                onClick={onClose}
                className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors z-10"
                aria-label="Close"
            >
                <X className="w-5 h-5 text-white" />
            </button>

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
                    {isDownloading ? 'Downloading...' : 'Download'}
                </button>

                {(canGoPrevious || canGoNext) && (
                    <p className="text-xs text-content-tertiary">
                        Use <kbd className="px-1.5 py-0.5 bg-surface-tertiary rounded border border-stroke-subtle text-content-secondary font-mono text-[10px]">←</kbd> <kbd className="px-1.5 py-0.5 bg-surface-tertiary rounded border border-stroke-subtle text-content-secondary font-mono text-[10px]">→</kbd> to navigate
                    </p>
                )}
            </div>
        </Modal>
    );
}
