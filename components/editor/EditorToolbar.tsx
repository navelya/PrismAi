'use client';

import React, { useState } from 'react';
import { Play, Save, Trash2, FilePlus, MoreVertical, MousePointer, Square, Coins } from 'lucide-react';
import { Tooltip } from '@/components/ui/Tooltip';
import { useTokenBalance } from '@/lib/billing/use-balance';
import { formatCredits } from '@/lib/billing/cost';

interface EditorToolbarProps {
    workflowName: string;
    onNameChange: (name: string) => void;
    onSave: () => void;
    onRun: () => void;
    onStop?: () => void;
    isRunning?: boolean;
    onDelete: () => void;
    onNew: () => void;
    isPaletteOpen?: boolean;
}

export default function EditorToolbar({
    workflowName,
    onNameChange,
    onSave,
    onRun,
    onStop,
    isRunning = false,
    onDelete,
    onNew,
    isPaletteOpen = true,
}: EditorToolbarProps) {
    const [showMenu, setShowMenu] = useState(false);
    const { balance, loading: balanceLoading } = useTokenBalance();
    // State for auto-expanding width
    const [titleWidth, setTitleWidth] = useState('auto');
    const spanRef = React.useRef<HTMLSpanElement>(null);

    React.useEffect(() => {
        if (spanRef.current) {
            const width = spanRef.current.offsetWidth;
            setTitleWidth(`${Math.max(120, Math.min(width + 32, 400))}px`);
        }
    }, [workflowName]);

    // Floating Island CSS Classes
    const islandBase = "pointer-events-auto bg-surface-elevated/80 backdrop-blur-md border border-stroke-subtle shadow-xl shadow-black/20 transition-all duration-500 ease-in-out px-2 py-1.5 flex items-center gap-2";

    return (
        <div className="absolute inset-0 z-40 p-4 pointer-events-none flex items-start">
            {/* Hidden span for width measurement */}
            <span
                ref={spanRef}
                className="absolute opacity-0 pointer-events-none whitespace-pre font-semibold text-sm px-4"
                aria-hidden="true"
            >
                {workflowName || "Untitled Workflow"}
            </span>

            {/* Credits Island (Left) */}
            <div className={`${islandBase} rounded-full pl-3 pr-1.5`}>
                <div className="flex items-center gap-1.5 text-sm font-semibold text-content-primary tabular-nums">
                    <Coins className="w-4 h-4 text-accent-primary" />
                    <span>{balanceLoading ? '…' : formatCredits(balance)}</span>
                </div>
                <div className="w-[1px] h-4 bg-stroke-subtle mx-1" />
                <button
                    onClick={() => { /* TODO: open subscription page */ }}
                    className="px-3 py-1 text-xs font-semibold text-accent-primary hover:bg-accent-primary/10 rounded-full transition-colors"
                >
                    Upgrade
                </button>
            </div>

            {/* Workflow Name Island (Centered) */}
            <div
                className={`${islandBase} rounded-2xl absolute left-1/2 -translate-x-1/2`}
                style={{ width: titleWidth }}
            >
                <div className="flex items-center gap-2 w-full justify-center px-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-accent-primary animate-pulse flex-shrink-0" />
                    <input
                        type="text"
                        value={workflowName || ''}
                        onChange={(e) => onNameChange(e.target.value)}
                        className="w-full bg-transparent text-sm font-semibold text-content-primary placeholder:text-content-tertiary focus:outline-none text-center"
                        placeholder="Untitled Workflow"
                    />
                </div>
            </div>

            <div className="flex-1" />

            {/* Actions Island (Right) */}
            <div className={`${islandBase} rounded-full`}>
                {/* Primary Action - Run/Stop toggle */}
                {isRunning ? (
                    <Tooltip content="Stop" position="bottom">
                        <button
                            onClick={onStop}
                            className="p-2.5 bg-accent-error/20 border border-accent-error/30 text-accent-error rounded-full hover:bg-accent-error/30 transition-all shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                        >
                            <Square className="w-4 h-4 fill-current" />
                        </button>
                    </Tooltip>
                ) : (
                    <Tooltip content="Run" position="bottom">
                        <button
                            onClick={onRun}
                            className="p-2.5 bg-accent-primary text-white rounded-full hover:scale-110 active:scale-95 transition-all shadow-[0_0_20px_rgba(6,182,212,0.4)] border border-accent-primary/50"
                        >
                            <Play className="w-4 h-4 fill-current" />
                        </button>
                    </Tooltip>
                )}

                <div className="w-[1px] h-4 bg-stroke-subtle mx-1" />

                <Tooltip content="Save" position="bottom">
                    <button
                        onClick={onSave}
                        className="p-2 text-content-secondary hover:text-content-primary hover:bg-surface-tertiary rounded-full transition-colors"
                    >
                        <Save className="w-4 h-4" />
                    </button>
                </Tooltip>

                <Tooltip content="New" position="bottom">
                    <button
                        onClick={onNew}
                        className="p-2 text-content-secondary hover:text-content-primary hover:bg-surface-tertiary rounded-full transition-colors"
                    >
                        <FilePlus className="w-4 h-4" />
                    </button>
                </Tooltip>

                {/* More Menu */}
                <div className="relative">
                    <button
                        onClick={() => setShowMenu(!showMenu)}
                        className="p-2 text-content-secondary hover:text-content-primary hover:bg-surface-tertiary rounded-full transition-colors"
                    >
                        <MoreVertical className="w-4 h-4" />
                    </button>

                    {showMenu && (
                        <>
                            <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                            <div className="absolute right-0 top-full mt-2 w-48 bg-surface-elevated/95 backdrop-blur-md border border-stroke-subtle rounded-xl shadow-2xl z-20 py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                <button
                                    onClick={() => { onDelete(); setShowMenu(false); }}
                                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-500 hover:bg-red-500/5 transition-colors"
                                >
                                    <Trash2 className="w-4 h-4" />
                                    Delete Workflow
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
