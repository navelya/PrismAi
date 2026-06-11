'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';

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
    const iconWrap =
        variant === 'danger'
            ? 'bg-accent-error/10 text-accent-error border-accent-error/20 shadow-[0_0_15px_rgba(239,68,68,0.1)]'
            : variant === 'warning'
                ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20 shadow-[0_0_15px_rgba(234,179,8,0.1)]'
                : 'bg-accent-primary/10 text-accent-primary border-accent-primary/20 shadow-[0_0_15px_rgba(6,182,212,0.1)]';
    const confirmBtn =
        variant === 'danger'
            ? 'bg-accent-error shadow-accent-error/20'
            : variant === 'warning'
                ? 'bg-yellow-600 shadow-yellow-600/20'
                : 'bg-accent-primary shadow-accent-primary/20';

    return (
        <Modal open={isOpen} onOpenChange={(o) => !o && onClose()} size="md">
            <Modal.Header>
                <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 border ${iconWrap}`}>
                        <AlertTriangle className="w-6 h-6" />
                    </div>
                    <Modal.Title>{title}</Modal.Title>
                </div>
            </Modal.Header>
            <Modal.Body className="pt-2">
                <Modal.Description>{message}</Modal.Description>
            </Modal.Body>
            <Modal.Footer>
                <button
                    onClick={onClose}
                    className="px-4 py-2 text-sm font-medium text-content-secondary hover:text-content-primary hover:bg-surface-tertiary rounded-lg transition-colors"
                >
                    {cancelText}
                </button>
                <button
                    onClick={() => { onConfirm(); onClose(); }}
                    className={`px-5 py-2.5 text-xs font-black uppercase tracking-widest text-white rounded-lg shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all ${confirmBtn}`}
                >
                    {confirmText}
                </button>
            </Modal.Footer>
        </Modal>
    );
}
