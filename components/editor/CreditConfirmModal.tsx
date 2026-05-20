import React from 'react';
import { X, Coins, AlertTriangle } from 'lucide-react';
import { useTokenBalance } from '@/lib/billing/use-balance';
import { formatCredits } from '@/lib/billing/cost';

interface CreditConfirmModalProps {
    isOpen: boolean;
    cost: number;
    nodeCount: number;
    mode: 'solo' | 'chain' | 'ab_test' | 'all' | 'selection';
    onConfirm: () => void;
    onCancel: () => void;
}

export default function CreditConfirmModal({
    isOpen,
    cost,
    nodeCount,
    mode,
    onConfirm,
    onCancel,
}: CreditConfirmModalProps) {
    const { balance, loading: balanceLoading } = useTokenBalance();

    if (!isOpen) return null;

    const titles = {
        'all': 'Run Entire Canvas',
        'solo': 'Run Selected Node',
        'chain': 'Run Node & Downstream',
        'ab_test': 'Run A/B Test',
        'selection': 'Run Selected Nodes',
    };

    const hasEnough = balance !== null && balance >= cost;
    const shortfall = balance !== null ? Math.max(0, cost - balance) : 0;
    const confirmDisabled = balanceLoading || !hasEnough;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-surface-primary rounded-xl shadow-2xl border border-surface-divider p-6 max-w-sm w-full animate-in fade-in zoom-in-95 duration-200">
                <div className="flex justify-between items-start mb-4">
                    <h2 className="text-xl font-bold font-display text-content-primary">
                        {titles[mode]}
                    </h2>
                    <button
                        onClick={onCancel}
                        className="text-content-secondary hover:text-content-primary transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="space-y-4">
                    <p className="text-content-secondary text-sm">
                        This action will execute <span className="font-semibold text-content-primary">{nodeCount}</span> generation{nodeCount !== 1 && 's'} and consume credits.
                    </p>

                    <div className="bg-surface-elevated rounded-lg p-4 border border-surface-divider space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-content-secondary font-medium uppercase tracking-wider text-xs">Total Cost</span>
                            <div className="flex items-center gap-1.5 text-lg font-bold text-accent-primary">
                                <Coins className="w-5 h-5" />
                                <span>{formatCredits(cost)} Credits</span>
                            </div>
                        </div>
                        <div className="flex items-center justify-between border-t border-surface-divider pt-3">
                            <span className="text-content-secondary font-medium uppercase tracking-wider text-xs">Your Balance</span>
                            <span className={`text-sm font-semibold ${hasEnough ? 'text-content-primary' : 'text-red-500'}`}>
                                {balanceLoading ? '…' : formatCredits(balance)}
                            </span>
                        </div>
                    </div>

                    {!balanceLoading && !hasEnough && (
                        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex gap-2 items-start">
                            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                            <div className="text-xs text-red-500">
                                <span className="font-semibold">Insufficient credits.</span> You need {formatCredits(shortfall)} more to run this. Top up coming soon.
                            </div>
                        </div>
                    )}

                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={onCancel}
                            className="flex-1 px-4 py-2 rounded-lg font-medium text-content-secondary hover:bg-surface-hover transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={onConfirm}
                            disabled={confirmDisabled}
                            className="flex-1 px-4 py-2 rounded-lg font-medium bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors shadow-lg shadow-accent-primary/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                        >
                            Confirm Run
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
