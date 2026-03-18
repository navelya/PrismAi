'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, X } from 'lucide-react';

interface ToastProps {
    message: string;
    duration?: number;
    onClose: () => void;
}

/**
 * Simple Toast Notification Component
 * 
 * Displays a success message with auto-dismiss.
 * Used for showing crash recovery confirmations.
 */
export function Toast({ message, duration = 5000, onClose }: ToastProps) {
    useEffect(() => {
        const timer = setTimeout(onClose, duration);
        return () => clearTimeout(timer);
    }, [duration, onClose]);

    return (
        <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-4 right-4 z-[100] max-w-md"
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
