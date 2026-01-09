'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';

interface AppLayoutProps {
    children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
    const pathname = usePathname();

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
