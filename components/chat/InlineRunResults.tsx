'use client';

import { useMemo } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { collectTerminalRunMedia } from '@/lib/workflow/run-media';
import { RunMediaGallery, type GalleryCell } from './RunMediaGallery';

interface InlineRunResultsProps {
    terminalIds: string[];
    isCanvasMode?: boolean;
    /** Expected media count for this run (Σ terminal iterations). Sets how many
     *  skeleton tiles the grid shows up front; falls back to the terminal count. */
    expectedResultCount?: number;
}

export function InlineRunResults({ terminalIds, isCanvasMode, expectedResultCount }: InlineRunResultsProps) {
    const nodeOutputs = useAppStore((s) => s.nodeOutputs);
    const nodeStatuses = useAppStore((s) => s.nodeStatuses);
    const partials = useAppStore((s) => s.partialIterationResults);
    const activeExecutionId = useAppStore((s) => s.activeExecutionId);

    // Assemble ordered cells across terminals. A finalized ('success') terminal
    // contributes its canonical media; a still-running terminal contributes its
    // streamed per-iteration outcomes (completion order) — successes as media,
    // failures as error tiles. Partials are only trusted for the active run so a
    // stale prior run's leftovers never show.
    const cells = useMemo(() => {
        // Non-reactive read: the workflow node carries the full per-run output
        // collection for ai_generator terminals (nodeOutputs is narrowed to one).
        // Recompute is already driven by nodeOutputs/nodeStatuses changing.
        const workflow = useAppStore.getState().currentWorkflow;
        const out: GalleryCell[] = [];
        for (const id of terminalIds) {
            if (nodeStatuses?.[id] === 'success') {
                const node = workflow?.nodes.find((n) => n.id === id);
                for (const m of collectTerminalRunMedia(node, nodeOutputs?.[id], activeExecutionId ?? undefined)) {
                    out.push({ kind: 'media', item: m });
                }
                continue;
            }
            const entry = partials?.[id];
            if (entry && (!activeExecutionId || entry.executionId === activeExecutionId)) {
                for (const it of entry.items) {
                    if (it.status === 'failed') {
                        out.push({ kind: 'error' });
                    } else {
                        for (const m of it.media) out.push({ kind: 'media', item: m });
                    }
                }
            }
        }
        return out;
    }, [terminalIds, nodeOutputs, nodeStatuses, partials, activeExecutionId]);

    const skeletonCount = Math.max(1, expectedResultCount ?? terminalIds.length);
    return (
        <div className="mt-2">
            <RunMediaGallery
                cells={cells}
                isCanvasMode={isCanvasMode}
                skeletonCount={skeletonCount}
            />
        </div>
    );
}
