'use client';

import React from 'react';
import { Panel, useViewport } from 'reactflow';
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
    onFitView: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    isNodesEmpty: boolean;
}

export function CanvasToolbar({
    undo,
    redo,
    canUndo,
    canRedo,
    onAutoLayout,
    isPanMode,
    onTogglePanMode,
    onFitView,
    onZoomIn,
    onZoomOut,
    isNodesEmpty
}: CanvasToolbarProps) {
    return (
        <Panel position="bottom-center" className="!mb-4">
            <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-surface-elevated/90 backdrop-blur-md border border-stroke-subtle shadow-xl">
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
                <ToolbarButton
                    icon={Hand}
                    onClick={() => onTogglePanMode(!isPanMode)}
                    active={isPanMode}
                    title={isPanMode ? 'Exit Pan Mode' : 'Pan Mode'}
                />
                <ToolbarButton
                    icon={Maximize2}
                    onClick={onFitView}
                    title="Fit View"
                />
                <ToolbarDivider />

                <ToolbarButton
                    icon={Minus}
                    onClick={onZoomOut}
                    title="Zoom Out"
                />
                <ZoomDisplay />
                <ToolbarButton
                    icon={Plus}
                    onClick={onZoomIn}
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
    const { zoom } = useViewport();
    // 🛡️ FIX: Provide fallback zoom to prevent NaN display
    const displayZoom = (typeof zoom === 'number' && !isNaN(zoom)) ? zoom : 0.8;
    return (
        <span className="px-2 text-xs font-medium text-content-secondary min-w-[40px] text-center tabular-nums">
            {Math.round(displayZoom * 100)}%
        </span>
    );
}
