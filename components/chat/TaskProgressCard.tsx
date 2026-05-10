'use client';

import React, { useState } from 'react';
import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Check } from 'lucide-react';
import type { TaskBlueprint } from '@/lib/chat/streaming/protocol';

interface TaskProgress {
    status: 'running' | 'done' | 'failed';
    currentIndex: number;
    total: number;
    failedTaskId?: string | null;
    errorMessage?: string;
}

interface Props {
    tasks: TaskBlueprint[];
    progress: TaskProgress;
    onRetryFromTask?: (taskId: string) => void;
}

const COLOR_CHIP: Record<string, string> = {
    neutral: 'bg-stroke-subtle/30 text-content-secondary',
    indigo:  'bg-indigo-500/15 text-indigo-300',
    emerald: 'bg-emerald-500/15 text-emerald-300',
    rose:    'bg-rose-500/15 text-rose-300',
    amber:   'bg-amber-500/15 text-amber-300',
    sky:     'bg-sky-500/15 text-sky-300',
};

function resolveIcon(name: string | undefined): LucideIcon {
    if (!name) return LucideIcons.Folder;
    const Cand = (LucideIcons as any)[name];
    if (Cand && (typeof Cand === 'function' || typeof Cand === 'object')) return Cand as LucideIcon;
    return LucideIcons.Folder;
}

export function TaskProgressCard({ tasks, progress, onRetryFromTask }: Props) {
    const [expanded, setExpanded] = useState(progress.status !== 'done');

    if (progress.status === 'done' && !expanded) {
        const totalNodes = tasks.reduce((acc, t) => acc + t.nodes.length, 0);
        return (
            <button
                type="button"
                onClick={() => setExpanded(true)}
                className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg border border-stroke-subtle/40 bg-surface-elevated/40 hover:bg-surface-elevated text-xs text-content-secondary transition-colors mt-2"
            >
                <Check size={12} className="text-emerald-500 shrink-0" />
                <span>Built {tasks.length} task{tasks.length === 1 ? '' : 's'} · {totalNodes} node{totalNodes === 1 ? '' : 's'}</span>
                <span className="ml-auto text-content-tertiary">▾</span>
            </button>
        );
    }

    return (
        <div className="mt-2 px-3 py-3 rounded-lg border border-stroke-subtle/40 bg-surface-elevated/40">
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-content-primary">
                    {progress.status === 'failed' ? 'Build failed' :
                     progress.status === 'done' ? 'Build complete' :
                     'Building workflow'}
                </span>
                <span className="text-xs text-content-tertiary tabular-nums">
                    {Math.min(progress.currentIndex, progress.total)} / {progress.total}
                </span>
            </div>
            <div className="border-t border-border/40 pt-2">
                <ul className="flex flex-col gap-1.5">
                    {tasks.map((t, i) => {
                        const isDone = i < progress.currentIndex || progress.status === 'done';
                        const isActive = i === progress.currentIndex && progress.status === 'running';
                        const isFailed = progress.status === 'failed' && t.id === progress.failedTaskId;
                        const isUpcoming = !isDone && !isActive && !isFailed;

                        const GIcon = t.group ? resolveIcon(t.group.icon) : null;
                        const colorClass = t.group?.color ? COLOR_CHIP[t.group.color] : COLOR_CHIP.neutral;

                        return (
                            <li key={t.id} className="flex items-start gap-2 text-sm">
                                <span className="w-4 mt-0.5 shrink-0 flex items-center justify-center">
                                    {isDone && <Check size={12} className="text-emerald-500" />}
                                    {isActive && <span className="block h-2 w-2 rounded-full bg-accent-primary animate-pulse" />}
                                    {isFailed && <span className="block h-2 w-2 rounded-full bg-rose-500" />}
                                    {isUpcoming && <span className="block h-2 w-2 rounded-full border border-content-tertiary/50" />}
                                </span>
                                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        {t.group && GIcon && (
                                            <span className={'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ' + colorClass}>
                                                <GIcon size={9} />
                                                <span className="truncate max-w-[120px]">{t.group.label}</span>
                                            </span>
                                        )}
                                        <span className={
                                            'truncate ' +
                                            (isDone || isActive ? 'text-content-primary' : 'text-content-tertiary') +
                                            (isActive ? ' font-medium' : '')
                                        }>
                                            {t.title}
                                        </span>
                                    </div>
                                    {isActive && (
                                        <span className="text-[11px] text-content-tertiary">
                                            Building {t.nodes.length} node{t.nodes.length === 1 ? '' : 's'}…
                                        </span>
                                    )}
                                    {isFailed && (
                                        <div className="text-[11px] text-rose-400 flex items-center gap-2">
                                            <span>{progress.errorMessage ?? 'Task failed'}</span>
                                            {onRetryFromTask && (
                                                <button
                                                    type="button"
                                                    onClick={() => onRetryFromTask(t.id)}
                                                    className="underline hover:text-rose-300"
                                                >
                                                    Retry from here
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
}
