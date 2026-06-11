'use client';

import React from 'react';
import { X } from 'lucide-react';
import { Modal } from './Modal';

interface TableModalProps {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    title?: string;
}

export const TableModal = ({ isOpen, onClose, children, title = 'Data Table' }: TableModalProps) => {
    return (
        <Modal
            open={isOpen}
            onOpenChange={(open) => !open && onClose()}
            size="full"
            // Tables want a wider, height-capped, scroll-internal panel.
            contentClassName="max-w-7xl max-h-[90vh] flex flex-col overflow-hidden"
            // Has its own header + footer close affordances.
            showClose={false}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
                <Modal.Title>{title}</Modal.Title>
                <button
                    onClick={onClose}
                    className="p-2 hover:bg-surface-tertiary rounded-xl transition-colors text-content-secondary hover:text-content-primary"
                    aria-label="Close"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-6">
                <div className="min-w-full inline-block align-middle">
                    {children}
                </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-white/10 flex justify-end shrink-0">
                <button
                    onClick={onClose}
                    className="px-6 py-2 bg-accent-primary hover:bg-accent-hover text-white rounded-xl font-bold transition-all shadow-lg shadow-accent-primary/20"
                >
                    Close
                </button>
            </div>
        </Modal>
    );
};
