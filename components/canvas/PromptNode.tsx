'use client';

import React, { memo, useRef, useEffect } from 'react';
import { NodeProps, useReactFlow } from 'reactflow';
import { cn } from '@/lib/utils';
import BaseNode from '@/components/canvas/BaseNode';

interface PromptNodeData {
    label: string;
    config: {
        text: string;
    };
}

function PromptNode({ data, id, selected }: NodeProps<PromptNodeData>) {
    // Use React Flow hook for direct graph manipulation
    const { setNodes } = useReactFlow();
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-resize algorithm and wheel event capture
    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;

        // Auto-resize logic
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;

        // Wheel event capture to override React Flow's native behavior selectively
        const handleWheelNative = (e: WheelEvent) => {
            // If the user isn't holding Ctrl or Meta, they intend to scroll the text area,
            // so stop propagation to prevent the canvas from panning.
            if (!e.ctrlKey && !e.metaKey) {
                e.stopPropagation();
            }
        };

        el.addEventListener('wheel', handleWheelNative, { passive: false });

        return () => {
            el.removeEventListener('wheel', handleWheelNative);
        };
    }, [data.config?.text]);

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === id) {
                    return {
                        ...node,
                        data: {
                            ...node.data,
                            config: {
                                ...node.data.config,
                                text: newValue,
                            },
                        },
                    };
                }
                return node;
            })
        );
    };

    return (
        <BaseNode
            id={id}
            type="prompt"
            label={data.label}
            selected={selected}
            renderInputs={false}
        >
            {/* Embedded Text Area Container */}
            <div className="relative group/prompt bg-white/5 border border-white/10 rounded-xl shadow-inner backdrop-blur-md transition-all duration-300 p-2.5">
                <textarea
                    ref={textareaRef}
                    className="nodrag custom-scrollbar block w-full min-h-[60px] max-h-[160px] text-sm bg-transparent border-none focus:outline-none focus:ring-0 text-content-primary resize-none p-0"
                    placeholder="Enter prompt or text here..."
                    value={data.config?.text || ''}
                    onChange={handleTextChange}
                    onKeyDown={(e) => {
                        if (e.key === 'Backspace' || e.key === 'Delete') {
                            e.stopPropagation();
                        }
                    }}
                />
            </div>
        </BaseNode>
    );
}

export default memo(PromptNode);
