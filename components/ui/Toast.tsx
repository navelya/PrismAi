'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, X } from 'lucide-react';

export type ToastPosition = 'top-right' | 'top-center' | 'bottom-right' | 'bottom-center';

interface ToastProps {
    message: string;
    duration?: number;
    onClose: () => void;
    /**
     * Where on the viewport to anchor the toast. Defaults to 'top-right' for
     * backward compatibility with existing call sites. Use 'bottom-right' or
     * 'bottom-center' when the action area is at the top of the page (e.g.
     * the editor's Run button island) to keep the toast from overlapping it.
     */
    position?: ToastPosition;
}

const POSITION_CLASSES: Record<ToastPosition, string> = {
    'top-right': 'top-4 right-4',
    'top-center': 'top-4 left-1/2 -translate-x-1/2',
    'bottom-right': 'bottom-4 right-4',
    'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2',
};

/**
 * Simple Toast Notification Component
 *
 * Displays a success message with auto-dismiss. Renders through a portal to
 * `document.body` so its z-index isn't trapped by an ancestor's stacking
 * context (e.g. a positioned editor canvas wrapper).
 */
export function Toast({ message, duration = 5000, onClose, position = 'top-right' }: ToastProps) {
    const [mounted, setMounted] = useState(false);
    // Portals can't run during SSR — wait for the client-side mount before
    // calling createPortal so this works in Next.js' App Router.
    useEffect(() => setMounted(true), []);

    useEffect(() => {
        const timer = setTimeout(onClose, duration);
        return () => clearTimeout(timer);
    }, [duration, onClose]);

    if (!mounted) return null;

    const fromBottom = position.startsWith('bottom-');
    const enterY = fromBottom ? 20 : -20;

    const node = (
        <motion.div
            initial={{ opacity: 0, y: enterY, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: enterY, scale: 0.95 }}
            className={`fixed ${POSITION_CLASSES[position]} z-[100] max-w-md`}
        >
            <div className="bg-surface-secondary/95 backdrop-blur-lg border border-accent-primary/20 rounded-xl shadow-2xl p-4 pr-12">
                <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-5 h-5 text-accent-primary">
                        <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <p className="text-sm text-content-primary font-medium leading-relaxed">
                        {message}
                    </p>
                </div>
                <button
                    onClick={onClose}
                    className="absolute top-3 right-3 p-1 text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary rounded-full transition-colors"
                    aria-label="Close"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        </motion.div>
    );

    return createPortal(node, document.body);
}

interface ToastContainerProps {
    children?: React.ReactNode;
}

/**
 * Toast Container Provider
 * 
 * Manages toast notifications with AnimatePresence for smooth animations.
 * Add this to your app layout to enable toast notifications.
 */
export function ToastContainer({ children }: ToastContainerProps) {
    return (
        <>
            {children}
            <div className="fixed top-0 right-0 z-[100] pointer-events-none">
                <div className="pointer-events-auto">
                    <AnimatePresence mode="wait">
                        {/* Toast notifications will be rendered here */}
                    </AnimatePresence>
                </div>
            </div>
        </>
    );
}
