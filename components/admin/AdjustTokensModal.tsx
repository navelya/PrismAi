'use client';

import React, { useEffect, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X, Coins, AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { adminUsersApi } from '@/lib/api/admin-users';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    userId: string;
    userEmail: string | null;
    currentBalance: number;
    onApplied: (newBalance: number) => void;
}

export function AdjustTokensModal({ isOpen, onClose, userId, userEmail, currentBalance, onApplied }: Props) {
    const [amount, setAmount] = useState<string>('');
    const [note, setNote] = useState<string>('Prisfol Gift');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            setAmount('');
            setNote('Prisfol Gift');
            setError(null);
            setSubmitting(false);
        }
    }, [isOpen]);

    const parsed = Number(amount);
    const valid = Number.isFinite(parsed) && parsed !== 0;
    const projected = currentBalance + (valid ? parsed : 0);
    const wouldGoNegative = valid && parsed < 0 && projected < 0;

    const handleSubmit = async () => {
        if (!valid || wouldGoNegative) return;
        setSubmitting(true);
        setError(null);
        try {
            const result = await adminUsersApi.adjustTokens(userId, parsed, note.trim() || undefined);
            onApplied(result.new_balance);
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to adjust tokens');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <RadixDialog.Root open={isOpen} onOpenChange={(open) => !open && !submitting && onClose()}>
            <RadixDialog.Portal>
                <RadixDialog.Overlay className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
                <RadixDialog.Content
                    className="fixed left-[50%] top-[50%] z-[60] w-full max-w-md translate-x-[-50%] translate-y-[-50%] p-7 m-4 bg-bg-primary/80 backdrop-blur-2xl rounded-2xl shadow-premium border border-white/10 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
                >
                    <RadixDialog.Close asChild>
                        <button
                            disabled={submitting}
                            className="absolute top-4 right-4 p-2 text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary rounded-full transition-colors disabled:opacity-40"
                            aria-label="Close"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </RadixDialog.Close>

                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-11 h-11 rounded-xl bg-accent-primary/10 border border-accent-primary/20 flex items-center justify-center">
                            <Coins className="w-5 h-5 text-accent-primary" />
                        </div>
                        <div className="min-w-0">
                            <RadixDialog.Title className="text-lg font-black text-content-primary uppercase tracking-tighter">
                                Adjust Tokens
                            </RadixDialog.Title>
                            <RadixDialog.Description className="text-[11px] text-content-tertiary truncate font-medium">
                                {userEmail || userId}
                            </RadixDialog.Description>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                            <div>
                                <div className="text-[9px] font-black uppercase tracking-widest text-content-tertiary opacity-60">Current</div>
                                <div className="text-sm font-bold text-content-primary mt-0.5 tabular-nums">{currentBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                            </div>
                            <div>
                                <div className="text-[9px] font-black uppercase tracking-widest text-content-tertiary opacity-60">After</div>
                                <div className={`text-sm font-bold mt-0.5 tabular-nums ${wouldGoNegative ? 'text-red-400' : valid && parsed > 0 ? 'text-green-400' : valid && parsed < 0 ? 'text-yellow-400' : 'text-content-secondary'}`}>
                                    {projected.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                </div>
                            </div>
                        </div>

                        <Input
                            label="Amount (positive grants, negative deducts)"
                            type="number"
                            step="any"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="e.g. 500 or -100"
                            disabled={submitting}
                        />

                        <Input
                            label="Note (visible in user billing)"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Prisfol Gift"
                            disabled={submitting}
                            maxLength={120}
                        />

                        <div className="flex flex-wrap gap-2">
                            {[100, 500, 1000, -100].map(preset => (
                                <button
                                    key={preset}
                                    type="button"
                                    disabled={submitting}
                                    onClick={() => setAmount(String(preset))}
                                    className={`px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-lg border transition-all ${preset > 0
                                        ? 'bg-green-500/5 border-green-500/20 text-green-400 hover:bg-green-500/10'
                                        : 'bg-red-500/5 border-red-500/20 text-red-400 hover:bg-red-500/10'}`}
                                >
                                    {preset > 0 ? '+' : ''}{preset}
                                </button>
                            ))}
                        </div>

                        {error && (
                            <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/5 border border-red-500/20 text-red-400">
                                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                <p className="text-xs font-medium leading-relaxed">{error}</p>
                            </div>
                        )}

                        {wouldGoNegative && (
                            <p className="text-[11px] text-red-400 font-medium px-1">Deduction would drive balance below zero. Reduce the amount.</p>
                        )}

                        <div className="flex items-center justify-end gap-3 pt-2">
                            <button
                                onClick={onClose}
                                disabled={submitting}
                                className="px-4 py-2 text-xs font-bold text-content-secondary hover:text-content-primary hover:bg-surface-tertiary rounded-lg transition-colors disabled:opacity-40"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={submitting || !valid || wouldGoNegative}
                                className="px-5 py-2.5 text-[10px] font-black uppercase tracking-widest bg-accent-primary text-white rounded-lg shadow-lg disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-all flex items-center gap-2"
                            >
                                {submitting && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                                Apply
                            </button>
                        </div>
                    </div>
                </RadixDialog.Content>
            </RadixDialog.Portal>
        </RadixDialog.Root>
    );
}
