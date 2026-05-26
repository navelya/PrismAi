'use client';

import { formatCredits } from '@/lib/billing/cost';
import type { RunProposalStatus } from '@/lib/store/types';

interface RunProposalCardProps {
    cost: number;
    status: RunProposalStatus;
    onRun: () => void;
    /** Why the run can't dispatch yet (validation). Shown in the ready state. */
    error?: string;
}

export function RunProposalCard({ cost, status, onRun, error }: RunProposalCardProps) {
    if (status === 'superseded') {
        return (
            <div className="mt-2 rounded-lg border border-stroke-subtle/60 bg-surface-secondary/20 px-3 py-2 text-xs text-content-tertiary">
                This run is out of date — the workflow changed since it was proposed.
            </div>
        );
    }

    if (status === 'done') {
        return (
            <div className="mt-2 rounded-lg border border-stroke-subtle/60 bg-surface-secondary/20 px-3 py-2 text-xs text-content-tertiary">
                Ran · {formatCredits(cost)} credits
            </div>
        );
    }

    if (status === 'failed') {
        return (
            <div className="mt-2 flex items-center justify-between rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs">
                <span className="text-red-400">Run failed.</span>
                <button
                    type="button"
                    onClick={onRun}
                    className="rounded-md border border-stroke-subtle/60 px-2 py-1 font-medium text-content-secondary hover:bg-surface-tertiary/50 transition-colors cursor-pointer"
                >
                    Retry · {formatCredits(cost)}
                </button>
            </div>
        );
    }

    // While running, show no button at all — the inline results area renders a
    // skeleton placeholder until the outputs arrive (both auto-run and a
    // user-clicked Run land here).
    if (status === 'running') return null;

    // Ready: the manual Run button (auto-run skips straight to 'running').
    return (
        <div className="mt-2 rounded-lg border border-stroke-subtle/70 bg-surface-secondary/30 px-3 py-2">
            <div className="flex items-center justify-between">
                <span className="text-xs text-content-secondary">Ready to run</span>
                <button
                    type="button"
                    onClick={onRun}
                    className="rounded-md bg-accent-primary px-3 py-1 text-xs font-medium text-white hover:bg-accent-primary/90 transition-colors cursor-pointer"
                >
                    Run · {formatCredits(cost)} credits
                </button>
            </div>
            {error && (
                <p className="mt-1.5 text-[11px] text-amber-400 leading-snug">
                    {error}
                </p>
            )}
        </div>
    );
}
