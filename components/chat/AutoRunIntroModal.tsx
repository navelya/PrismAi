'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useAppStore } from '@/lib/store/app-store';
import { NumberInput } from '@/components/ui/NumberInput';
import { formatCredits } from '@/lib/billing/cost';
import { userApi } from '@/lib/api/client';
import { createClient } from '@/lib/supabase/client';

/**
 * One-time onboarding modal for auto-run. Shown the first time a user reaches a
 * paid run proposal from chat. Explains auto-run, lets them set their limit
 * (default 10), and on approve saves the limit + runs the triggering workflow
 * if it's within that limit. Dismissing still counts as seen.
 *
 * Mounted once (in ChatInterface); renders nothing until `autoRunIntro` is set.
 */
export function AutoRunIntroModal() {
    const intro = useAppStore((s) => s.autoRunIntro);
    if (!intro) return null;
    return <AutoRunIntroDialog />;
}

/** Persist a partial preferences patch, merged onto the user's existing prefs. */
async function persistPrefs(patch: Record<string, any>) {
    const { user } = await userApi.me();
    if (!user) return;
    const supabase = createClient();
    const existing = (user as any).profile?.preferences || {};
    await supabase.from('profiles').upsert({
        id: user.id,
        preferences: { ...existing, ...patch },
        avatar_url: (user as any).profile?.avatar_url || null,
    });
}

function AutoRunIntroDialog() {
    // Snapshot the payload once so a mid-flight store change can't swap it.
    const [intro] = useState(() => useAppStore.getState().autoRunIntro!);
    const [limit, setLimit] = useState<number>(() => useAppStore.getState().maxAutoRunCredits ?? 10);
    const [saving, setSaving] = useState(false);

    const willRun = intro.cost <= limit;

    // Portal to <body> so the fixed-inset overlay centers on the viewport even
    // when a parent (the chat panel) has a CSS transform/backdrop that would
    // otherwise become the containing block for `fixed`.
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    const finish = async (patch: Record<string, any>, run: boolean) => {
        setSaving(true);
        try {
            await persistPrefs(patch);
        } catch (e) {
            console.error('[auto-run intro] failed to persist preferences', e);
        }
        const store = useAppStore.getState();
        if (typeof patch.maxAutoRunCredits === 'number') {
            store.setMaxAutoRunCredits(patch.maxAutoRunCredits);
        }
        store.setHasSeenAutoRunIntro(true);
        store.closeAutoRunIntro();

        if (run) {
            store.updateMessage(intro.messageId, {
                runProposal: {
                    runTargetIds: intro.runTargetIds,
                    terminalIds: intro.terminalIds,
                    cost: intro.cost,
                    status: 'running',
                },
            });
            store.triggerRunSelection(intro.runTargetIds, { preconfirmed: true });
        }
        // saving state is moot once closed (component unmounts), but keep it tidy.
        setSaving(false);
    };

    const handleApprove = () => {
        const chosen = Math.max(0, Math.min(10000, Math.trunc(Number(limit) || 0)));
        void finish({ maxAutoRunCredits: chosen, seenAutoRunIntro: true }, intro.cost <= chosen);
    };

    // Dismiss: counts as seen, keeps the existing limit, does NOT run. The Run
    // card stays on the message so the user can run it manually.
    const handleDismiss = () => {
        if (saving) return;
        void finish({ seenAutoRunIntro: true }, false);
    };

    // Esc closes (counts as dismiss).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') handleDismiss();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [saving]);

    if (!mounted) return null;

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={handleDismiss}
            />

            {/* Dialog */}
            <div className="relative w-full max-w-md rounded-3xl border border-stroke-subtle bg-surface-elevated shadow-2xl shadow-black/40 p-6 sm:p-7 animate-in fade-in zoom-in-95 duration-200">
                <button
                    type="button"
                    onClick={handleDismiss}
                    aria-label="Close"
                    className="absolute right-4 top-4 p-1.5 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary transition-colors"
                >
                    <X className="w-4 h-4" />
                </button>

                <h2 className="text-lg font-bold text-content-primary pr-8">
                    Auto-run is ready
                </h2>
                <p className="text-sm text-content-secondary leading-relaxed mt-2">
                    When the chat builds a workflow, it can run it for you automatically — as
                    long as the run costs up to your auto-run limit. If a run would cost more,
                    you&apos;ll get a Run button instead so nothing runs without your okay.
                </p>
                <p className="text-xs text-content-tertiary leading-relaxed mt-2">
                    You can change this anytime in Settings → Tokens &amp; Credits Usage.
                </p>

                {/* Limit control */}
                <div className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-stroke-subtle bg-surface-primary/40 px-4 py-3.5">
                    <div className="min-w-0">
                        <div className="text-sm font-semibold text-content-primary">Auto-run limit</div>
                        <div className="text-xs text-content-tertiary mt-0.5">Credits per run</div>
                    </div>
                    <NumberInput
                        min={0}
                        step={1}
                        value={limit}
                        onChange={(e) =>
                            setLimit(Math.max(0, Math.min(10000, Math.trunc(Number(e.target.value) || 0))))
                        }
                        className="w-28"
                    />
                </div>

                {/* What happens to THIS run */}
                <div className="mt-3 text-xs text-content-secondary">
                    This workflow costs{' '}
                    <span className="font-semibold text-content-primary tabular-nums">
                        {formatCredits(intro.cost)}
                    </span>{' '}
                    credits.{' '}
                    {willRun ? (
                        <span className="text-accent-primary">It will run now.</span>
                    ) : (
                        <span className="text-content-tertiary">
                            That&apos;s above your limit, so it won&apos;t run automatically — you&apos;ll
                            get a Run button.
                        </span>
                    )}
                </div>

                {/* Actions */}
                <div className="mt-6 flex items-center justify-end gap-3">
                    <button
                        type="button"
                        onClick={handleDismiss}
                        disabled={saving}
                        className="px-4 py-2 rounded-xl text-sm font-medium text-content-secondary hover:text-content-primary hover:bg-surface-tertiary transition-colors disabled:opacity-50"
                    >
                        Not now
                    </button>
                    <button
                        type="button"
                        onClick={handleApprove}
                        disabled={saving}
                        className="px-5 py-2 rounded-xl bg-accent-primary text-white text-sm font-semibold hover:bg-accent-primary/90 transition-colors disabled:opacity-60 shadow-lg shadow-accent-primary/30"
                    >
                        {saving ? 'Saving…' : willRun ? 'Save & run' : 'Save'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
