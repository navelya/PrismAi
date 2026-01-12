'use client';

import React from 'react';
import { Search, Plus } from 'lucide-react';
import Link from 'next/link';
import { useWorkflowLibrary } from '@/hooks/useWorkflowLibrary';
import WorkflowList from '@/components/library/WorkflowList';

export default function LibraryPage() {
    const { workflows, loading, deleteWorkflow } = useWorkflowLibrary();
    const [searchTerm, setSearchTerm] = React.useState('');

    const filteredWorkflows = workflows.filter(w =>
        w.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="w-full h-full overflow-y-auto bg-surface-secondary">
            <div className="max-w-7xl mx-auto p-8 space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-content-primary">Workflow Library</h1>
                        <p className="text-content-secondary mt-1">Manage and edit your saved workflows</p>
                    </div>

                    <Link
                        href="/chat"
                        className="flex items-center gap-2 px-6 py-3 bg-gradient-premium text-white rounded-xl hover:shadow-lg hover:shadow-accent-primary/25 transition-all"
                    >
                        <Plus className="w-5 h-5" />
                        <span>New Workflow</span>
                    </Link>
                </div>

                {/* Search Bar */}
                <div className="relative group">
                    <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-content-tertiary group-focus-within:text-accent-primary transition-colors" />
                    <input
                        type="text"
                        placeholder="Search workflows..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-surface-tertiary border border-stroke-subtle rounded-xl 
                                   text-content-primary placeholder:text-content-tertiary
                                   focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent
                                   transition-all"
                    />
                </div>

                {/* Workflow List */}
                <WorkflowList
                    workflows={filteredWorkflows}
                    loading={loading}
                    onDelete={deleteWorkflow}
                />
            </div>
        </div>
    );
}
