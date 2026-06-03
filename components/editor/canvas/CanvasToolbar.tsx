'use client';

import React from 'react';
import { Panel, useReactFlow, useStore, ReactFlowState } from 'reactflow';
import { Undo2, Redo2, Network, Hand, Maximize2, Minus, Plus } from 'lucide-react';
import { Tooltip } from '@/components/ui/Tooltip';

interface CanvasToolbarProps {
    undo: (() => void) | undefined;
    redo: (() => void) | undefined;
    canUndo: boolean | undefined;
    canRedo: boolean | undefined;
    onAutoLayout: () => void;
    isPanMode: boolean;
    onTogglePanMode: (active: boolean) => void;
    isNodesEmpty: boolean;
    /** View-only mode: hide edit controls (undo/redo, auto-layout) — but the
        pan (hand) tool stays available since panning is harmless, leaving
        hand + fit + zoom. */
    readOnly?: boolean;
}

export function CanvasToolbar({
    undo,
    redo,
    canUndo,
    canRedo,
    onAutoLayout,
    isPanMode,
    onTogglePanMode,
    isNodesEmpty,
    readOnly = false,
}: CanvasToolbarProps) {
    const { zoomIn, zoomOut, fitView } = useReactFlow();

    return (
        <Panel position="bottom-center" className="!mb-4">
            <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-surface-elevated/90 backdrop-blur-md border border-stroke-subtle shadow-xl">
                {!readOnly && (
                    <>
                        <ToolbarButton
                            icon={Undo2}
                            onClick={() => undo?.()}
                            disabled={!canUndo}
                            title="Undo (Ctrl+Z)"
                        />
                        <ToolbarButton
                            icon={Redo2}
                            onClick={() => redo?.()}
                            disabled={!canRedo}
                            title="Redo (Ctrl+Y)"
                        />
                        <ToolbarDivider />

                        <ToolbarButton
                            icon={Network}
                            onClick={onAutoLayout}
                            disabled={isNodesEmpty}
                            title="Auto Layout"
                        />
                    </>
                )}
                {/* Pan (hand) tool stays available even in view-only — panning
                    the canvas is harmless and useful for navigation. */}
                <ToolbarButton
                    icon={Hand}
                    onClick={() => onTogglePanMode(!isPanMode)}
                    active={isPanMode}
                    title={isPanMode ? 'Exit Pan Mode' : 'Pan Mode'}
                />
                <ToolbarButton
                    icon={Maximize2}
                    onClick={() => fitView({ duration: 800, padding: 0.3 })}
                    title="Fit View"
                />
                <ToolbarDivider />

                <ToolbarButton
                    icon={Minus}
                    onClick={() => zoomOut({ duration: 400 })}
                    title="Zoom Out"
                />
                <ZoomDisplay />
                <ToolbarButton
                    icon={Plus}
                    onClick={() => zoomIn({ duration: 400 })}
                    title="Zoom In"
                />
            </div>
        </Panel>
    );
}

// Internal components
export function ToolbarButton({ 
    icon: Icon, 
    onClick, 
    disabled, 
    active, 
    title 
}: { 
    icon: any; 
    onClick: () => void; 
    disabled?: boolean; 
    active?: boolean; 
    title?: string; 
}) {
    const button = (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`
                w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200
                ${disabled
                    ? 'opacity-40 cursor-not-allowed text-content-tertiary'
                    : active
                        ? 'bg-accent-primary text-content-inverted'
                        : 'text-content-primary hover:bg-surface-tertiary hover:text-accent-primary'
                }
            `}
        >
            <Icon className="w-4 h-4" />
        </button>
    );

    if (title && !disabled) {
        return (
            <Tooltip content={title} position="top">
                {button}
            </Tooltip>
        );
    }

    return button;
}

export function ToolbarDivider() {
    return <div className="w-px h-5 bg-stroke-subtle mx-1" />;
}

function ZoomDisplay() {
    // 🚀 PERFORMANCE FIX: Use useStore(selector) for real-time transform updates.
    // useViewport() was occasionally returning undefined during transitions,
    // causing the UI to flicker back to its fallback "80%" value.
    const zoom = useStore((s: ReactFlowState) => s.transform[2]);
    
    return (
        <span className="px-2 text-xs font-medium text-content-secondary min-w-[40px] text-center tabular-nums">
            {Math.round((zoom || 0.8) * 100)}%
        </span>
    );
}

