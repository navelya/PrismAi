'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as Icons from 'lucide-react';
import { cn } from '@/lib/utils';

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
}

export function NodeHeader({ icon, label, color, badgeCount, className, providerLogo, onLabelChange, onLabelDraft }: NodeHeaderProps) {
    const IconComponent = (Icons[icon as keyof typeof Icons] as React.ComponentType<any>) || Icons.Box;
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
            <div
                className="w-6 h-6 rounded flex items-center justify-center shrink-0 bg-accent-primary/10 border border-accent-primary/20 overflow-hidden"
            >
                <IconComponent
                    className="w-3.5 h-3.5 text-accent-primary"
                />
            </div>

            <div className="flex-1 min-w-0 flex items-center">
                <div className="inline-grid items-center relative min-w-[20px] max-w-full">
                    {/* Mirror span to drive the width of the container */}
                    <span
                        className="invisible whitespace-pre text-[11px] font-bold tracking-wide px-1.5 py-0.5 border border-transparent normal-case"
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
                            className="nodrag absolute inset-0 w-full bg-transparent border border-white/40 rounded px-1.5 py-0.5 text-[11px] font-bold text-content-primary tracking-wide focus:outline-none min-w-0 normal-case"
                        />
                    ) : (
                        <h3
                            className="absolute inset-0 text-[11px] font-bold text-content-primary truncate tracking-wide cursor-text hover:text-accent-primary transition-colors border border-transparent px-1.5 py-0.5 rounded flex items-center normal-case"
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
