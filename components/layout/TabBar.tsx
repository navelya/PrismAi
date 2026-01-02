'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquare, Edit3, Library, Box, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabs = [
    { name: 'Chat', path: '/chat', icon: MessageSquare },
    { name: 'Editor', path: '/editor', icon: Edit3 },
    { name: 'Library', path: '/library', icon: Library },
    { name: 'Nodes', path: '/nodes', icon: Box },
    { name: 'Settings', path: '/settings', icon: Settings },
];

export default function TabBar() {
    const pathname = usePathname();

    return (
        <div className="border-b border-gray-200 bg-white">
            <div className="flex items-center gap-1 px-4">
                {tabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = pathname === tab.path || pathname.startsWith(tab.path);

                    return (
                        <Link
                            key={tab.path}
                            href={tab.path}
                            className={cn(
                                "flex items-center gap-2 px-6 py-3 border-b-2 transition-all",
                                "hover:bg-gray-50",
                                isActive
                                    ? "border-purple-600 text-purple-600 font-medium"
                                    : "border-transparent text-gray-600 hover:text-gray-900"
                            )}
                        >
                            <Icon className="w-4 h-4" />
                            <span className="text-sm">{tab.name}</span>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
