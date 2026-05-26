'use client';

import { useMemo } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { toLegacyRenderableOutput } from '@/lib/workflow/result-format';
import MessageRenderer from './MessageRenderer';

interface InlineRunResultsProps {
    terminalIds: string[];
    isCanvasMode?: boolean;
}

export function InlineRunResults({ terminalIds, isCanvasMode }: InlineRunResultsProps) {
    const nodeOutputs = useAppStore((s) => s.nodeOutputs);

    // Collect renderable output across all terminal nodes.
    // toLegacyRenderableOutput returns:
    //   - Array<{url,...}>  for media envelopes  → merge into flat image list
    //   - string            for text envelopes   → use first non-empty string found
    //   - other             for json/unknown     → skip (no meaningful inline display)
    const items = useMemo(() => {
        const images: any[] = [];
        let text: string | null = null;

        for (const id of terminalIds) {
            const legacy = toLegacyRenderableOutput(nodeOutputs?.[id]);
            if (Array.isArray(legacy)) {
                for (const item of legacy) {
                    if (item?.url) images.push(item);
                }
            } else if (typeof legacy === 'string' && legacy.length > 0 && text === null) {
                text = legacy;
            }
        }

        // Prefer images when both are present; MessageRenderer handles both shapes.
        if (images.length > 0) return images;
        if (text !== null) return text;
        return null;
    }, [terminalIds, nodeOutputs]);

    if (items === null) return null;

    return (
        <div className="mt-2">
            {/* forceGallery: chat-run results are shown inline in the chat even in
                canvas/minimized mode, not as the compact "added to Canvas" tag. */}
            <MessageRenderer data={items} isCanvasMode={isCanvasMode} forceGallery />
        </div>
    );
}
