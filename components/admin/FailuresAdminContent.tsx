'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
    ArrowLeft,
    AlertTriangle,
    AlertCircle,
    Loader2,
    RefreshCw,
    Search,
    Users,
    Cpu,
    Bug,
    X,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';
import { adminFailuresApi, type AdminFailure, type AdminFailuresResponse } from '@/lib/api/admin-failures';

interface Props {
    onMobileBack: () => void;
}

const DAY_RANGES = [
    { value: 1, label: '24h' },
    { value: 7, label: '7d' },
    { value: 30, label: '30d' },
    { value: 90, label: '90d' },
];

export function FailuresAdminContent({ onMobileBack }: Props) {
    const [data, setData] = useState<AdminFailuresResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [days, setDays] = useState(7);
    const [searchInput, setSearchInput] = useState('');
    const [q, setQ] = useState('');
    const [page, setPage] = useState(0);

    const [selected, setSelected] = useState<AdminFailure | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setData(await adminFailuresApi.list({ days, q, page, pageSize: 50 }));
        } catch (err: any) {
            setError(err.message || 'Failed to load failures');
        } finally {
            setLoading(false);
        }
    }, [days, q, page]);

    useEffect(() => { load(); }, [load]);

    // Debounce free-text search into the committed query.
    useEffect(() => {
        const t = setTimeout(() => { setPage(0); setQ(searchInput.trim()); }, 350);
        return () => clearTimeout(t);
    }, [searchInput]);

    const summary = data?.summary;
    const failures = data?.failures ?? [];
    const total = data?.total ?? 0;
    const pageSize = data?.pageSize ?? 50;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

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
                    <div className="w-8 h-8 rounded-xl bg-red-500/10 flex items-center justify-center border border-red-500/20 shadow-inner">
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                    </div>
                    <div>
                        <h1 className="text-xl font-black text-content-primary uppercase tracking-tighter">Failures</h1>
                        <p className="text-[10px] font-bold text-content-tertiary uppercase tracking-widest mt-0.5 opacity-60">Failed generations · Diagnostics</p>
                    </div>
                </div>
                <button
                    onClick={load}
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

                {/* Summary */}
                <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard icon={<Bug className="w-3.5 h-3.5" />} label="Total Failures" value={summary?.totalFailures} danger={(summary?.totalFailures ?? 0) > 0} />
                    <StatCard icon={<Users className="w-3.5 h-3.5" />} label="Users Affected" value={summary?.usersAffected} />
                    <StatCard icon={<AlertCircle className="w-3.5 h-3.5" />} label="Top Error" value={summary?.topError ?? '—'} text />
                    <StatCard icon={<Cpu className="w-3.5 h-3.5" />} label="Top Model" value={summary?.topModel ?? '—'} text />
                </section>

                {/* Filters */}
                <section className="flex flex-col md:flex-row gap-4 bg-white/5 p-4 rounded-2xl border border-white/10 backdrop-blur-md">
                    <div className="relative flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-content-tertiary" />
                        <input
                            type="text"
                            placeholder="Search error, email, model, node type..."
                            value={searchInput}
                            onChange={e => setSearchInput(e.target.value)}
                            className="w-full pl-11 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-xs font-medium focus:outline-none focus:border-accent-primary/50 transition-all"
                        />
                    </div>
                    <div className="flex items-center bg-white/5 p-1 rounded-xl border border-white/10 shrink-0">
                        {DAY_RANGES.map(r => (
                            <button
                                key={r.value}
                                onClick={() => { setPage(0); setDays(r.value); }}
                                className={`px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${days === r.value
                                    ? 'bg-white/10 text-content-primary ring-1 ring-white/20'
                                    : 'text-content-tertiary hover:text-content-secondary'}`}
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>
                </section>

                {data?.capped && (
                    <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400/80 flex items-center gap-2">
                        <AlertCircle className="w-3.5 h-3.5" />
                        Showing the {pageSize === 50 ? 'most recent 500' : ''} failures in this window — narrow the range or search to see older ones.
                    </p>
                )}

                {/* Table */}
                <section className="bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
                    <div className="grid grid-cols-[140px_1fr_1fr_1.5fr] gap-4 px-5 py-3 border-b border-white/10 text-[9px] font-black uppercase tracking-widest text-content-tertiary">
                        <span>Time</span>
                        <span>User</span>
                        <span>Node / Model</span>
                        <span>Error</span>
                    </div>

                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-24 gap-4">
                            <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-content-tertiary">Loading failures...</p>
                        </div>
                    ) : failures.length === 0 ? (
                        <div className="text-center py-24">
                            <AlertTriangle className="w-12 h-12 text-content-tertiary opacity-20 mx-auto mb-4" />
                            <p className="text-content-tertiary text-xs font-bold uppercase tracking-widest">
                                No failures in this window {q ? 'matching your search' : ''}.
                            </p>
                        </div>
                    ) : (
                        failures.map(f => (
                            <button
                                key={f.id}
                                onClick={() => setSelected(f)}
                                className="w-full grid grid-cols-[140px_1fr_1fr_1.5fr] gap-4 px-5 py-3.5 border-b border-white/5 last:border-0 text-left hover:bg-white/5 transition-colors items-center"
                            >
                                <span className="text-[11px] font-medium text-content-tertiary tabular-nums">{formatTime(f.failedAt)}</span>
                                <span className="text-xs font-medium text-content-secondary truncate" title={f.user.email ?? f.user.id ?? ''}>
                                    {f.user.email ?? (f.user.id ? `${f.user.id.slice(0, 8)}…` : 'Unknown')}
                                </span>
                                <span className="text-xs text-content-secondary truncate">
                                    <span className="text-content-primary font-semibold">{f.request.nodeType}</span>
                                    {f.request.model ? <span className="text-content-tertiary"> · {f.request.model}</span> : null}
                                </span>
                                <span className="text-xs text-red-300/90 truncate font-medium" title={f.error}>{f.error}</span>
                            </button>
                        ))
                    )}
                </section>

                {/* Pagination */}
                {total > pageSize && (
                    <div className="flex items-center justify-between">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-content-tertiary">
                            {total.toLocaleString()} failures · page {page + 1} of {totalPages}
                        </p>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setPage(p => Math.max(0, p - 1))}
                                disabled={page === 0 || loading}
                                className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-content-tertiary hover:text-content-primary transition-all disabled:opacity-30"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => setPage(p => (p + 1 < totalPages ? p + 1 : p))}
                                disabled={page + 1 >= totalPages || loading}
                                className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-content-tertiary hover:text-content-primary transition-all disabled:opacity-30"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}
            </main>

            {selected && <FailureDrawer failure={selected} onClose={() => setSelected(null)} />}
        </div>
    );
}

function FailureDrawer({ failure, onClose }: { failure: AdminFailure; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in" onClick={onClose} />
            <div className="relative w-full max-w-xl h-full bg-surface-primary border-l border-white/10 shadow-2xl overflow-y-auto custom-scrollbar animate-in slide-in-from-right duration-200">
                <header className="sticky top-0 z-10 bg-surface-primary/80 backdrop-blur-xl border-b border-white/10 px-6 py-5 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-red-500/10 flex items-center justify-center border border-red-500/20 shrink-0">
                            <AlertTriangle className="w-4 h-4 text-red-400" />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-sm font-black text-content-primary uppercase tracking-tight truncate">{failure.request.nodeType}</h2>
                            <p className="text-[10px] font-bold text-content-tertiary uppercase tracking-widest truncate">{formatTime(failure.failedAt)}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-content-tertiary hover:text-content-primary hover:bg-white/5 rounded-lg transition-all shrink-0">
                        <X className="w-5 h-5" />
                    </button>
                </header>

                <div className="p-6 space-y-6">
                    {/* Error */}
                    <Field label="Error">
                        <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/20">
                            <p className="text-xs text-red-300 font-mono leading-relaxed whitespace-pre-wrap break-words">{failure.error}</p>
                        </div>
                    </Field>

                    {/* Who */}
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="User">
                            <p className="text-xs font-medium text-content-secondary break-all">{failure.user.email ?? failure.user.id ?? 'Unknown'}</p>
                        </Field>
                        <Field label="Session">
                            <p className="text-xs font-medium text-content-secondary break-words">{failure.sessionTitle ?? failure.sessionId ?? '—'}</p>
                        </Field>
                    </div>

                    {/* Request */}
                    <Field label="Request">
                        <div className="space-y-2">
                            {failure.request.model && <KV k="Model" v={failure.request.model} />}
                            {failure.request.label && <KV k="Label" v={failure.request.label} />}
                            {failure.resultType && <KV k="Output type" v={failure.resultType} />}
                            {failure.request.prompt && (
                                <div>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-content-tertiary mb-1">Prompt</p>
                                    <p className="text-xs text-content-secondary leading-relaxed whitespace-pre-wrap break-words bg-white/5 rounded-lg p-3 border border-white/10">{failure.request.prompt}</p>
                                </div>
                            )}
                        </div>
                    </Field>

                    {/* Raw config */}
                    <Field label="Node config (raw)">
                        <pre className="text-[10px] text-content-tertiary font-mono leading-relaxed bg-black/30 rounded-xl p-4 border border-white/10 overflow-x-auto custom-scrollbar">
                            {JSON.stringify(failure.request.config ?? {}, null, 2)}
                        </pre>
                    </Field>

                    {/* IDs */}
                    <Field label="References">
                        <div className="space-y-1.5">
                            <KV k="Execution" v={failure.executionId} mono />
                            <KV k="Node" v={failure.nodeId} mono />
                            {failure.sessionId && <KV k="Session ID" v={failure.sessionId} mono />}
                        </div>
                    </Field>
                </div>
            </div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-content-tertiary">{label}</p>
            {children}
        </div>
    );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
    return (
        <div className="flex items-baseline gap-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-content-tertiary shrink-0 w-24">{k}</span>
            <span className={`text-xs text-content-secondary break-all ${mono ? 'font-mono' : 'font-medium'}`}>{v}</span>
        </div>
    );
}

function StatCard({ icon, label, value, danger, text }: { icon: React.ReactNode; label: string; value: number | string | undefined; danger?: boolean; text?: boolean }) {
    const display = value === undefined ? '—' : typeof value === 'number' ? value.toLocaleString() : value;
    return (
        <div className={`rounded-2xl border p-5 ${danger ? 'bg-red-500/5 border-red-500/20' : 'bg-white/5 border-white/10'}`}>
            <div className={`flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest opacity-80 ${danger ? 'text-red-400' : 'text-content-tertiary'}`}>
                {icon} {label}
            </div>
            <div
                className={`mt-2 font-black text-content-primary ${text ? 'text-sm leading-snug line-clamp-2 break-words' : 'text-2xl tabular-nums'}`}
                title={text && typeof display === 'string' ? display : undefined}
            >
                {display}
            </div>
        </div>
    );
}

function formatTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
