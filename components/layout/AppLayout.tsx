'use client';

import React from 'react';
import Sidebar from './Sidebar';

interface AppLayoutProps {
    children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
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
