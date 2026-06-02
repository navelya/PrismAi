'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
    ArrowLeft,
    BarChart3,
    Trash2,
    Loader2,
    AlertCircle,
    Image as ImageIcon,
    Video,
    Music,
    Box,
    FolderOpen,
    Users,
    Layers,
    RefreshCw,
} from 'lucide-react';
import { adminStatisticsApi, type AdminStatistics } from '@/lib/api/admin-statistics';
import { ConfirmationModal } from '@/components/ui/ConfirmationModal';

interface Props {
    onMobileBack: () => void;
}

const CLEAN_BATCH_SIZE = 25;

export function StatisticsAdminContent({ onMobileBack }: Props) {
    const [stats, setStats] = useState<AdminStatistics | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [confirmOpen, setConfirmOpen] = useState(false);
    const [cleaning, setCleaning] = useState(false);
    const [cleanProgress, setCleanProgress] = useState<{ cleaned: number; remaining: number | null } | null>(null);
    const [cleanError, setCleanError] = useState<string | null>(null);
    const [cleanDone, setCleanDone] = useState<string | null>(null);

    const loadStats = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setStats(await adminStatisticsApi.stats());
        } catch (err: any) {
            setError(err.message || 'Failed to load statistics');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadStats(); }, [loadStats]);

    const runCleanup = useCallback(async () => {
        setCleaning(true);
        setCleanError(null);
        setCleanDone(null);
        setCleanProgress({ cleaned: 0, remaining: stats?.pendingDeletions ?? null });

        let totalCleaned = 0;
        let totalFiles = 0;
        try {
            // Auto-loop one batch at a time until nothing remains, or a batch
            // makes no progress (a stuck/fail-closed session) so we don't spin.
            while (true) {
                const res = await adminStatisticsApi.cleanupBatch(CLEAN_BATCH_SIZE);
                totalCleaned += res.cleaned;
                totalFiles += res.filesCleared;
                setCleanProgress({ cleaned: totalCleaned, remaining: res.remaining });

                if (res.remaining <= 0 || res.cleaned === 0) {
                    if (res.remaining > 0) {
                        setCleanDone(
                            `Cleaned ${totalCleaned} session(s) and ${totalFiles} file(s). ` +
                            `${res.remaining} could not be cleaned and were left for retry — check server logs.`,
                        );
                    } else {
                        setCleanDone(`Cleaned ${totalCleaned} session(s) and ${totalFiles} file(s).`);
                    }
                    break;
                }
            }
        } catch (err: any) {
            setCleanError(err.message || 'Cleanup failed');
        } finally {
            setCleaning(false);
            loadStats();
        }
    }, [stats?.pendingDeletions, loadStats]);

    const pending = stats?.pendingDeletions ?? 0;

    return (
        <div className="min-h-full flex flex-col">
            {/* Mobile back */}
            <div className="md:hidden px-8 pt-6">
                <button
                    onClick={onMobileBack}
                    className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-content-tertiary hover:text-content-primary transition-all"
                >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Return to Admin</span>
                </button>
            </div>

            {/* Header */}
            <header className="sticky top-0 z-30 bg-surface-primary/60 backdrop-blur-xl border-b border-white/5 px-8 py-5 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-2xl">
                <div className="flex items-center gap-5">
                    <div className="w-8 h-8 rounded-xl bg-accent-primary/10 flex items-center justify-center border border-accent-primary/20 shadow-inner">
                        <BarChart3 className="w-4 h-4 text-accent-primary" />
                    </div>
                    <div>
                        <h1 className="text-xl font-black text-content-primary uppercase tracking-tighter">Statistics</h1>
                        <p className="text-[10px] font-bold text-content-tertiary uppercase tracking-widest mt-0.5 opacity-60">Overview · Maintenance</p>
                    </div>
                </div>
                <button
                    onClick={loadStats}
                    disabled={loading}
                    className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-content-tertiary hover:text-content-primary text-[10px] font-bold uppercase tracking-widest rounded-xl transition-all disabled:opacity-40"
                >
                    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Refresh
                </button>
            </header>

            <main className="flex-1 max-w-7xl mx-auto w-full p-8 md:p-12 space-y-8">
                {error && (
                    <div className="p-4 rounded-2xl bg-red-500/5 border border-red-500/20 text-red-400 flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                        <p className="text-sm font-medium">{error}</p>
                    </div>
                )}

                {/* Sessions */}
                <section className="space-y-3">
                    <h2 className="text-[10px] font-black uppercase tracking-widest text-content-tertiary">Sessions</h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <StatCard icon={<Trash2 className="w-3.5 h-3.5" />} label="Pending Deletion" value={stats?.pendingDeletions} danger={pending > 0} />
                        <StatCard icon={<Layers className="w-3.5 h-3.5" />} label="Active Sessions" value={stats?.activeSessions} accent />
                        <StatCard icon={<Layers className="w-3.5 h-3.5" />} label="Total Sessions" value={stats?.totalSessions} />
                        <StatCard icon={<Users className="w-3.5 h-3.5" />} label="Total Users" value={stats?.totalUsers} />
                    </div>
                </section>

                {/* Preserved results (the library) */}
                <section className="space-y-3">
                    <h2 className="text-[10px] font-black uppercase tracking-widest text-content-tertiary">Preserved Results (Library)</h2>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <StatCard icon={<FolderOpen className="w-3.5 h-3.5" />} label="Total Keepers" value={stats?.keeperResults.total} accent />
                        <StatCard icon={<ImageIcon className="w-3.5 h-3.5" />} label="Images" value={stats?.keeperResults.image} />
                        <StatCard icon={<Video className="w-3.5 h-3.5" />} label="Videos" value={stats?.keeperResults.video} />
                        <StatCard icon={<Music className="w-3.5 h-3.5" />} label="Audio" value={stats?.keeperResults.audio} />
                        <StatCard icon={<Box className="w-3.5 h-3.5" />} label="3D" value={stats?.keeperResults['3d']} />
                    </div>
                </section>

                {/* Maintenance */}
                <section className="space-y-3">
                    <h2 className="text-[10px] font-black uppercase tracking-widest text-content-tertiary">Maintenance</h2>
                    <div className="bg-white/5 p-6 rounded-3xl border border-white/10 backdrop-blur-md shadow-xl space-y-4">
                        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                            <div className="space-y-1">
                                <p className="text-sm font-bold text-content-primary">Clean soft-deleted sessions</p>
                                <p className="text-xs text-content-tertiary leading-relaxed max-w-xl">
                                    Runs the same job as the nightly cron: hard-deletes sessions users removed
                                    and purges their ephemeral files.{' '}
                                    <span className="text-content-secondary font-medium">Preserved results (the library) are kept.</span>{' '}
                                    Use this while the Vercel cron is unavailable. Processed in batches, so a
                                    large backlog is cleaned across several automatic passes.
                                </p>
                            </div>
                            <button
                                onClick={() => setConfirmOpen(true)}
                                disabled={cleaning || pending === 0}
                                className="shrink-0 flex items-center gap-2 px-5 py-2.5 bg-accent-error/90 hover:bg-accent-error text-white text-[10px] font-black uppercase tracking-widest rounded-xl shadow-lg shadow-accent-error/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {cleaning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                {cleaning ? 'Cleaning…' : pending === 0 ? 'Nothing to clean' : `Clean ${pending.toLocaleString()} now`}
                            </button>
                        </div>

                        {cleaning && cleanProgress && (
                            <div className="text-xs font-medium text-content-secondary tabular-nums flex items-center gap-2">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                Cleaned {cleanProgress.cleaned.toLocaleString()}
                                {cleanProgress.remaining != null ? ` · ${cleanProgress.remaining.toLocaleString()} remaining` : ''}
                            </div>
                        )}
                        {cleanDone && <p className="text-xs font-medium text-emerald-400">{cleanDone}</p>}
                        {cleanError && (
                            <p className="text-xs font-medium text-red-400 flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 shrink-0" /> {cleanError}
                            </p>
                        )}
                    </div>
                </section>
            </main>

            <ConfirmationModal
                isOpen={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={runCleanup}
                title="Clean soft-deleted sessions?"
                message={`This permanently hard-deletes ${pending.toLocaleString()} soft-deleted session(s) and purges their ephemeral files. Preserved results (the library) are kept. This cannot be undone.`}
                confirmText="Clean now"
                variant="danger"
            />
        </div>
    );
}

function StatCard({ icon, label, value, accent, danger }: { icon: React.ReactNode; label: string; value: number | string | undefined; accent?: boolean; danger?: boolean }) {
    const display = value === undefined ? '—' : typeof value === 'number' ? value.toLocaleString() : value;
    return (
        <div className={`rounded-2xl border p-5 ${accent ? 'bg-accent-primary/5 border-accent-primary/20' : danger ? 'bg-red-500/5 border-red-500/20' : 'bg-white/5 border-white/10'}`}>
            <div className={`flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest opacity-80 ${accent ? 'text-accent-primary' : danger ? 'text-red-400' : 'text-content-tertiary'}`}>
                {icon} {label}
            </div>
            <div className="mt-2 text-2xl font-black text-content-primary tabular-nums">{display}</div>
        </div>
    );
}
