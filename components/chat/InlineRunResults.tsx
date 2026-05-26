'use client';

import { useMemo } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { extractRenderableMedia } from '@/lib/workflow/result-format';
import { RunMediaGallery } from './RunMediaGallery';

interface InlineRunResultsProps {
    terminalIds: string[];
    isCanvasMode?: boolean;
}

export function InlineRunResults({ terminalIds, isCanvasMode }: InlineRunResultsProps) {
    const nodeOutputs = useAppStore((s) => s.nodeOutputs);
    const nodeStatuses = useAppStore((s) => s.nodeStatuses);

    // Collect renderable media (image + video) across all terminal nodes, with
    // type preserved. Text outputs (e.g. a prompt node's string) are ignored so
    // the raw prompt never surfaces as a chat result.
    //
    // CRITICAL: only read a terminal's output once THIS run has marked it
    // 'success'. nodeOutputs still holds the PREVIOUS run's result until the new
    // one lands, so without this gate an update would show the stale old image
    // (then swap) instead of a skeleton while it regenerates.
    const items = useMemo(() => {
        const media: ReturnType<typeof extractRenderableMedia> = [];
        for (const id of terminalIds) {
            if (nodeStatuses?.[id] !== 'success') continue;
            for (const m of extractRenderableMedia(nodeOutputs?.[id])) {
                if (m.type === 'image' || m.type === 'video') media.push(m);
            }
        }
        return media;
    }, [terminalIds, nodeOutputs, nodeStatuses]);

    // This component only mounts while the run is in flight (Message.tsx gates
    // on runProposal.status === 'running'). RunMediaGallery shows skeleton tiles
    // until media arrives AND has actually loaded — no broken-image flash.
    return (
        <div className="mt-2">
            <RunMediaGallery
                items={items}
                isCanvasMode={isCanvasMode}
                skeletonCount={Math.min(2, Math.max(1, terminalIds.length))}
            />
        </div>
    );
}
