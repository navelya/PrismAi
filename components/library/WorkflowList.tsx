'use client';

import React from 'react';
import { Loader2, FolderOpen } from 'lucide-react';
import WorkflowCard from './WorkflowCard';

interface WorkflowListProps {
    workflows: any[];
    loading: boolean;
    onDelete?: (id: string) => void;
}

export default function WorkflowList({ workflows, loading, onDelete }: WorkflowListProps) {
    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-center space-y-3">
                    <Loader2 className="w-8 h-8 animate-spin text-purple-600 mx-auto" />
                    <p className="text-gray-600">Loading workflows...</p>
                </div>
            </div>
        );
    }

    if (workflows.length === 0) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto">
                        <FolderOpen className="w-8 h-8 text-gray-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-gray-900">No workflows yet</h3>
                        <p className="text-gray-600 mt-1">Create your first workflow in the Chat or Editor</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {workflows.map((workflow) => (
                <WorkflowCard
                    key={workflow.id}
                    workflow={workflow}
                    onDelete={onDelete}
                />
            ))}
        </div>
    );
}
