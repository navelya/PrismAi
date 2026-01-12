'use client';

import React, { useState } from 'react';
import { Play, Save, Trash2, FilePlus, MoreVertical, MousePointer, Square } from 'lucide-react';

interface EditorToolbarProps {
    workflowName: string;
    onNameChange: (name: string) => void;
    onSave: () => void;
    onRun: () => void;
    onStop?: () => void;
    isRunning?: boolean;
    onDelete: () => void;
    onNew: () => void;
    selectionMode?: boolean;
    onSelectionModeChange?: (enabled: boolean) => void;
}

export default function EditorToolbar({
    workflowName,
    onNameChange,
    onSave,
    onRun,
    onStop,
    isRunning = false,
    onDelete,
    onNew,
    selectionMode = false,
    onSelectionModeChange,
}: EditorToolbarProps) {
    const [showMenu, setShowMenu] = useState(false);

    return (
        <div className="flex items-center gap-2 px-4 py-3 bg-surface-primary border-b border-stroke-subtle">
            {/* Workflow Name - Responsive */}
            <input
                type="text"
                value={workflowName}
                onChange={(e) => onNameChange(e.target.value)}
                className="flex-1 min-w-0 px-3 py-1.5 text-sm font-medium bg-surface-tertiary border border-stroke-subtle rounded-lg 
                           text-content-primary placeholder:text-content-tertiary
                           focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                placeholder="Workflow name"
            />

            {/* Primary Action - Run/Stop toggle */}
            {isRunning ? (
                <button
                    onClick={onStop}
                    className="flex items-center gap-2 px-3 py-1.5 bg-red-500 text-white rounded-lg hover:bg-red-600 hover:shadow-md transition-all font-medium text-sm"
                    title="Stop workflow"
                >
                    <Square className="w-4 h-4 fill-current" />
                    <span className="hidden sm:inline">Stop</span>
                </button>
            ) : (
                <button
                    onClick={onRun}
                    className="flex items-center gap-2 px-3 py-1.5 bg-gradient-premium text-white rounded-lg hover:shadow-md hover:shadow-accent-primary/25 transition-all font-medium text-sm"
                    title="Run workflow"
                >
                    <Play className="w-4 h-4" />
                    <span className="hidden sm:inline">Run</span>
                </button>
            )}

            {/* Desktop: Show all buttons */}
            <div className="hidden lg:flex items-center gap-2">
                <button
                    onClick={onSave}
                    className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary text-content-secondary rounded-lg hover:bg-surface-tertiary transition-colors text-sm border border-stroke-subtle"
                    title="Save workflow"
                >
                    <Save className="w-4 h-4" />
                    <span>Save</span>
                </button>

                <button
                    onClick={onNew}
                    className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary text-content-secondary rounded-lg hover:bg-surface-tertiary transition-colors text-sm border border-stroke-subtle"
                    title="New workflow"
                >
                    <FilePlus className="w-4 h-4" />
                    <span>New</span>
                </button>

                <button
                    onClick={onDelete}
                    className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 text-red-600 rounded-lg hover:bg-red-500/20 transition-colors text-sm border border-transparent hover:border-red-200 dark:hover:border-red-900"
                    title="Delete workflow"
                >
                    <Trash2 className="w-4 h-4" />
                    <span>Delete</span>
                </button>
            </div>

            {/* Mobile/Tablet: Icon-only buttons */}
            <div className="flex lg:hidden items-center gap-1">
                <button
                    onClick={onSave}
                    className="p-2 bg-surface-secondary text-content-secondary rounded-lg hover:bg-surface-tertiary transition-colors border border-stroke-subtle"
                    title="Save workflow"
                >
                    <Save className="w-4 h-4" />
                </button>

                {/* More menu for New and Delete */}
                <div className="relative">
                    <button
                        onClick={() => setShowMenu(!showMenu)}
                        className="p-2 bg-surface-secondary text-content-secondary rounded-lg hover:bg-surface-tertiary transition-colors border border-stroke-subtle"
                        title="More actions"
                    >
                        <MoreVertical className="w-4 h-4" />
                    </button>

                    {/* Dropdown Menu */}
                    {showMenu && (
                        <>
                            <div
                                className="fixed inset-0 z-10"
                                onClick={() => setShowMenu(false)}
                            />
                            <div className="absolute right-0 top-full mt-1 w-40 bg-surface-elevated border border-stroke-subtle rounded-lg shadow-lg z-20 py-1">
                                <button
                                    onClick={() => {
                                        onNew();
                                        setShowMenu(false);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-content-secondary hover:bg-surface-tertiary transition-colors"
                                >
                                    <FilePlus className="w-4 h-4" />
                                    New Workflow
                                </button>
                                <button
                                    onClick={() => {
                                        onDelete();
                                        setShowMenu(false);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                >
                                    <Trash2 className="w-4 h-4" />
                                    Delete
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
