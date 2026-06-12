'use client';

import React from 'react';
import { X, Download, UserPlus, Trash2, Loader2 } from 'lucide-react';

interface AssetSelectionToolbarProps {
    count: number;
    imageCount: number;
    downloading: boolean;
    adding: boolean;
    deleting: boolean;
    error?: string | null;
    onClear: () => void;
    onDownload: () => void;
    onAddToCharacter: () => void;
    onDelete: () => void;
}

/**
 * Inline bulk-action controls for the Assets gallery. Rendered by AssetsGallery
 * directly beside the results count (no background bar of its own, so it never
 * shifts the grid). Holds no selection state itself.
 */
export default function AssetSelectionToolbar({
    count,
    imageCount,
    downloading,
    adding,
    deleting,
    error,
    onClear,
    onDownload,
    onAddToCharacter,
    onDelete,
}: AssetSelectionToolbarProps) {
    const busy = downloading || adding || deleting;
    return (
        <div className="flex items-center gap-2 pl-3 ml-1 border-l border-stroke-subtle">
            <span className="text-sm font-medium text-content-primary whitespace-nowrap">{count} selected</span>

            <button
                onClick={onClear}
                className="p-1 rounded-md hover:bg-interactive-hover transition-colors"
                title="Clear selection"
                aria-label="Clear selection"
            >
                <X className="w-3.5 h-3.5 text-content-secondary" />
            </button>

            {error && <span className="text-xs text-red-400 whitespace-nowrap">{error}</span>}

            <button
                onClick={onDownload}
                disabled={busy}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-tertiary border border-stroke-subtle text-content-primary text-xs font-medium hover:bg-interactive-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
                {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                <span>Download zip</span>
            </button>

            <button
                onClick={onAddToCharacter}
                disabled={busy || imageCount === 0}
                title={imageCount === 0 ? 'Select at least one image' : imageCount > 6 ? 'Only the first 6 images will be used' : undefined}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-accent-primary/10 border border-accent-primary/20 text-accent-primary text-xs font-medium hover:bg-accent-primary/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
                {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                <span>Add to character</span>
            </button>

            <button
                onClick={onDelete}
                disabled={busy}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-accent-error/10 border border-accent-error/20 text-accent-error text-xs font-medium hover:bg-accent-error/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>Delete</span>
            </button>
        </div>
    );
}
