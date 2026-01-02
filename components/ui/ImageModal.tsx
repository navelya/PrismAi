'use client';

import { useState } from 'react';
import { X, Download } from 'lucide-react';

interface ImageModalProps {
    imageUrl: string;
    isOpen: boolean;
    onClose: () => void;
    imageIndex?: number;
    totalImages?: number;
}

export function ImageModal({
    imageUrl,
    isOpen,
    onClose,
    imageIndex,
    totalImages
}: ImageModalProps) {
    const [isDownloading, setIsDownloading] = useState(false);

    if (!isOpen) return null;

    const handleDownload = async () => {
        try {
            setIsDownloading(true);

            // Convert base64 or URL to blob
            const response = await fetch(imageUrl);
            const blob = await response.blob();

            // Create download link
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `prism-image-${Date.now()}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);

            console.log('✅ Image downloaded successfully');
        } catch (error) {
            console.error('❌ Download failed:', error);
        } finally {
            setIsDownloading(false);
        }
    };

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={handleBackdropClick}
        >
            <div className="relative max-w-7xl max-h-[90vh] p-6 bg-gray-900 rounded-2xl shadow-2xl border border-gray-700">
                {/* Close button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 bg-gray-800 rounded-full hover:bg-gray-700 transition-colors z-10"
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

                {/* Download button */}
                <div className="flex justify-center">
                    <button
                        onClick={handleDownload}
                        disabled={isDownloading}
                        className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-medium rounded-lg transition-colors shadow-lg"
                    >
                        <Download className="w-5 h-5" />
                        {isDownloading ? 'Downloading...' : 'Download PNG'}
                    </button>
                </div>
            </div>
        </div>
    );
}
