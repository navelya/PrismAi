'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ArrowLeft,
    Users,
    Search,
    Crown,
    Ban,
    Coins,
    Download,
    Loader2,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    ChevronUp,
    Activity,
    AlertCircle,
} from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
    adminUsersApi,
    type AdminUserListRow,
    type AdminUsersStats,
    type AdminUserStatusFilter,
    type AdminUserSortKey,
} from '@/lib/api/admin-users';
import { UserDetailDrawer } from './UserDetailDrawer';
import { createClient } from '@/lib/supabase/client';

const PAGE_SIZE = 25;

const STATUS_OPTIONS: { id: AdminUserStatusFilter; label: string }[] = [
    { id: 'all', label: 'All Users' },
    { id: 'active', label: 'Active' },
    { id: 'banned', label: 'Banned' },
    { id: 'admin', label: 'Admins' },
    { id: 'low_balance', label: 'Low Balance (<50)' },
];

interface Props {
    onMobileBack: () => void;
}

function isBanned(banned_until: string | null): boolean {
    if (!banned_until) return false;
    const t = Date.parse(banned_until);
    if (Number.isNaN(t)) return false;
    return t > Date.now();
}

function formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function timeAgo(iso: string | null): string {
    if (!iso) return 'Never';
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return 'Never';
    const diff = Date.now() - t;
    if (diff < 60_000) return 'Just now';
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return formatDate(iso);
}

export function UsersAdminContent({ onMobileBack }: Props) {
    const [currentAdminId, setCurrentAdminId] = useState<string>('');
    const [users, setUsers] = useState<AdminUserListRow[]>([]);
    const [total, setTotal] = useState(0);
    const [stats, setStats] = useState<AdminUsersStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [q, setQ] = useState('');
    const [debouncedQ, setDebouncedQ] = useState('');
    const [status, setStatus] = useState<AdminUserStatusFilter>('all');
    const [plan, setPlan] = useState<string>('all');
    const [sort, setSort] = useState<AdminUserSortKey>('created_at');
    const [dir, setDir] = useState<'asc' | 'desc'>('desc');
    const [page, setPage] = useState(0);

    const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

    const [exporting, setExporting] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedQ(q), 250);
        return () => clearTimeout(t);
    }, [q]);

    useEffect(() => {
        let cancelled = false;
        createClient().auth.getUser().then((res: { data: { user: { id: string } | null } }) => {
            if (!cancelled) setCurrentAdminId(res.data.user?.id ?? '');
        });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => { setPage(0); }, [debouncedQ, status, plan, sort, dir]);

    const loadUsers = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await adminUsersApi.list({
                q: debouncedQ || undefined,
                status,
                plan,
                sort,
                dir,
                page,
                pageSize: PAGE_SIZE,
            });
            setUsers(res.users);
            setTotal(res.total);
        } catch (err: any) {
            setError(err.message || 'Failed to load users');
        } finally {
            setLoading(false);
        }
    }, [debouncedQ, status, plan, sort, dir, page]);

    const loadStats = useCallback(async () => {
        try {
            const s = await adminUsersApi.stats();
            setStats(s);
        } catch (err) {
            // non-fatal
            console.warn('[Users] stats fetch failed', err);
        }
    }, []);

    useEffect(() => {
        loadUsers();
    }, [loadUsers]);

    useEffect(() => {
        loadStats();
    }, [loadStats]);

    const toggleSort = (key: AdminUserSortKey) => {
        if (sort === key) {
            setDir(d => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSort(key);
            setDir(key === 'email' || key === 'plan_id' ? 'asc' : 'desc');
        }
    };

    const handleExport = async () => {
        setExporting(true);
        try {
            const url = adminUsersApi.exportCsvUrl({
                q: debouncedQ || undefined,
                status,
                plan,
                sort,
                dir,
            });
            const res = await fetch(url);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error((body as any)?.error || `Export failed (${res.status})`);
            }
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = `prismai-users-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(objectUrl);
        } catch (err: any) {
            setError(err.message || 'Failed to export');
        } finally {
            setExporting(false);
        }
    };

    const planOptions = useMemo(() => {
        const seen = new Set<string>();
        for (const u of users) if (u.plan_id) seen.add(u.plan_id);
        return [
            { id: 'all', display_name: 'All Plans' },
            ...Array.from(seen).sort().map(id => ({ id, display_name: id })),
        ];
    }, [users]);

    const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

    const refresh = () => { loadUsers(); loadStats(); };

    return (
        <div className="min-h-full flex flex-col">
            <div className="md:hidden px-8 pt-6">
                <button
                    onClick={onMobileBack}
                    className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-content-tertiary hover:text-content-primary transition-all"
                >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Return to Admin</span>
                </button>
            </div>

            <header className="sticky top-0 z-30 bg-surface-primary/60 backdrop-blur-xl border-b border-white/5 px-8 py-5 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-2xl">
                <div className="flex items-center gap-5">
                    <div className="w-8 h-8 rounded-xl bg-accent-primary/10 flex items-center justify-center border border-accent-primary/20 shadow-inner">
                        <Users className="w-4 h-4 text-accent-primary" />
                    </div>
                    <div>
                        <h1 className="text-xl font-black text-content-primary uppercase tracking-tighter">Users</h1>
                        <p className="text-[10px] font-bold text-content-tertiary uppercase tracking-widest mt-0.5 opacity-60">Account · Tokens · Permissions</p>
                    </div>
                </div>
                <button
                    onClick={handleExport}
                    disabled={exporting}
                    className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-content-tertiary hover:text-content-primary text-[10px] font-bold uppercase tracking-widest rounded-xl transition-all disabled:opacity-40"
                >
                    {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    Export CSV
                </button>
            </header>

            <main className="flex-1 max-w-7xl mx-auto w-full p-8 md:p-12 space-y-6">
                {/* Stats strip */}
                <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard icon={<Users className="w-3.5 h-3.5" />} label="Total Users" value={stats?.total} />
                    <StatCard icon={<Activity className="w-3.5 h-3.5" />} label="Active 7d" value={stats?.active7d} accent />
                    <StatCard icon={<Ban className="w-3.5 h-3.5" />} label="Banned" value={stats?.banned} danger />
                    <StatCard icon={<Coins className="w-3.5 h-3.5" />} label="Tokens Issued" value={stats ? Math.round(stats.totalTokensIssued).toLocaleString() : undefined} />
                </section>

                {/* Filters */}
                <section className="flex flex-col md:flex-row gap-4 bg-white/5 p-5 rounded-3xl border border-white/10 backdrop-blur-md shadow-xl">
                    <div className="relative flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-content-tertiary" />
                        <input
                            type="text"
                            placeholder="Search by email or user id..."
                            value={q}
                            onChange={e => setQ(e.target.value)}
                            className="w-full pl-11 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-xs font-medium focus:outline-none focus:border-accent-primary/50 transition-all"
                        />
                    </div>
                    <div className="flex gap-3">
                        <Select
                            value={status}
                            className="min-w-[160px]"
                            options={STATUS_OPTIONS.map(o => ({ id: o.id, display_name: o.label }))}
                            onChange={e => setStatus(e.target.value as AdminUserStatusFilter)}
                        />
                        <Select
                            value={plan}
                            className="min-w-[140px]"
                            options={planOptions}
                            onChange={e => setPlan(e.target.value)}
                        />
                    </div>
                </section>

                {error && (
                    <div className="p-4 rounded-2xl bg-red-500/5 border border-red-500/20 text-red-400 flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                        <p className="text-sm font-medium">{error}</p>
                    </div>
                )}

                {/* Table */}
                <section className="bg-white/5 border border-white/10 rounded-3xl overflow-hidden backdrop-blur-md">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                            <thead>
                                <tr className="border-b border-white/5 bg-white/5">
                                    <SortHeader label="Email" active={sort === 'email'} dir={dir} onClick={() => toggleSort('email')} />
                                    <SortHeader label="Plan" active={sort === 'plan_id'} dir={dir} onClick={() => toggleSort('plan_id')} />
                                    <SortHeader label="Balance" active={sort === 'token_balance'} dir={dir} onClick={() => toggleSort('token_balance')} align="right" />
                                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-content-tertiary">Status</th>
                                    <SortHeader label="Joined" active={sort === 'created_at'} dir={dir} onClick={() => toggleSort('created_at')} />
                                    <SortHeader label="Last Seen" active={sort === 'last_sign_in_at'} dir={dir} onClick={() => toggleSort('last_sign_in_at')} />
                                </tr>
                            </thead>
                            <tbody>
                                {loading && users.length === 0 ? (
                                    <tr><td colSpan={6} className="px-4 py-16 text-center text-content-tertiary"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                                ) : users.length === 0 ? (
                                    <tr><td colSpan={6} className="px-4 py-16 text-center">
                                        <p className="text-content-tertiary text-xs font-bold uppercase tracking-widest">No users match these filters.</p>
                                    </td></tr>
                                ) : users.map(u => {
                                    const banned = isBanned(u.banned_until);
                                    const isSelf = u.id === currentAdminId;
                                    return (
                                        <tr
                                            key={u.id}
                                            onClick={() => setSelectedUserId(u.id)}
                                            className="border-b border-white/5 last:border-b-0 hover:bg-white/5 cursor-pointer transition-colors"
                                        >
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                                                        {u.avatar_url ? (
                                                            // eslint-disable-next-line @next/next/no-img-element
                                                            <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                                                        ) : (
                                                            <span className="text-content-tertiary text-[10px] font-bold uppercase">{(u.email ?? '?').slice(0, 1)}</span>
                                                        )}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-bold text-content-primary truncate max-w-[260px]">{u.email ?? '(no email)'}</p>
                                                        <p className="text-[9px] font-mono text-content-tertiary opacity-50 truncate max-w-[260px]">{u.id}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-content-secondary uppercase text-[10px] font-bold tracking-wider">{u.plan_id ?? '—'}</td>
                                            <td className="px-4 py-3 text-right tabular-nums font-bold text-content-primary">
                                                {Number(u.token_balance).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex flex-wrap gap-1">
                                                    {isSelf && (
                                                        <span className="px-1.5 py-0.5 bg-accent-primary/10 border border-accent-primary/20 text-accent-primary text-[8px] font-black uppercase tracking-widest rounded-md">You</span>
                                                    )}
                                                    {u.is_admin && (
                                                        <span className="px-1.5 py-0.5 bg-accent-primary/10 border border-accent-primary/20 text-accent-primary text-[8px] font-black uppercase tracking-widest rounded-md inline-flex items-center gap-1">
                                                            <Crown className="w-2.5 h-2.5" />Admin
                                                        </span>
                                                    )}
                                                    {banned ? (
                                                        <span className="px-1.5 py-0.5 bg-red-500/10 border border-red-500/20 text-red-400 text-[8px] font-black uppercase tracking-widest rounded-md inline-flex items-center gap-1">
                                                            <Ban className="w-2.5 h-2.5" />Banned
                                                        </span>
                                                    ) : (
                                                        <span className="px-1.5 py-0.5 bg-green-500/10 border border-green-500/20 text-green-400 text-[8px] font-black uppercase tracking-widest rounded-md">Active</span>
                                                    )}
                                                    {Number(u.token_balance) < 50 && !banned && (
                                                        <span className="px-1.5 py-0.5 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-[8px] font-black uppercase tracking-widest rounded-md">Low</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-content-tertiary text-[11px]">{formatDate(u.created_at)}</td>
                                            <td className="px-4 py-3 text-content-tertiary text-[11px]">{timeAgo(u.last_sign_in_at)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    <div className="flex items-center justify-between px-5 py-3 border-t border-white/5 bg-white/5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-content-tertiary opacity-60">
                            {total === 0 ? 'No results' : `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setPage(p => Math.max(0, p - 1))}
                                disabled={page === 0 || loading}
                                className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-content-tertiary hover:text-content-primary disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                            >
                                <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-[10px] font-black uppercase tracking-widest text-content-tertiary tabular-nums">
                                Page {page + 1} of {lastPage + 1}
                            </span>
                            <button
                                onClick={() => setPage(p => Math.min(lastPage, p + 1))}
                                disabled={page >= lastPage || loading}
                                className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-content-tertiary hover:text-content-primary disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                            >
                                <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                </section>
            </main>

            <UserDetailDrawer
                userId={selectedUserId}
                currentAdminId={currentAdminId}
                onClose={() => setSelectedUserId(null)}
                onMutated={refresh}
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

function SortHeader({ label, active, dir, onClick, align = 'left' }: { label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void; align?: 'left' | 'right' }) {
    return (
        <th
            onClick={onClick}
            className={`px-4 py-3 text-[10px] font-black uppercase tracking-widest cursor-pointer select-none ${active ? 'text-content-primary' : 'text-content-tertiary hover:text-content-secondary'} ${align === 'right' ? 'text-right' : ''}`}
        >
            <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
                {label}
                {active && (dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
            </span>
        </th>
    );
}
