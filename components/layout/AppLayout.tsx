'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { useAppStore } from '@/lib/store/app-store';
import { Menu, Sparkles } from 'lucide-react';

interface AppLayoutProps {
    children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
    const pathname = usePathname();
    const isMobile = useIsMobile();
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // Get workflow name from store
    const currentWorkflow = useAppStore((state) => state.currentWorkflow);
    const workflowName = currentWorkflow?.name || 'PrismAI';

    // Hide sidebar on home page (root URL)
    const isHomePage = pathname === '/';

    // Home page gets full width, no sidebar
    if (isHomePage) {
        return (
            <div className="w-full h-screen overflow-hidden">
                {children}
            </div>
        );
    }

    // Mobile layout: Header + Content + Slide-out drawer
    if (isMobile) {
        return (
            <div className="w-full h-screen flex flex-col overflow-hidden">
                {/* Mobile Header */}
                <header className="flex-shrink-0 h-14 bg-white border-b border-gray-100 flex items-center px-4 gap-3">
                    <button
                        onClick={() => setSidebarOpen(true)}
                        className="p-2 -ml-2 rounded-lg hover:bg-gray-100 transition-colors"
                        aria-label="Open menu"
                    >
                        <Menu className="w-5 h-5 text-gray-700" />
                    </button>

                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-600 to-blue-500 flex items-center justify-center flex-shrink-0">
                            <Sparkles className="w-4 h-4 text-white" />
                        </div>
                        <span className="font-semibold text-gray-800 truncate">
                            {workflowName}
                        </span>
                    </div>
                </header>

                {/* Main Content */}
                <main className="flex-1 overflow-hidden bg-gray-50">
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
            <div className="flex-1 overflow-hidden bg-gray-50">
                {children}
            </div>
        </div>
    );
}
