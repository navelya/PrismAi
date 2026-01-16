'use client';

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

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
    children
}: MobileActionSheetProps) {
    const [isVisible, setIsVisible] = useState(false);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (isOpen) {
            setIsVisible(true);
            // Prevent body scroll
            document.body.style.overflow = 'hidden';
        } else {
            const timer = setTimeout(() => setIsVisible(false), 300); // Wait for animation
            document.body.style.overflow = 'unset';
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    if (!isVisible && !isOpen) return null;
    if (!mounted) return null;

    return createPortal(
        <div className="fixed inset-0 z-[60] flex items-end justify-center">
            {/* Backdrop */}
            <div
                className={`
                    absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300
                    ${isOpen ? 'opacity-100' : 'opacity-0'}
                `}
                onClick={onClose}
            />

            {/* Sheet */}
            <div
                className={`
                    relative w-full bg-surface-elevated rounded-t-2xl shadow-xl transform transition-transform duration-300 ease-out
                    ${isOpen ? 'translate-y-0' : 'translate-y-full'}
                `}
            >
                {/* Handle bar for visual affordance */}
                <div className="flex justify-center pt-3 pb-1" onClick={onClose}>
                    <div className="w-12 h-1.5 rounded-full bg-stroke-subtle" />
                </div>

                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-stroke-subtle">
                    <h3 className="font-semibold text-content-primary">{title || 'Options'}</h3>
                    <button
                        onClick={onClose}
                        className="p-2 text-content-tertiary hover:text-content-primary rounded-full hover:bg-surface-tertiary transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 safe-area-bottom">
                    {children}
                </div>
            </div>
        </div>,
        document.body
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
