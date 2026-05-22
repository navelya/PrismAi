'use client';

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '@/lib/store/app-store';
import { expandSelectionForChat } from '@/lib/utils/selection-refs';

/**
 * Live preview of the canvas node-selection, shown as a horizontally-scrollable
 * pill row above the chat textarea.
 *
 * This is a deliberately ISOLATED leaf that subscribes to the selection state
 * directly. Selecting nodes on the canvas mutates `currentSelectedNodeIds` on
 * every node entering a marquee; if that subscription lived in ChatInterface
 * (which owns the un-memoized MessageList), the entire conversation re-rendered
 * on every selection tick — unusably laggy on any real graph. Keeping the
 * subscription here means a selection change re-renders ONLY this row.
 */
export function SelectionPillRow() {
    const selectedNodeIds = useAppStore((s) => s.currentSelectedNodeIds);
    const clearCanvasSelection = useAppStore((s) => s.clearCanvasSelection);

    // Recompute only when the selected-id SET changes. Read the workflow lazily
    // via getState() rather than subscribing to it — the store rebuilds
    // currentWorkflow into a new object on every `select` change, so subscribing
    // would re-introduce the per-tick churn. Label freshness for the actual
    // message is handled at send-time (use-chat-messages re-snapshots refs).
    const selectedNodeRefs = React.useMemo(
        // eslint-disable-next-line react-hooks/exhaustive-deps
        () => expandSelectionForChat(selectedNodeIds, useAppStore.getState().currentWorkflow),
        [selectedNodeIds],
    );

    const selectionRowRef = useRef<HTMLDivElement>(null);

    // Translate a vertical mouse wheel into horizontal scroll while hovering the
    // selection-pill row, so users can reach pills that overflow the single
    // line. React attaches `wheel` as a passive listener, so we add a native
    // non-passive one to be able to preventDefault. Re-runs when the row
    // mounts/unmounts (gated on whether any pills are present).
    useEffect(() => {
        const el = selectionRowRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            if (e.deltaY === 0) return;
            if (el.scrollWidth <= el.clientWidth) return; // nothing to scroll
            e.preventDefault();
            el.scrollLeft += e.deltaY;
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [selectedNodeRefs.length]);

    if (selectedNodeRefs.length === 0) return null;

    return (
        <div
            ref={selectionRowRef}
            className="flex items-center gap-1.5 px-3 pt-2.5 pb-0.5 overflow-x-auto [&::-webkit-scrollbar]:hidden"
        >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-content-tertiary shrink-0">
                Editing
            </span>
            {selectedNodeRefs.slice(0, 5).map((nodeRef) => (
                <span
                    key={nodeRef.id}
                    className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md
                               bg-accent-primary/10 border border-accent-primary/20
                               text-[11px] text-content-secondary max-w-[140px]"
                    title={nodeRef.label}
                >
                    <span className="truncate">{nodeRef.label}</span>
                </span>
            ))}
            {selectedNodeRefs.length > 5 && (
                <span className="shrink-0 text-[11px] text-content-tertiary">
                    … +{selectedNodeRefs.length - 5} more
                </span>
            )}
            <button
                type="button"
                onClick={clearCanvasSelection}
                aria-label="Clear node selection"
                className="shrink-0 ml-auto p-1 rounded-md text-content-tertiary
                           hover:text-content-primary hover:bg-surface-tertiary transition-colors"
            >
                <X className="w-3.5 h-3.5" />
            </button>
        </div>
    );
}
