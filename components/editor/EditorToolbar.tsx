'use client';

import React, { useState } from 'react';
import { Play, Save, Trash2, FilePlus, MoreVertical, MousePointer } from 'lucide-react';

interface EditorToolbarProps {
    workflowName: string;
    onNameChange: (name: string) => void;
    onSave: () => void;
    onRun: () => void;
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
    onDelete,
    onNew,
    selectionMode = false,
    onSelectionModeChange,
}: EditorToolbarProps) {
    const [showMenu, setShowMenu] = useState(false);

    return (
        <div className="flex items-center gap-2 px-4 py-3 bg-white border-b border-gray-200">
            {/* Workflow Name - Responsive */}
            <input
                type="text"
                value={workflowName}
                onChange={(e) => onNameChange(e.target.value)}
                className="flex-1 min-w-0 px-3 py-1.5 text-sm font-medium bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                placeholder="Workflow name"
            />

            {/* Primary Actions - Always visible */}
            <button
                onClick={onRun}
                className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:shadow-md transition-all font-medium text-sm"
                title="Run workflow"
            >
                <Play className="w-4 h-4" />
                <span className="hidden sm:inline">Run</span>
            </button>

            {/* Desktop: Show all buttons */}
            <div className="hidden lg:flex items-center gap-2">
                <button
                    onClick={onSave}
                    className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
                    title="Save workflow"
                >
                    <Save className="w-4 h-4" />
                    <span>Save</span>
                </button>

                <button
                    onClick={onNew}
                    className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
                    title="New workflow"
                >
                    <FilePlus className="w-4 h-4" />
                    <span>New</span>
                </button>

                <button
                    onClick={onDelete}
                    className="flex items-center gap-2 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors text-sm"
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
                    className="p-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                    title="Save workflow"
                >
                    <Save className="w-4 h-4" />
                </button>

                {/* More menu for New and Delete */}
                <div className="relative">
                    <button
                        onClick={() => setShowMenu(!showMenu)}
                        className="p-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
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
                            <div className="absolute right-0 top-full mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                                <button
                                    onClick={() => {
                                        onNew();
                                        setShowMenu(false);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                                >
                                    <FilePlus className="w-4 h-4" />
                                    New Workflow
                                </button>
                                <button
                                    onClick={() => {
                                        onDelete();
                                        setShowMenu(false);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
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
