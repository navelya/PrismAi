'use client';
import React, { useEffect, useState } from 'react';
import { collaboratorsApi } from '@/lib/api/client';

interface ShareDialogProps {
    canvasId: string;
    isOwner: boolean;
    onClose: () => void;
}

interface Collab { id: string; invited_email: string; role: 'editor' | 'viewer'; user_id: string | null; }

export function ShareDialog({ canvasId, isOwner, onClose }: ShareDialogProps) {
    const [rows, setRows] = useState<Collab[]>([]);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<'editor' | 'viewer'>('editor');
    const [busy, setBusy] = useState(false);
    const [warning, setWarning] = useState<string | null>(null);

    const refresh = () => collaboratorsApi.list(canvasId).then(r => setRows(r.collaborators || []));
    useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [canvasId]);

    const invite = async () => {
        if (!email.trim()) return;
        setBusy(true); setWarning(null);
        try {
            const res = await collaboratorsApi.invite(canvasId, email.trim(), role);
            if (res && res.emailSent === false) setWarning('Invite saved, but the email failed to send.');
            setEmail('');
            await refresh();
        } catch (e: unknown) {
            setWarning((e instanceof Error ? e.message : null) || 'Failed to invite');
        } finally { setBusy(false); }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
            <div className="bg-surface-elevated border border-stroke-subtle rounded-xl p-5 w-[420px] max-w-[92vw]"
                 onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-content-primary">Share workflow</h3>
                    <button onClick={onClose} className="text-content-tertiary hover:text-content-primary">✕</button>
                </div>

                {isOwner && (
                    <div className="flex gap-2 mb-3">
                        <input value={email} onChange={e => setEmail(e.target.value)} type="email"
                               placeholder="teammate@email.com"
                               className="flex-1 bg-surface-primary border border-stroke-subtle rounded-lg px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary focus:outline-none" />
                        <select value={role} onChange={e => setRole(e.target.value as 'editor' | 'viewer')}
                                className="bg-surface-primary border border-stroke-subtle rounded-lg px-2 text-sm text-content-primary">
                            <option value="editor">Editor</option>
                            <option value="viewer">Viewer</option>
                        </select>
                        <button disabled={busy} onClick={invite}
                                className="bg-accent-primary hover:bg-accent-primary/90 text-white rounded-lg px-3 text-sm disabled:opacity-50 transition-colors">
                            Invite
                        </button>
                    </div>
                )}
                {warning && <p className="text-xs text-amber-500 mb-2">{warning}</p>}

                <ul className="space-y-1 max-h-64 overflow-auto">
                    {rows.map(c => (
                        <li key={c.id} className="flex items-center justify-between text-sm py-1">
                            <span className="truncate text-content-primary">
                                {c.invited_email}
                                {!c.user_id && <span className="ml-2 text-[10px] text-content-tertiary">Pending</span>}
                            </span>
                            {isOwner ? (
                                <span className="flex items-center gap-2">
                                    <select value={c.role}
                                            onChange={async e => { await collaboratorsApi.setRole(canvasId, c.id, e.target.value as 'editor' | 'viewer'); refresh(); }}
                                            className="bg-surface-primary border border-stroke-subtle rounded px-1 text-xs text-content-primary">
                                        <option value="editor">Editor</option>
                                        <option value="viewer">Viewer</option>
                                    </select>
                                    <button onClick={async () => { await collaboratorsApi.remove(canvasId, c.id); refresh(); }}
                                            className="text-content-tertiary hover:text-red-500 transition-colors">✕</button>
                                </span>
                            ) : (
                                <span className="text-xs text-content-tertiary capitalize">{c.role}</span>
                            )}
                        </li>
                    ))}
                    {rows.length === 0 && <li className="text-xs text-content-tertiary">No collaborators yet.</li>}
                </ul>
            </div>
        </div>
    );
}
