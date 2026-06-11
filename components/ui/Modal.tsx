'use client';

import React, { createContext, useContext } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';
export type ModalLevel = 'base' | 'elevated' | 'top';

const SIZE_MAX_WIDTH: Record<ModalSize, string> = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-6xl',
};

// Single source of truth for popup stacking — replaces the old ad-hoc
// z-50 … z-[9999] ladder. base = ordinary modal; elevated = a modal that
// opens over another (e.g. billing over plans); top = always-on-top status.
const LEVEL_Z: Record<ModalLevel, string> = {
    base: 'z-[100]',
    elevated: 'z-[110]',
    top: 'z-[120]',
};

interface ModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: React.ReactNode;
    size?: ModalSize;
    level?: ModalLevel;
    /** Show the built-in top-right close button. Default true. */
    showClose?: boolean;
    /** Master switch: allow ESC / outside-interaction to close. Default true.
     *  Also the default for `closeOnEscape` / `closeOnBackdropClick`. */
    dismissable?: boolean;
    /** Close on Escape. Defaults to `dismissable`. */
    closeOnEscape?: boolean;
    /** Close when the dim backdrop itself is clicked. Defaults to `dismissable`.
     *  Independent of Radix outside-interaction (which `dismissable` gates) so a
     *  non-modal popup can keep backdrop-close while ignoring clicks on nested
     *  body-portaled layers. */
    closeOnBackdropClick?: boolean;
    /** Radix `modal` passthrough — set false for non-modal stacking. Default true. */
    modal?: boolean;
    /** Sizing/layout escape hatch for the panel (e.g. max-w / max-h / flex). */
    contentClassName?: string;
    /** Accessible name when no visible <Modal.Title> is rendered. */
    srTitle?: string;
    /** Forwarded to Radix Content — e.g. to focus+select an input on open. */
    onOpenAutoFocus?: (event: Event) => void;
}

// Lets compound parts reach the close handler if ever needed — primarily
// future-proofing for affordances rendered deep inside the panel.
const ModalContext = createContext<{ onOpenChange: (o: boolean) => void } | null>(null);

export function useModalContext() {
    return useContext(ModalContext);
}

function ModalRoot({
    open,
    onOpenChange,
    children,
    size = 'md',
    level = 'base',
    showClose = true,
    dismissable = true,
    closeOnEscape,
    closeOnBackdropClick,
    modal = true,
    contentClassName,
    srTitle,
    onOpenAutoFocus,
}: ModalProps) {
    const z = LEVEL_Z[level];
    const escCloses = closeOnEscape ?? dismissable;
    const backdropCloses = closeOnBackdropClick ?? dismissable;
    return (
        <ModalContext.Provider value={{ onOpenChange }}>
            <RadixDialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
                <AnimatePresence>
                    {open && (
                        <RadixDialog.Portal forceMount>
                            <RadixDialog.Overlay asChild forceMount>
                                <motion.div
                                    className={cn('fixed inset-0 bg-black/60 backdrop-blur-sm', z)}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.15 }}
                                    onClick={backdropCloses ? () => onOpenChange(false) : undefined}
                                />
                            </RadixDialog.Overlay>

                            {/* Centering layer. pointer-events-none so clicks on
                                empty space fall through to the overlay; Radix
                                still detects pointer-down-outside on Content. */}
                            <div className={cn('fixed inset-0 flex items-center justify-center p-4 overflow-y-auto pointer-events-none', z)}>
                                <RadixDialog.Content
                                    asChild
                                    forceMount
                                    onOpenAutoFocus={onOpenAutoFocus}
                                    onEscapeKeyDown={(e) => { if (!escCloses) e.preventDefault(); }}
                                    onPointerDownOutside={(e) => { if (!dismissable) e.preventDefault(); }}
                                    onInteractOutside={(e) => { if (!dismissable) e.preventDefault(); }}
                                >
                                    <motion.div
                                        className={cn(
                                            // Near-opaque so inner text stays legible over a busy canvas;
                                            // light blur keeps a hint of glass. Plain deep shadow (no accent glow).
                                            'pointer-events-auto relative w-full my-auto bg-bg-primary/95 backdrop-blur-md rounded-2xl shadow-2xl shadow-black/40 border border-white/10',
                                            SIZE_MAX_WIDTH[size],
                                            contentClassName,
                                        )}
                                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                                        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                                    >
                                        {srTitle && (
                                            <VisuallyHidden.Root asChild>
                                                <RadixDialog.Title>{srTitle}</RadixDialog.Title>
                                            </VisuallyHidden.Root>
                                        )}
                                        {showClose && (
                                            <RadixDialog.Close asChild>
                                                <button
                                                    className="absolute top-4 right-4 z-10 p-2 text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary rounded-full transition-colors"
                                                    aria-label="Close"
                                                >
                                                    <X className="w-5 h-5" />
                                                </button>
                                            </RadixDialog.Close>
                                        )}
                                        {children}
                                    </motion.div>
                                </RadixDialog.Content>
                            </div>
                        </RadixDialog.Portal>
                    )}
                </AnimatePresence>
            </RadixDialog.Root>
        </ModalContext.Provider>
    );
}

function ModalHeader({ className, children }: { className?: string; children: React.ReactNode }) {
    return <div className={cn('flex flex-col gap-1.5 px-8 pt-8 pr-12', className)}>{children}</div>;
}

function ModalTitle({ className, children, asChild }: { className?: string; children: React.ReactNode; asChild?: boolean }) {
    return (
        <RadixDialog.Title asChild={asChild} className={cn('text-lg font-bold text-content-primary', className)}>
            {children}
        </RadixDialog.Title>
    );
}

function ModalDescription({ className, children }: { className?: string; children: React.ReactNode }) {
    return (
        <RadixDialog.Description className={cn('text-content-secondary leading-relaxed', className)}>
            {children}
        </RadixDialog.Description>
    );
}

function ModalBody({ className, children }: { className?: string; children: React.ReactNode }) {
    return <div className={cn('px-8 py-6', className)}>{children}</div>;
}

function ModalFooter({ className, children }: { className?: string; children: React.ReactNode }) {
    return <div className={cn('flex items-center justify-end gap-3 px-8 pb-8 pt-2', className)}>{children}</div>;
}

export const Modal = Object.assign(ModalRoot, {
    Header: ModalHeader,
    Title: ModalTitle,
    Description: ModalDescription,
    Body: ModalBody,
    Footer: ModalFooter,
});
