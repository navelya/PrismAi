import React from 'react';
import { X, Coins } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CreditConfirmModalProps {
    isOpen: boolean;
    cost: number;
    nodeCount: number;
    mode: 'solo' | 'chain' | 'ab_test' | 'all';
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
    if (!isOpen) return null;

    const titles = {
        'all': 'Run Entire Canvas',
        'solo': 'Run Selected Node',
        'chain': 'Run Node & Downstream',
        'ab_test': 'Run A/B Test',
    };

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

                    <div className="bg-surface-elevated rounded-lg p-4 border border-surface-divider flex items-center justify-between">
                        <span className="text-content-secondary font-medium uppercase tracking-wider text-xs">Total Cost</span>
                        <div className="flex items-center gap-1.5 text-lg font-bold text-accent-primary">
                            <Coins className="w-5 h-5" />
                            <span>{cost} Credits</span>
                        </div>
                    </div>

                    <div className="flex gap-3 pt-4">
                        <button
                            onClick={onCancel}
                            className="flex-1 px-4 py-2 rounded-lg font-medium text-content-secondary hover:bg-surface-hover transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={onConfirm}
                            className="flex-1 px-4 py-2 rounded-lg font-medium bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors shadow-lg shadow-accent-primary/20"
                        >
                            Confirm Run
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
