'use client';

import React from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

interface MobileActionSheetProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    children: React.ReactNode;
}

export function MobileActionSheet({
    isOpen,
    onClose,
    title,
    children,
}: MobileActionSheetProps) {
    return (
        <RadixDialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <RadixDialog.Portal>
                {/* Backdrop */}
                <RadixDialog.Overlay className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

                {/* Sheet */}
                <RadixDialog.Content
                    className="fixed bottom-0 left-0 right-0 z-[60] w-full bg-surface-elevated rounded-t-2xl shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom outline-none"
                    onPointerDownOutside={onClose}
                >
                    {/* Handle bar */}
                    <div className="flex justify-center pt-3 pb-1 cursor-pointer" onClick={onClose}>
                        <div className="w-12 h-1.5 rounded-full bg-stroke-subtle" />
                    </div>

                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-stroke-subtle">
                        <RadixDialog.Title className="font-semibold text-content-primary">
                            {title || 'Options'}
                        </RadixDialog.Title>
                        <RadixDialog.Close asChild>
                            <button className="p-2 text-content-tertiary hover:text-content-primary rounded-full hover:bg-surface-tertiary transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </RadixDialog.Close>
                    </div>

                    {/* Content */}
                    <div className="p-4 safe-area-bottom">
                        {children}
                    </div>
                </RadixDialog.Content>
            </RadixDialog.Portal>
        </RadixDialog.Root>
    );
}

interface ActionItemProps {
    icon?: React.ElementType;
    label: string;
    onClick: () => void;
    variant?: 'default' | 'danger';
}

export function ActionItem({ icon: Icon, label, onClick, variant = 'default' }: ActionItemProps) {
    return (
        <button
            onClick={onClick}
            className={`
                w-full flex items-center gap-3 px-4 py-3.5 rounded-xl font-medium transition-colors
                ${variant === 'danger'
                    ? 'bg-red-500/10 text-red-500 active:bg-red-500/20'
                    : 'bg-surface-tertiary text-content-primary active:bg-surface-secondary'}
            `}
        >
            {Icon && <Icon className="w-5 h-5" />}
            {label}
        </button>
    );
}
