'use client';
import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { collaboratorsApi } from '@/lib/api/client';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';

interface ShareDialogProps {
    canvasId: string;
    isOwner: boolean;
    onClose: () => void;
}

interface Collab { id: string; invited_email: string; role: 'editor' | 'viewer'; user_id: string | null; }

const ROLE_OPTIONS = [
    { id: 'editor', display_name: 'Editor' },
    { id: 'viewer', display_name: 'Viewer' },
];

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
        <Modal open onOpenChange={(open) => !open && onClose()} size="md">
            <Modal.Header>
                <Modal.Title className="text-sm font-semibold">Share workflow</Modal.Title>
                <Modal.Description className="sr-only">Invite people to collaborate on this workflow.</Modal.Description>
            </Modal.Header>

            <Modal.Body className="pt-4">
                {isOwner && (
                    <div className="flex items-end gap-2 mb-4">
                        <Input
                            variant="minimal"
                            type="email"
                            value={email}
                            placeholder="teammate@email.com"
                            onChange={(e) => setEmail(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') invite(); }}
                        />
                        <div className="w-28 shrink-0">
                            <Select
                                variant="minimal"
                                value={role}
                                options={ROLE_OPTIONS}
                                onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
                            />
                        </div>
                        <button
                            disabled={busy}
                            onClick={invite}
                            className="h-8 shrink-0 bg-accent-primary hover:bg-accent-primary/90 text-white rounded-lg px-3 text-xs font-semibold disabled:opacity-50 transition-colors"
                        >
                            Invite
                        </button>
                    </div>
                )}
                {warning && <p className="text-xs text-amber-500 mb-2">{warning}</p>}

                <ul className="space-y-1 max-h-64 overflow-auto">
                    {rows.map(c => (
                        <li key={c.id} className="flex items-center justify-between gap-2 text-sm py-1">
                            <span className="truncate text-content-primary">
                                {c.invited_email}
                                {!c.user_id && <span className="ml-2 text-[10px] text-content-tertiary">Pending</span>}
                            </span>
                            {isOwner ? (
                                <span className="flex items-center gap-2 shrink-0">
                                    <div className="w-24">
                                        <Select
                                            variant="minimal"
                                            value={c.role}
                                            options={ROLE_OPTIONS}
                                            onChange={async (e) => { await collaboratorsApi.setRole(canvasId, c.id, e.target.value as 'editor' | 'viewer'); refresh(); }}
                                        />
                                    </div>
                                    <button
                                        aria-label="Remove collaborator"
                                        onClick={async () => { await collaboratorsApi.remove(canvasId, c.id); refresh(); }}
                                        className="text-content-tertiary hover:text-red-500 transition-colors"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </span>
                            ) : (
                                <span className="text-xs text-content-tertiary capitalize">{c.role}</span>
                            )}
                        </li>
                    ))}
                    {rows.length === 0 && <li className="text-xs text-content-tertiary">No collaborators yet.</li>}
                </ul>
            </Modal.Body>
        </Modal>
    );
}
