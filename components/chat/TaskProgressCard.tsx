'use client';

import React, { useState } from 'react';
import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
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

function resolveIcon(name: string | undefined): LucideIcon {
    if (!name) return LucideIcons.Folder;
    const Cand = (LucideIcons as any)[name];
    if (Cand && (typeof Cand === 'function' || typeof Cand === 'object')) return Cand as LucideIcon;
    return LucideIcons.Folder;
}

/**
 * "Tasks being applied" list. Shares the ActivityTimeline visual language:
 * monochrome icon badges, NO checkmarks — status is a small trailing dot
 * (muted = done, glowing accent = active, hollow = upcoming, rose = failed)
 * plus label weight/brightness.
 */
export function TaskProgressCard({ tasks, progress, onRetryFromTask }: Props) {
    const [expanded, setExpanded] = useState(progress.status !== 'done');

    if (progress.status === 'done' && !expanded) {
        const totalNodes = tasks.reduce((acc, t) => acc + t.nodes.length, 0);
        return (
            <button
                type="button"
                onClick={() => setExpanded(true)}
                className="mt-2 flex w-full items-center gap-2 rounded-lg border border-stroke-subtle/50 bg-surface-elevated/30 px-3 py-2 text-left text-xs text-content-secondary transition-colors hover:bg-surface-elevated/60"
            >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-content-tertiary" />
                <span>
                    Built {tasks.length} task{tasks.length === 1 ? '' : 's'} · {totalNodes} node
                    {totalNodes === 1 ? '' : 's'}
                </span>
                <ChevronRight size={12} className="ml-auto text-content-tertiary" />
            </button>
        );
    }

    return (
        <div className="mt-2 rounded-lg border border-stroke-subtle/50 bg-surface-elevated/30 px-3 py-3">
            <div className="mb-2.5 flex items-center justify-between">
                <span className="text-[11px] tracking-[0.3px] text-content-tertiary">
                    {progress.status === 'failed'
                        ? 'Build failed'
                        : progress.status === 'done'
                          ? 'Built workflow'
                          : 'Building workflow'}
                </span>
                <span className="text-[11px] tabular-nums text-content-tertiary">
                    {Math.min(progress.currentIndex, progress.total)} / {progress.total}
                </span>
            </div>

            <ul className="flex flex-col">
                {tasks.map((t, i) => {
                    const isDone = i < progress.currentIndex || progress.status === 'done';
                    const isActive = i === progress.currentIndex && progress.status === 'running';
                    const isFailed = progress.status === 'failed' && t.id === progress.failedTaskId;
                    const isUpcoming = !isDone && !isActive && !isFailed;

                    const GIcon = t.group ? resolveIcon(t.group.icon) : LucideIcons.Square;

                    return (
                        <li key={t.id} className="flex items-start gap-2.5 py-1">
                            {/* group icon badge — monochrome; active picks up accent */}
                            <span
                                className={
                                    'mt-px grid h-5 w-5 shrink-0 place-items-center rounded-md border ' +
                                    (isActive
                                        ? 'border-accent-primary/45 bg-accent-primary/15 text-accent-primary timeline-halo'
                                        : isFailed
                                          ? 'border-accent-error/40 bg-accent-error/10 text-accent-error'
                                          : 'border-stroke-subtle bg-surface-tertiary/50 text-content-secondary')
                                }
                            >
                                <GIcon size={11} strokeWidth={2} />
                            </span>

                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <div className="flex items-center gap-2">
                                    <span
                                        className={
                                            'truncate text-xs ' +
                                            (isActive
                                                ? 'font-medium text-content-primary'
                                                : isUpcoming
                                                  ? 'text-content-tertiary'
                                                  : 'text-content-secondary')
                                        }
                                    >
                                        {t.title}
                                    </span>
                                    {/* trailing status dot — never a checkmark */}
                                    <span className="ml-auto shrink-0">
                                        {isActive && (
                                            <span className="block h-[5px] w-[5px] rounded-full bg-accent-primary shadow-[0_0_0_3px_rgb(var(--accent-primary)/0.18)]" />
                                        )}
                                        {isFailed && (
                                            <span className="block h-[5px] w-[5px] rounded-full bg-accent-error" />
                                        )}
                                        {isDone && !isActive && (
                                            <span className="block h-[5px] w-[5px] rounded-full bg-content-tertiary" />
                                        )}
                                        {isUpcoming && (
                                            <span className="block h-[6px] w-[6px] rounded-full border border-content-tertiary/50" />
                                        )}
                                    </span>
                                </div>

                                {t.group && (
                                    <span className="text-[10px] tracking-[0.2px] text-content-tertiary">
                                        {t.group.label}
                                    </span>
                                )}

                                {isActive && (
                                    <span className="text-[11px] text-content-tertiary">
                                        Building {t.nodes.length} node{t.nodes.length === 1 ? '' : 's'}…
                                    </span>
                                )}

                                {isFailed && (
                                    <div className="flex items-center gap-2 text-[11px] text-accent-error">
                                        <span>{progress.errorMessage ?? 'Task failed'}</span>
                                        {onRetryFromTask && (
                                            <button
                                                type="button"
                                                onClick={() => onRetryFromTask(t.id)}
                                                className="underline hover:opacity-80"
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
    );
}
