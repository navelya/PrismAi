'use client';

import React from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { X } from 'lucide-react';

interface TableModalProps {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    title?: string;
}

export const TableModal = ({ isOpen, onClose, children, title = 'Data Table' }: TableModalProps) => {
    return (
        <RadixDialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <RadixDialog.Portal>
                <RadixDialog.Overlay className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
                <RadixDialog.Content
                    className="fixed left-[50%] top-[50%] z-[100] w-full max-w-7xl max-h-[90vh] translate-x-[-50%] translate-y-[-50%] bg-surface-primary border border-stroke-subtle rounded-3xl shadow-2xl flex flex-col overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
                    onPointerDownOutside={onClose}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-stroke-subtle bg-surface-secondary/50 shrink-0">
                        <RadixDialog.Title className="text-lg font-bold text-content-primary">
                            {title}
                        </RadixDialog.Title>
                        <RadixDialog.Close asChild>
                            <button
                                className="p-2 hover:bg-surface-tertiary rounded-xl transition-colors text-content-secondary hover:text-content-primary"
                                aria-label="Close"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </RadixDialog.Close>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-auto p-6 bg-surface-primary">
                        <div className="min-w-full inline-block align-middle">
                            {children}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-3 border-t border-stroke-subtle bg-surface-secondary/30 flex justify-end shrink-0">
                        <RadixDialog.Close asChild>
                            <button className="px-6 py-2 bg-accent-primary hover:bg-accent-hover text-white rounded-xl font-bold transition-all shadow-lg shadow-accent-primary/20">
                                Close
                            </button>
                        </RadixDialog.Close>
                    </div>
                </RadixDialog.Content>
            </RadixDialog.Portal>
        </RadixDialog.Root>
    );
};
