'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as Icons from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/Tooltip';
import type { NodeStatus } from '@/lib/nodes/types';

// Running spinner: a single ~270° arc rotated by CSS (cheap, no JS rAF), with
// no faint background track — same clean look as lucide's Loader2. Built as an
// SVG so it still morphs into the success ring on completion.
function SpinnerGlyph() {
    return (
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-accent-primary animate-spin" fill="none">
            <path d="M12 3 A9 9 0 1 1 3 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
    );
}

// Success celebration: the ring draws itself closed (picking up where the
// spinner's arc left off), then the checkmark strokes in — framer-motion's
// pathLength is what makes the "line animates into a check" effect.
function SuccessDrawGlyph() {
    return (
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-accent-primary" fill="none" strokeLinecap="round" strokeLinejoin="round">
            {/* Same cx/cy/r/strokeWidth as SpinnerGlyph's arc (r=9), and NO
                rotate transform — so the finished ring sits exactly on the
                circle the spinner traced (no origin-shift risk from
                transform-box). */}
            <motion.circle
                cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.4, ease: 'easeInOut' }}
            />
            {/* Check scaled ~15% smaller / re-centered for a clear gap to the ring. */}
            <motion.path
                d="M8.2 12.3l2.4 2.5 5.2-5.6" stroke="currentColor" strokeWidth="2.5"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.3, ease: 'easeOut', delay: 0.4 }}
            />
        </svg>
    );
}

interface NodeHeaderProps {
    icon: string;
    label: string;
    description?: string; // We'll keep it in props but won't render it per requirement
    color: string;
    badgeCount?: number;
    className?: string;
    providerLogo?: string;
    onLabelChange?: (label: string) => void;
    onLabelDraft?: (label: string | null) => void;
    // Run status drives the icon box's appearance (the box doubles as the
    // node's status indicator now that it floats above the frame). `idle`
    // shows the plain node icon; `hideStatus` forces the plain icon always.
    status?: NodeStatus;
    statusError?: string | null;
    hideStatus?: boolean;
}

export function NodeHeader({ icon, label, color, badgeCount, className, providerLogo, onLabelChange, onLabelDraft, status, statusError, hideStatus }: NodeHeaderProps) {
    const IconComponent = (Icons[icon as keyof typeof Icons] as React.ComponentType<any>) || Icons.Box;
    // The icon box doubles as the run-status indicator. While a node is
    // pending/running/erroring (and — for now — succeeding) the box swaps its
    // tint and glyph; idle shows the plain node icon. Once we drop the success
    // badge, `success` will fall through to the plain-icon branch, so a finished
    // node simply shows its normal icon (i.e. no status), exactly as intended.
    const showStatus = !hideStatus && !!status && status !== 'idle';
    const baseBox = "w-6 h-6 rounded flex items-center justify-center shrink-0 overflow-hidden border";

    // Running → success "celebration": when a node actually transitions from
    // running to success, draw the checkmark, hold ~1s, then settle back to the
    // plain node icon. Gated on the running→success EDGE (not just "is success")
    // so a hydrated/reloaded success node doesn't replay the animation on mount.
    const [celebrating, setCelebrating] = useState(false);
    const prevStatus = useRef(status);
    useEffect(() => {
        const was = prevStatus.current;
        prevStatus.current = status;
        if (status === 'success' && was === 'running') {
            setCelebrating(true);
            const t = setTimeout(() => setCelebrating(false), 1400);
            return () => clearTimeout(t);
        }
        // Leaving success (e.g. a re-run) cancels any lingering celebration.
        if (status !== 'success') setCelebrating(false);
    }, [status]);

    // Resolved visual phase for the icon box. `error` is handled separately in
    // JSX (it needs the tooltip wrapper). A settled success — once the ~1s
    // celebration ends — falls through to `idle`, so a finished node simply
    // shows its normal icon. That is exactly the "success shows nothing" end
    // state, reached smoothly via the checkmark rather than snapping to it.
    const statusPhase: 'idle' | 'running' | 'pending' | 'success' =
        !showStatus ? 'idle'
        : status === 'running' ? 'running'
        : status === 'pending' ? 'pending'
        : status === 'success' && celebrating ? 'success'
        : 'idle';
    const [isEditing, setIsEditing] = useState(false);
    const [draftLabel, setDraftLabel] = useState(label);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!isEditing) {
            setDraftLabel(label);
        }
    }, [label, isEditing]);

    useEffect(() => {
        if (!isEditing) return;
        if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
        // Seed the live draft so subscribers (e.g. the properties panel) match
        // the in-progress value from the moment editing starts.
        onLabelDraft?.(draftLabel);
        // Note: intentionally not depending on draftLabel/onLabelDraft — only seed once on entry.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEditing]);

    const commitLabel = () => {
        const trimmed = draftLabel.trim();
        const nextLabel = trimmed.length > 0 ? trimmed : label;
        if (onLabelChange && nextLabel !== label) {
            onLabelChange(nextLabel);
        }
        onLabelDraft?.(null);
        setIsEditing(false);
    };

    const cancelEditing = () => {
        setDraftLabel(label);
        onLabelDraft?.(null);
        setIsEditing(false);
    };

    return (
        <div className={cn("flex items-center gap-1.5", className)}>
            {showStatus && status === 'error' ? (
                <Tooltip
                    position="left"
                    content={statusError || 'Generation failed'}
                    className={cn(baseBox, "bg-accent-error/15 border-accent-error/40 cursor-help")}
                    popupClassName="whitespace-normal max-w-xs leading-snug normal-case tracking-normal font-semibold"
                >
                    <Icons.X className="w-3.5 h-3.5 text-accent-error" />
                </Tooltip>
            ) : (
                <div
                    className={cn(
                        baseBox,
                        // transition-colors smoothly fades the tint when the box
                        // settles success → idle after the celebration.
                        "relative transition-colors duration-500",
                        statusPhase === 'running' && "bg-accent-primary/15 border-accent-primary/40 shadow-[0_0_10px_rgba(6,182,212,0.45)]",
                        statusPhase === 'pending' && "bg-slate-500/15 border-slate-400/40 animate-pulse",
                        statusPhase === 'success' && "bg-accent-primary/15 border-accent-primary/40",
                        statusPhase === 'idle' && "bg-accent-primary/10 border-accent-primary/20"
                    )}
                >
                    {/* Glyph swap is a crossfade: spinner → success-draw → icon.
                        Children are absolutely centered so the outgoing and
                        incoming glyphs overlap (no layout jump). keyed by phase
                        so a phase change drives the AnimatePresence transition. */}
                    <AnimatePresence initial={false}>
                        <motion.span
                            key={statusPhase}
                            initial={{ opacity: 0, scale: 0.55 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.55 }}
                            transition={{ duration: 0.18, ease: 'easeOut' }}
                            className="absolute inset-0 flex items-center justify-center"
                        >
                            {statusPhase === 'running' ? (
                                <SpinnerGlyph />
                            ) : statusPhase === 'success' ? (
                                <SuccessDrawGlyph />
                            ) : (
                                <IconComponent
                                    className={cn(
                                        "w-3.5 h-3.5",
                                        statusPhase === 'pending' ? "text-slate-300" : "text-accent-primary"
                                    )}
                                />
                            )}
                        </motion.span>
                    </AnimatePresence>
                </div>
            )}

            <div className="flex-1 min-w-0 flex items-center">
                <div className="inline-grid items-center relative min-w-[20px] max-w-full">
                    {/* Mirror span to drive the width of the container */}
                    <span
                        className="invisible whitespace-pre text-sm font-bold tracking-wide px-1.5 py-0.5 border border-transparent normal-case"
                        aria-hidden="true"
                    >
                        {(isEditing ? draftLabel : label) || ' '}
                    </span>

                    {isEditing ? (
                        <input
                            ref={inputRef}
                            value={draftLabel}
                            onChange={(e) => {
                                const next = e.target.value;
                                setDraftLabel(next);
                                onLabelDraft?.(next);
                            }}
                            onBlur={commitLabel}
                            onClick={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    commitLabel();
                                }
                                if (e.key === 'Escape') {
                                    e.preventDefault();
                                    cancelEditing();
                                }
                            }}
                            className="nodrag absolute inset-0 w-full bg-transparent border border-white/40 rounded px-1.5 py-0.5 text-sm font-bold text-content-primary tracking-wide focus:outline-none min-w-0 normal-case"
                        />
                    ) : (
                        <h3
                            className="absolute inset-0 text-sm font-bold text-content-primary truncate tracking-wide cursor-text hover:text-accent-primary transition-colors border border-transparent px-1.5 py-0.5 rounded flex items-center normal-case"
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                setIsEditing(true);
                            }}
                        >
                            {label}
                        </h3>
                    )}
                </div>
            </div>

            {badgeCount !== undefined && badgeCount > 0 && (
                <div className="px-2 py-0.5 rounded-full bg-accent-primary text-[10px] font-black text-content-inverted leading-none shadow-lg">
                    {badgeCount}
                </div>
            )}
        </div>
    );
}
