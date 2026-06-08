'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { X, Download, UserPlus, Loader2 } from 'lucide-react';

interface AssetSelectionToolbarProps {
    count: number;
    imageCount: number;
    downloading: boolean;
    adding: boolean;
    error?: string | null;
    onClear: () => void;
    onDownload: () => void;
    onAddToCharacter: () => void;
}

/**
 * Presentational bulk-action bar for the Assets gallery. Rendered by
 * AssetsGallery only when a selection exists; holds no selection state itself.
 */
export default function AssetSelectionToolbar({
    count,
    imageCount,
    downloading,
    adding,
    error,
    onClear,
    onDownload,
    onAddToCharacter,
}: AssetSelectionToolbarProps) {
    const busy = downloading || adding;
    return (
        <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="sticky top-2 z-30 flex items-center gap-3 px-4 py-2.5 rounded-xl border border-stroke-subtle bg-surface-elevated shadow-lg"
        >
            <button
                onClick={onClear}
                className="p-1.5 rounded-lg hover:bg-interactive-hover transition-colors"
                title="Clear selection"
                aria-label="Clear selection"
            >
                <X className="w-4 h-4 text-content-secondary" />
            </button>

            <span className="text-sm font-medium text-content-primary">{count} selected</span>

            <div className="flex-1" />

            {error && <span className="text-xs text-red-400">{error}</span>}

            <button
                onClick={onDownload}
                disabled={busy}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-tertiary border border-stroke-subtle text-content-primary text-sm font-medium hover:bg-interactive-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span>Download zip</span>
            </button>

            <button
                onClick={onAddToCharacter}
                disabled={busy || imageCount === 0}
                title={imageCount === 0 ? 'Select at least one image' : imageCount > 6 ? 'Only the first 6 images will be used' : undefined}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-primary/10 border border-accent-primary/20 text-accent-primary text-sm font-medium hover:bg-accent-primary/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                <span>Add to character</span>
            </button>
        </motion.div>
    );
}
