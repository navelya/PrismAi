'use client';

import React from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X, Clock, Database, HardDrive } from 'lucide-react';

interface RecoveryPromptProps {
    isOpen: boolean;
    onClose: () => void;
    onRestore: () => void;
    onDiscard: () => void;
    localTimestamp: number;
    serverTimestamp: number;
}

/**
 * RecoveryPrompt
 * 
 * Modal dialog shown when local backup is newer than server version.
 * Gives user control over crash recovery instead of auto-restoring.
 * 
 * Actions:
 * - Restore: Load local backup and sync to server
 * - Discard: Keep server version and delete local backup
 * - Cancel: Close modal without action (keeps both versions)
 */
export function RecoveryPrompt({
    isOpen,
    onClose,
    onRestore,
    onDiscard,
    localTimestamp,
    serverTimestamp,
}: RecoveryPromptProps) {
    const formatTimestamp = (timestamp: number) => {
        const date = new Date(timestamp);
        const now = Date.now();
        const diff = now - timestamp;
        
        // Show relative time if recent
        if (diff < 60000) return 'less than a minute ago';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} minutes ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
        
        // Otherwise show absolute time
        return date.toLocaleString();
    };

    return (
        <RadixDialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <RadixDialog.Portal>
                <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
                <RadixDialog.Content
                    className="fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] p-8 m-4 bg-bg-primary/90 backdrop-blur-2xl rounded-2xl shadow-premium border border-white/10 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
                    onPointerDownOutside={(e) => e.preventDefault()} // Prevent accidental close
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

                    <div className="flex flex-col gap-6">
                        {/* Header */}
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 border bg-yellow-500/10 text-yellow-500 border-yellow-500/20 shadow-[0_0_15px_rgba(234,179,8,0.1)]">
                                <Clock className="w-6 h-6" />
                            </div>
                            <div>
                                <RadixDialog.Title className="text-lg font-bold text-content-primary">
                                    Unsaved Changes Found
                                </RadixDialog.Title>
                                <p className="text-sm text-content-tertiary">
                                    Local backup is newer than server version
                                </p>
                            </div>
                        </div>

                        <RadixDialog.Description className="text-content-secondary leading-relaxed">
                            We found unsaved changes from your last session. This might have happened due to a browser crash or unexpected exit.
                        </RadixDialog.Description>

                        {/* Timestamp Comparison */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="p-4 bg-surface-secondary/50 rounded-lg border border-white/5">
                                <div className="flex items-center gap-2 mb-2">
                                    <HardDrive className="w-4 h-4 text-accent-primary" />
                                    <span className="text-xs font-bold text-content-secondary uppercase tracking-wide">
                                        Local Backup
                                    </span>
                                </div>
                                <p className="text-sm font-semibold text-content-primary">
                                    {formatTimestamp(localTimestamp)}
                                </p>
                            </div>
                            <div className="p-4 bg-surface-secondary/50 rounded-lg border border-white/5">
                                <div className="flex items-center gap-2 mb-2">
                                    <Database className="w-4 h-4 text-content-tertiary" />
                                    <span className="text-xs font-bold text-content-secondary uppercase tracking-wide">
                                        Server Version
                                    </span>
                                </div>
                                <p className="text-sm font-semibold text-content-primary">
                                    {formatTimestamp(serverTimestamp)}
                                </p>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col gap-2 mt-2">
                            <button
                                onClick={() => {
                                    onRestore();
                                    onClose();
                                }}
                                className="w-full px-5 py-3 text-sm font-bold text-white bg-accent-primary hover:bg-accent-primary/90 rounded-lg shadow-lg shadow-accent-primary/20 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all"
                            >
                                ✓ Restore Local Changes
                            </button>
                            <button
                                onClick={() => {
                                    onDiscard();
                                    onClose();
                                }}
                                className="w-full px-5 py-3 text-sm font-medium text-content-secondary hover:text-content-primary hover:bg-surface-tertiary rounded-lg transition-colors"
                            >
                                Discard Local Changes
                            </button>
                            <button
                                onClick={onClose}
                                className="w-full px-5 py-3 text-sm font-medium text-content-tertiary hover:text-content-secondary hover:bg-surface-secondary/30 rounded-lg transition-colors"
                            >
                                Decide Later
                            </button>
                        </div>
                    </div>
                </RadixDialog.Content>
            </RadixDialog.Portal>
        </RadixDialog.Root>
    );
}
