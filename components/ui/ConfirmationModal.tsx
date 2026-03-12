'use client';

import React from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { X, AlertTriangle } from 'lucide-react';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    variant?: 'danger' | 'warning' | 'info';
}

export function ConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'danger',
}: ConfirmationModalProps) {
    return (
        <RadixDialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <RadixDialog.Portal>
                <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
                <RadixDialog.Content
                    className="fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] p-8 m-4 bg-bg-primary/80 backdrop-blur-2xl rounded-2xl shadow-premium border border-white/10 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
                    onPointerDownOutside={onClose}
                >
                    {/* Close button */}
                    <RadixDialog.Close asChild>
                        <button
                            className="absolute top-4 right-4 p-2 text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary rounded-full transition-colors"
                            aria-label="Close"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </RadixDialog.Close>

                    <div className="flex flex-col gap-4">
                        {/* Header with Icon */}
                        <div className="flex items-center gap-3">
                            <div className={`
                                w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 border
                                ${variant === 'danger' ? 'bg-accent-error/10 text-accent-error border-accent-error/20 shadow-[0_0_15px_rgba(239,68,68,0.1)]' :
                                    variant === 'warning' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20 shadow-[0_0_15px_rgba(234,179,8,0.1)]' :
                                        'bg-accent-primary/10 text-accent-primary border-accent-primary/20 shadow-[0_0_15px_rgba(6,182,212,0.1)]'}
                            `}>
                                <AlertTriangle className="w-6 h-6" />
                            </div>
                            <RadixDialog.Title className="text-lg font-bold text-content-primary">
                                {title}
                            </RadixDialog.Title>
                        </div>

                        <RadixDialog.Description className="text-content-secondary leading-relaxed">
                            {message}
                        </RadixDialog.Description>

                        {/* Actions */}
                        <div className="flex items-center justify-end gap-3 mt-4">
                            <button
                                onClick={onClose}
                                className="px-4 py-2 text-sm font-medium text-content-secondary hover:text-content-primary hover:bg-surface-tertiary rounded-lg transition-colors"
                            >
                                {cancelText}
                            </button>
                            <button
                                onClick={() => {
                                    onConfirm();
                                    onClose();
                                }}
                                className={`
                                    px-5 py-2.5 text-xs font-black uppercase tracking-widest text-white rounded-lg shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all
                                    ${variant === 'danger' ? 'bg-accent-error shadow-accent-error/20' :
                                        variant === 'warning' ? 'bg-yellow-600 shadow-yellow-600/20' :
                                            'bg-accent-primary shadow-accent-primary/20'}
                                `}
                            >
                                {confirmText}
                            </button>
                        </div>
                    </div>
                </RadixDialog.Content>
            </RadixDialog.Portal>
        </RadixDialog.Root>
    );
}
