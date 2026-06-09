'use client';

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { NodeProps } from 'reactflow';
import { motion } from 'framer-motion';
import { User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';

interface NoteAuthor {
    id: string;
    name: string;
    avatarUrl: string | null;
}

interface NoteNodeData {
    label: string;
    config: {
        text: string;
        author: NoteAuthor | null;
    };
    isNew?: boolean;
}

function NoteNode({ id, data, selected }: NodeProps<NoteNodeData>) {
    const updateNodeConfig = useAppStore((s) => s.updateNodeConfig);
    const touchInteraction = useAppStore((s) => s.touchInteraction);

    // Reveal-on-settle gate (mirrors GroupNode/BaseNode): a freshly added node
    // held in aiTurn.hiddenAddedIds stays invisible until the end-of-turn
    // measured re-layout. Manual adds are never in that set, so they show now.
    const isHiddenForReveal = useAppStore((s) => !!s.aiTurn?.hiddenAddedIds?.includes(id));

    const author = data.config?.author ?? null;

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const isFocusedRef = useRef(false);
    const [draftText, setDraftText] = useState(data.config?.text || '');

    // Pull external (stored) text changes in only while not actively editing.
    // Re-runs only when the stored value changes; setState with an equal value
    // is a no-op, so no extra guard is needed.
    useEffect(() => {
        if (isFocusedRef.current) return;
        setDraftText(data.config?.text || '');
    }, [data.config?.text]);

    // Auto-size the textarea to its content; capture wheel so the canvas doesn't
    // pan/zoom while the user scrolls a long note.
    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
        const onWheel = (e: WheelEvent) => { if (!e.ctrlKey && !e.metaKey) e.stopPropagation(); };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [draftText]);

    const commitText = useCallback((next: string) => {
        if ((data.config?.text || '') === next) return;
        updateNodeConfig(id, { ...data.config, text: next });
    }, [id, data.config, updateNodeConfig]);

    const initial = (author?.name?.[0] || '?').toUpperCase();

    return (
        <motion.div
            // Same pop-in as every other node (BaseNode): a freshly added note
            // (isNew) springs from 0.8→1 scale + fade. Opacity stays under
            // framer (not a style override) and is held at 0 while an AI-added
            // note awaits the end-of-turn measured re-layout (isHiddenForReveal);
            // manual adds have isHiddenForReveal === false, so they pop right in.
            initial={data.isNew ? { scale: 0.8, opacity: 0 } : false}
            animate={{ scale: 1, opacity: isHiddenForReveal ? 0 : 1 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
            className={cn(
                'relative w-[220px] rounded-xl border bg-surface-elevated/90 backdrop-blur-sm shadow-lg transition-colors',
                selected ? 'border-accent-primary' : 'border-stroke-subtle',
            )}
        >
            {/* Author avatar — name revealed on hover via the native title tooltip. */}
            <div
                className="absolute -top-2.5 -left-2.5 z-10 w-6 h-6 rounded-full overflow-hidden ring-2 ring-surface-primary bg-gradient-premium flex items-center justify-center text-white text-[10px] font-medium shadow"
                title={author?.name || 'Unknown author'}
            >
                {author?.avatarUrl ? (
                    <img src={author.avatarUrl} alt={author?.name || 'Author'} className="w-full h-full object-cover" />
                ) : author ? (
                    <span>{initial}</span>
                ) : (
                    <User className="w-3.5 h-3.5" />
                )}
            </div>

            <textarea
                ref={textareaRef}
                className="nodrag nowheel custom-scrollbar block w-full min-h-[48px] max-h-[280px] resize-none bg-transparent border-none p-3 pt-4 text-sm text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-0"
                placeholder="Write a note…"
                value={draftText}
                onChange={(e) => { touchInteraction(); setDraftText(e.target.value); }}
                onFocus={() => { isFocusedRef.current = true; }}
                onBlur={() => { isFocusedRef.current = false; commitText(draftText); }}
                onKeyDown={(e) => { if (e.key === 'Backspace' || e.key === 'Delete') e.stopPropagation(); }}
            />
        </motion.div>
    );
}

export default memo(NoteNode);
