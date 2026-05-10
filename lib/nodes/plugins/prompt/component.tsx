'use client';

import React, { memo, useRef, useEffect, useState, useCallback } from 'react';
import { NodeProps } from 'reactflow';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import BaseNode from '@/lib/nodes/core/canvas/BaseNode';

interface PromptNodeData {
    label: string;
    config: {
        text: string;
    };
}

function PromptNode({ data, id, selected }: NodeProps<PromptNodeData>) {
    // Use AppStore for direct graph manipulation instead of setNodes
    const updateNodeConfig = useAppStore((state) => state.updateNodeConfig);
    const touchInteraction = useAppStore((state) => state.touchInteraction);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isFocusedRef = useRef(false);
    const [draftText, setDraftText] = useState(data.config?.text || '');

    const commitText = useCallback((nextText: string) => {
        const currentText = data.config?.text || '';
        if (currentText === nextText) return;

        updateNodeConfig(id, {
            ...data.config,
            text: nextText,
        });
    }, [id, data.config, updateNodeConfig]);

    useEffect(() => {
        if (isFocusedRef.current) return;
        const incoming = data.config?.text || '';
        if (incoming !== draftText) {
            setDraftText(incoming);
        }
    }, [data.config?.text, draftText]);

    useEffect(() => {
        if (!isFocusedRef.current) return;

        if (commitTimerRef.current) {
            clearTimeout(commitTimerRef.current);
        }

        commitTimerRef.current = setTimeout(() => {
            commitText(draftText);
        }, 350);

        return () => {
            if (commitTimerRef.current) {
                clearTimeout(commitTimerRef.current);
                commitTimerRef.current = null;
            }
        };
    }, [draftText, commitText]);

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
    }, [draftText]);

    useEffect(() => {
        return () => {
            if (commitTimerRef.current) {
                clearTimeout(commitTimerRef.current);
            }
        };
    }, []);

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        touchInteraction();
        setDraftText(e.target.value);
    };

    return (
        <BaseNode
            id={id}
            type="prompt"
            label={data.label}
            selected={selected}
            isNew={(data as any).isNew}
            renderInputs={false}
            hideStatus={true}
        >
            {/* Embedded Text Area Container */}
            <div className="relative group/prompt bg-white/5 border border-white/10 rounded-xl shadow-inner backdrop-blur-md transition-all duration-300 p-2.5">
                <textarea
                    ref={textareaRef}
                    className="nodrag custom-scrollbar block w-full min-h-[60px] max-h-[160px] text-sm bg-transparent border-none focus:outline-none focus:ring-0 text-content-primary resize-none p-0"
                    placeholder="Enter prompt or text here..."
                    value={draftText}
                    onChange={handleTextChange}
                    onFocus={() => {
                        isFocusedRef.current = true;
                    }}
                    onBlur={() => {
                        isFocusedRef.current = false;
                        commitText(draftText);
                    }}
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

import { NodeClientDef } from '../../core/types';
import { promptSharedDef } from './definition';

export const promptClientDef: NodeClientDef = {
    ...promptSharedDef,
    component: memo((props: any) => <PromptNode {...props} type="prompt" />),
};
