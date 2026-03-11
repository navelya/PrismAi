import React from 'react';
import { X } from 'lucide-react';

interface TableModalProps {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    title?: string;
}

export const TableModal = ({ isOpen, onClose, children, title = "Data Table" }: TableModalProps) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 animate-in fade-in duration-200">
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-md"
                onClick={onClose}
            />

            <div className="relative w-full max-w-7xl max-h-[90vh] bg-surface-primary border border-stroke-subtle rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-stroke-subtle bg-surface-secondary/50">
                    <h3 className="text-lg font-bold text-content-primary">
                        {title}
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-surface-tertiary rounded-xl transition-colors text-content-secondary hover:text-content-primary"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-6 bg-surface-primary">
                    <div className="min-w-full inline-block align-middle">
                        {children}
                    </div>
                </div>

                {/* Footer / Hint */}
                <div className="px-6 py-3 border-t border-stroke-subtle bg-surface-secondary/30 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-accent-primary hover:bg-accent-hover text-white rounded-xl font-bold transition-all shadow-lg shadow-accent-primary/20"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};
