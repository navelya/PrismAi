'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import { useIsMobile } from '@/lib/hooks/use-mobile';

interface AppLayoutProps {
    children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
    const pathname = usePathname();
    const isMobile = useIsMobile();

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

    // Mobile layout: Content with bottom navigation from Sidebar
    if (isMobile) {
        return (
            <div className="w-full min-h-screen flex flex-col overflow-hidden">
                {/* Main Content - takes full width, leaves space for bottom nav */}
                <div className="flex-1 overflow-hidden bg-gray-50 pb-16">
                    {children}
                </div>
                {/* Bottom Navigation (rendered by Sidebar on mobile) */}
                <Sidebar />
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
