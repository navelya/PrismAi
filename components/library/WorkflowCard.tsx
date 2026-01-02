'use client';

import React from 'react';
import Link from 'next/link';
import { Clock, Trash2, Edit3 } from 'lucide-react';
import { formatDate } from '@/lib/utils';

interface WorkflowCardProps {
    workflow: {
        id: string;
        name: string;
        description?: string;
        created_at: string;
    };
    onDelete?: (id: string) => void;
}

export default function WorkflowCard({ workflow, onDelete }: WorkflowCardProps) {
    return (
        <div className="bg-white rounded-xl border border-gray-200 hover:border-purple-300 hover:shadow-lg transition-all p-6 space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{workflow.name}</h3>
                    {workflow.description && (
                        <p className="text-sm text-gray-600 mt-1 line-clamp-2">{workflow.description}</p>
                    )}
                </div>
            </div>

            {/* Metadata */}
            <div className="flex items-center gap-2 text-sm text-gray-500">
                <Clock className="w-4 h-4" />
                <span>{formatDate(workflow.created_at)}</span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                <Link
                    href={`/editor?id=${workflow.id}`}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gradient-premium text-white rounded-lg hover:shadow-md transition-all"
                >
                    <Edit3 className="w-4 h-4" />
                    <span className="text-sm font-medium">Edit</span>
                </Link>

                {onDelete && (
                    <button
                        onClick={() => onDelete(workflow.id)}
                        className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-red-50 hover:border-red-300 transition-all"
                        title="Delete workflow"
                    >
                        <Trash2 className="w-4 h-4 text-gray-600 hover:text-red-600" />
                    </button>
                )}
            </div>
        </div>
    );
}
