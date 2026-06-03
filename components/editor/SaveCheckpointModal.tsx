'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X, Save, Loader2 } from 'lucide-react';

interface SaveCheckpointModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Create the checkpoint. May throw — the modal surfaces the error inline. */
    onSave: (label: string) => Promise<void> | void;
    defaultName?: string;
}

/**
 * Name-a-checkpoint dialog. Shares the Radix shell + styling of
 * components/ui/ConfirmationModal so the versions popups match the rest of the
 * app. Used by both the editor toolbar "Save checkpoint" button and the
 * History panel's "+".
 */
export function SaveCheckpointModal({ isOpen, onClose, onSave, defaultName = 'Checkpoint' }: SaveCheckpointModalProps) {
    const [name, setName] = useState(defaultName);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Reset to a clean state each time the dialog opens.
    useEffect(() => {
        if (isOpen) {
            setName(defaultName);
            setError(null);
            setSubmitting(false);
        }
    }, [isOpen, defaultName]);

    const submit = async () => {
        if (submitting) return;
        const label = name.trim() || 'Checkpoint';
        setSubmitting(true);
        setError(null);
        try {
            await onSave(label);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save checkpoint.');
            setSubmitting(false);
        }
    };

    return (
        <RadixDialog.Root open={isOpen} onOpenChange={(open) => !open && !submitting && onClose()}>
            <RadixDialog.Portal>
                <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
                <RadixDialog.Content
                    className="fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] p-8 m-4 bg-bg-primary/80 backdrop-blur-2xl rounded-2xl shadow-premium border border-white/10 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
                    onOpenAutoFocus={(e) => {
                        // Focus + select the name so the user can immediately type over it.
                        e.preventDefault();
                        inputRef.current?.focus();
                        inputRef.current?.select();
                    }}
                >
                    <RadixDialog.Close asChild>
                        <button
                            className="absolute top-4 right-4 p-2 text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary rounded-full transition-colors"
                            aria-label="Close"
                            disabled={submitting}
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </RadixDialog.Close>

                    <div className="flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 border bg-accent-primary/10 text-accent-primary border-accent-primary/20 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
                                <Save className="w-6 h-6" />
                            </div>
                            <RadixDialog.Title className="text-lg font-bold text-content-primary">
                                Save checkpoint
                            </RadixDialog.Title>
                        </div>

                        <RadixDialog.Description className="text-content-secondary leading-relaxed">
                            Name this version so you can return to it later.
                        </RadixDialog.Description>

                        <input
                            ref={inputRef}
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); void submit(); }
                            }}
                            placeholder="Checkpoint name"
                            maxLength={120}
                            disabled={submitting}
                            className="w-full bg-surface-tertiary/60 border border-stroke-subtle rounded-lg px-3 py-2.5 text-sm text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-accent-primary/50 transition-colors disabled:opacity-60"
                        />

                        {error && (
                            <p className="text-xs text-accent-error">{error}</p>
                        )}

                        <div className="flex items-center justify-end gap-3 mt-2">
                            <button
                                onClick={onClose}
                                disabled={submitting}
                                className="px-4 py-2 text-sm font-medium text-content-secondary hover:text-content-primary hover:bg-surface-tertiary rounded-lg transition-colors disabled:opacity-60"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => void submit()}
                                disabled={submitting}
                                className="px-5 py-2.5 text-xs font-black uppercase tracking-widest text-white rounded-lg shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all bg-accent-primary shadow-accent-primary/20 disabled:opacity-60 disabled:hover:scale-100 flex items-center gap-2"
                            >
                                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                {submitting ? 'Saving…' : 'Save checkpoint'}
                            </button>
                        </div>
                    </div>
                </RadixDialog.Content>
            </RadixDialog.Portal>
        </RadixDialog.Root>
    );
}
