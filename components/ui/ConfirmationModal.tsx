'use client';

import React, { useEffect, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { createPortal } from 'react-dom';

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
    variant = 'danger'
}: ConfirmationModalProps) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Keyboard navigation
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;
    if (!mounted) return null;

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={handleBackdropClick}
        >
            <div className="relative w-full max-w-md p-8 m-4 bg-bg-primary/80 backdrop-blur-2xl rounded-2xl shadow-premium border border-white/10 transform animate-in zoom-in-95 duration-300">
                {/* Close button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary rounded-full transition-colors"
                    aria-label="Close"
                >
                    <X className="w-5 h-5" />
                </button>

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
                        <div>
                            <h2 className="text-lg font-bold text-content-primary">{title}</h2>
                        </div>
                    </div>

                    {/* Message */}
                    <p className="text-content-secondary leading-relaxed">
                        {message}
                    </p>

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
            </div>
        </div>,
        document.body
    );
}
