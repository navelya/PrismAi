'use client';

import { useCallback, useMemo, useState } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { coerceResultDataArray, extractMediaUrls, isOutputEnvelope } from '@/lib/workflow/result-format';
import { collectNodeMediaBlobs, triggerBlobDownload } from '@/lib/workflow/download-output';

/** Does this envelope carry a live `graph` item (renderable via the export route)? */
function hasGraphItem(output: any): boolean {
    if (!isOutputEnvelope(output)) return false;
    return coerceResultDataArray(output.data).some(
        (item: any) => item && typeof item === 'object' && (item as any).graph,
    );
}

export type CardDownloadState = 'idle' | 'rendering' | 'success' | 'error';

/**
 * Card-level Download support for any node whose output is a URL-bearing
 * envelope (image / video / audio). Compositor's download is bespoke
 * because it needs a server-side ffmpeg render; everything else (AI
 * Generator, Blur image, Levels) just needs to fetch the URLs the
 * envelope already carries and save them.
 *
 * The hook publishes progress to `bulkDownloads` in the store so the
 * EditorToolbar's top-of-screen pill appears during the fetch — same
 * indicator the bulk multi-select download produces.
 *
 * `canDownload` is `false` for envelopes with no concrete URLs (e.g. a
 * live `GraphDescription` from a chained node before its workflow has
 * been Run); callers should hide or disable the download button when
 * this is false rather than show a button that silently no-ops.
 */
export function useCardDownload(label: string, output: any): {
    state: CardDownloadState;
    canDownload: boolean;
    handleDownload: () => Promise<void>;
} {
    const [state, setState] = useState<CardDownloadState>('idle');
    const setBulkDownloadProgress = useAppStore((s) => s.setBulkDownloadProgress);
    const clearBulkDownload = useAppStore((s) => s.clearBulkDownload);

    const urls = useMemo(() => extractMediaUrls(output), [output]);
    // A live `graph` item renders to mp4 via the export route (blur and
    // future filter nodes over a compositor), so it's downloadable even
    // though it carries no concrete URL yet.
    const hasGraph = useMemo(() => hasGraphItem(output), [output]);
    const canDownload = urls.length > 0 || hasGraph;

    const handleDownload = useCallback(async () => {
        if (!canDownload) return;

        const opId =
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `dl-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        // total = N media units + 1 for the save step. A graph item counts
        // as one render unit. Each unit ticks the pill via the onUnit cb.
        const total = (urls.length || (hasGraph ? 1 : 0)) + 1;
        let current = 0;
        setBulkDownloadProgress(opId, { current, total });
        setState('rendering');

        try {
            const items = await collectNodeMediaBlobs(output, label, () => {
                current += 1;
                setBulkDownloadProgress(opId, { current, total });
            });
            if (items.length === 0) {
                throw new Error('No media to download');
            }
            for (const item of items) {
                triggerBlobDownload(item.blob, item.filename);
            }
            current += 1;
            setBulkDownloadProgress(opId, { current, total });
            setState('success');
            setTimeout(() => setState((s) => (s === 'success' ? 'idle' : s)), 1500);
        } catch (err) {
            console.error('[useCardDownload] failed', err);
            setState('error');
            setTimeout(() => setState((s) => (s === 'error' ? 'idle' : s)), 2500);
        } finally {
            setTimeout(() => clearBulkDownload(opId), 600);
        }
    }, [canDownload, urls.length, hasGraph, output, label, setBulkDownloadProgress, clearBulkDownload]);

    return { state, canDownload, handleDownload };
}
