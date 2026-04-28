'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { useAppStore } from '@/lib/store/app-store';
import { useShallow } from 'zustand/react/shallow';
import { Menu, Sparkles } from 'lucide-react';

interface AppLayoutProps {
    children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
    const pathname = usePathname();
    const isMobile = useIsMobile();
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // ✅ GLOBAL CATALOG FETCH: Ensure models and node types are loaded for labels
    const { fetchModels, fetchCategories, fetchNodeTypes, fetchProviders } = useAppStore(
        useShallow((state) => ({
            fetchModels: state.fetchModels,
            fetchCategories: state.fetchCategories,
            fetchNodeTypes: state.fetchNodeTypes,
            fetchProviders: state.fetchProviders,
        }))
    );

    React.useEffect(() => {
        // Fetch all catalog data once on app load
        fetchModels();
        fetchCategories();
        fetchNodeTypes();
        fetchProviders();
    }, [fetchModels, fetchCategories, fetchNodeTypes, fetchProviders]);

    // Get workflow name from store
    const currentWorkflow = useAppStore((state) => state.currentWorkflow);
    const workflowName = currentWorkflow?.name || 'Prisfol';

    // Hide sidebar on home page, login page, and demo page
    const isPublicPage = pathname === '/' || pathname === '/login' || pathname === '/demo';

    // Public pages get full width, no sidebar, and allow scrolling
    if (isPublicPage) {
        return (
            <div className="w-full min-h-screen overflow-y-auto">
                {children}
            </div>
        );
    }

    // Mobile layout: Header + Content + Slide-out drawer
    if (isMobile) {
        return (
            <div className="w-full h-screen flex flex-col overflow-hidden">
                {/* Mobile Header */}
                <header className="flex-shrink-0 h-14 bg-surface-primary border-b border-stroke-subtle flex items-center px-4 gap-3">
                    <button
                        onClick={() => setSidebarOpen(true)}
                        className="p-2 -ml-2 rounded-lg hover:bg-interactive-hover transition-colors"
                        aria-label="Open menu"
                    >
                        <Menu className="w-5 h-5 text-content-primary" />
                    </button>

                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-gradient-premium flex items-center justify-center flex-shrink-0">
                            <Sparkles className="w-4 h-4 text-content-inverted" />
                        </div>
                        <span className="font-semibold text-content-primary truncate">
                            {workflowName}
                        </span>
                    </div>
                </header>

                {/* Main Content */}
                <main className="flex-1 overflow-hidden bg-surface-secondary">
                    {children}
                </main>

                {/* Slide-out Sidebar */}
                <Sidebar
                    isOpen={sidebarOpen}
                    onClose={() => setSidebarOpen(false)}
                />
            </div>
        );
    }

    // Desktop layout: Side navigation
    return (
        <div className="w-full h-screen flex overflow-hidden">
            {/* Sidebar Navigation */}
            <Sidebar />

            {/* Main Content */}
            <div className="flex-1 overflow-hidden bg-surface-secondary">
                {children}
            </div>
        </div>
    );
}
