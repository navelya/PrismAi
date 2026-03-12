'use client';

import React, { useEffect, useRef } from 'react';
import * as RadixContextMenu from '@radix-ui/react-context-menu';
import { NodeType } from '@/lib/nodes/types';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import * as Icons from 'lucide-react';
import { Plus } from 'lucide-react';

interface CanvasContextMenuProps {
    position: { x: number; y: number };
    canvasBounds: DOMRect;
    onSelectNode: (type: NodeType, position: { x: number; y: number }) => void;
    onClose: () => void;
}

const nodeTypes = Object.keys(sharedRegistry) as NodeType[];
const MENU_WIDTH = 220;
const MENU_HEIGHT = 320;
const MENU_PADDING = 8;

/**
 * This component renders an invisible 1×1 div that programmatically triggers
 * the Radix ContextMenu. We simulate a contextmenu event on mount so the menu
 * opens immediately at the click position, then Radix handles everything else
 * (keyboard nav, Escape to close, focus management, collision detection).
 */
export default function CanvasContextMenu({
    position,
    canvasBounds,
    onSelectNode,
    onClose,
}: CanvasContextMenuProps) {
    const triggerRef = useRef<HTMLSpanElement>(null);

    // Fire a synthetic contextmenu event on the invisible trigger on mount
    // so Radix opens the menu immediately at the cursor position.
    useEffect(() => {
        if (!triggerRef.current) return;
        const event = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: position.x,
            clientY: position.y,
        });
        triggerRef.current.dispatchEvent(event);
    }, []);

    const handleNodeClick = (type: NodeType) => {
        onSelectNode(type, position);
        onClose();
    };

    return (
        <RadixContextMenu.Root onOpenChange={(open) => { if (!open) onClose(); }}>
            {/* 1×1 invisible trigger anchored at the right-click position */}
            <RadixContextMenu.Trigger asChild>
                <span
                    ref={triggerRef}
                    style={{
                        position: 'fixed',
                        left: position.x,
                        top: position.y,
                        width: 1,
                        height: 1,
                        display: 'block',
                        pointerEvents: 'none',
                    }}
                />
            </RadixContextMenu.Trigger>

            <RadixContextMenu.Portal>
                <RadixContextMenu.Content
                    style={{ width: MENU_WIDTH }}
                    collisionPadding={MENU_PADDING}
                    className="z-[9999] bg-surface-elevated/95 backdrop-blur-xl rounded-xl shadow-2xl border border-stroke-subtle overflow-hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
                    onEscapeKeyDown={onClose}
                    onInteractOutside={onClose}
                >
                    {/* Header */}
                    <div className="px-3 py-2 bg-gradient-to-r from-purple-500/10 to-blue-500/10 border-b border-stroke-subtle">
                        <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-md bg-gradient-premium flex items-center justify-center">
                                <Plus className="w-3 h-3 text-content-inverted" />
                            </div>
                            <span className="text-xs font-semibold text-content-primary">Add Node</span>
                        </div>
                    </div>

                    {/* Node List */}
                    <div className="py-1 max-h-[260px] overflow-y-auto">
                        {nodeTypes.map((type) => {
                            const metadata = sharedRegistry[type]?.meta;
                            const IconComponent = metadata?.icon
                                ? (Icons[metadata.icon as keyof typeof Icons] as React.ComponentType<any>)
                                : Icons.Box;

                            return (
                                <RadixContextMenu.Item
                                    key={type}
                                    onSelect={() => handleNodeClick(type)}
                                    className="w-full px-2 py-1.5 flex items-center gap-2 transition-colors duration-100 group outline-none cursor-pointer data-[highlighted]:bg-interactive-hover"
                                >
                                    <div
                                        className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 group-data-[highlighted]:scale-110 transition-transform duration-150"
                                        style={{ backgroundColor: `${metadata?.color}15` }}
                                    >
                                        <IconComponent
                                            className="w-3.5 h-3.5"
                                            style={{ color: metadata?.color }}
                                        />
                                    </div>
                                    <div className="flex-1 text-left min-w-0">
                                        <div className="text-xs font-medium text-content-primary">
                                            {metadata?.label}
                                        </div>
                                    </div>
                                </RadixContextMenu.Item>
                            );
                        })}
                    </div>

                    {/* Footer hint */}
                    <div className="px-3 py-1.5 bg-surface-tertiary border-t border-stroke-subtle">
                        <p className="text-[10px] text-content-tertiary text-center">
                            Press <kbd className="px-1 py-0.5 bg-surface-elevated rounded border border-stroke-subtle text-content-secondary font-mono text-[9px]">Esc</kbd> to close
                        </p>
                    </div>
                </RadixContextMenu.Content>
            </RadixContextMenu.Portal>
        </RadixContextMenu.Root>
    );
}
