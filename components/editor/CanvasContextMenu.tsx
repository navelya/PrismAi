'use client';

import React, { useEffect, useRef, useState } from 'react';
import { NodeType } from '@/lib/nodes/types';
import { nodeMetadata } from '@/lib/nodes/registry';
import * as Icons from 'lucide-react';
import { Plus } from 'lucide-react';

interface CanvasContextMenuProps {
    position: { x: number; y: number };
    canvasBounds: DOMRect;
    onSelectNode: (type: NodeType, position: { x: number; y: number }) => void;
    onClose: () => void;
}

const nodeTypes: NodeType[] = [
    'media_input',
    'scrape_images',
    'remove_background',
    'filter_sort',
    'ai_generate_image',
    'upscale_image',
    'merge_image'
];

// Menu dimensions for positioning calculations
const MENU_WIDTH = 220;
const MENU_HEIGHT = 320;
const MENU_PADDING = 8;

export default function CanvasContextMenu({
    position,
    canvasBounds,
    onSelectNode,
    onClose,
}: CanvasContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const [isVisible, setIsVisible] = useState(false);

    // Calculate edge-aware position
    const calculatePosition = () => {
        let x = position.x;
        let y = position.y;

        // Check right edge
        if (position.x + MENU_WIDTH > canvasBounds.right - MENU_PADDING) {
            x = position.x - MENU_WIDTH;
        }

        // Check bottom edge
        if (position.y + MENU_HEIGHT > canvasBounds.bottom - MENU_PADDING) {
            y = position.y - MENU_HEIGHT;
        }

        // Ensure minimum bounds (don't go past left/top)
        x = Math.max(canvasBounds.left + MENU_PADDING, x);
        y = Math.max(canvasBounds.top + MENU_PADDING, y);

        return { x, y };
    };

    const menuPosition = calculatePosition();

    // Click outside to close
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        // Delay adding listeners to prevent immediate close
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleEscape);
        }, 0);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [onClose]);

    // Animate in
    useEffect(() => {
        requestAnimationFrame(() => {
            setIsVisible(true);
        });
    }, []);

    const handleNodeClick = (type: NodeType) => {
        onSelectNode(type, position);
        onClose();
    };

    return (
        <div
            ref={menuRef}
            className={`fixed z-[100] transition-all duration-150 ease-out ${isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
                }`}
            style={{
                left: menuPosition.x,
                top: menuPosition.y,
                transformOrigin: 'top left',
            }}
        >
            <div className="bg-white/95 backdrop-blur-xl rounded-xl shadow-2xl border border-gray-200/80 overflow-hidden"
                style={{ width: MENU_WIDTH }}>
                {/* Header */}
                <div className="px-3 py-2 bg-gradient-to-r from-purple-50 to-blue-50 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-md bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                            <Plus className="w-3 h-3 text-white" />
                        </div>
                        <span className="text-xs font-semibold text-gray-700">Add Node</span>
                    </div>
                </div>

                {/* Node List */}
                <div className="py-1 max-h-[260px] overflow-y-auto">
                    {nodeTypes.map((type) => {
                        const metadata = nodeMetadata[type];
                        const IconComponent = metadata?.icon
                            ? (Icons[metadata.icon as keyof typeof Icons] as React.ComponentType<any>)
                            : Icons.Box;

                        return (
                            <button
                                key={type}
                                onClick={() => handleNodeClick(type)}
                                className="w-full px-2 py-1.5 flex items-center gap-2 hover:bg-gray-50 
                                           transition-colors duration-100 group"
                            >
                                <div
                                    className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0
                                               group-hover:scale-110 transition-transform duration-150"
                                    style={{ backgroundColor: `${metadata?.color}15` }}
                                >
                                    <IconComponent
                                        className="w-3.5 h-3.5"
                                        style={{ color: metadata?.color }}
                                    />
                                </div>
                                <div className="flex-1 text-left min-w-0">
                                    <div className="text-xs font-medium text-gray-800 group-hover:text-gray-900">
                                        {metadata?.label}
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Footer hint */}
                <div className="px-3 py-1.5 bg-gray-50 border-t border-gray-100">
                    <p className="text-[10px] text-gray-400 text-center">
                        Press <kbd className="px-1 py-0.5 bg-white rounded border border-gray-200 text-gray-500 font-mono text-[9px]">Esc</kbd> to close
                    </p>
                </div>
            </div>
        </div>
    );
}
