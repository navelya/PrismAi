'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquare, Pen, BookOpen, Boxes, Settings, Menu, Sparkles } from 'lucide-react';

const navItems = [
    { name: 'Chat', path: '/chat', icon: MessageSquare },
    { name: 'Editor', path: '/editor', icon: Pen },
    { name: 'Library', path: '/library', icon: BookOpen },
    { name: 'Nodes', path: '/nodes', icon: Boxes },
    { name: 'Settings', path: '/settings', icon: Settings },
];

export default function Sidebar() {
    const [isExpanded, setIsExpanded] = useState(false);
    const pathname = usePathname();

    return (
        <div
            className={`
        flex flex-col bg-white border-r border-gray-200 h-full
        transition-all duration-300 ease-in-out
        ${isExpanded ? 'w-60' : 'w-16'}
      `}
        >
            {/* Burger Menu - Very minimalist like Gemini */}
            <div className="h-14 flex items-center px-3">
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-700"
                    aria-label="Toggle menu"
                >
                    <Menu className="w-5 h-5" />
                </button>
            </div>

            {/* Navigation Items */}
            <nav className="flex-1 px-2 py-2">
                <ul className="space-y-1">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = pathname === item.path;

                        return (
                            <li key={item.path}>
                                <Link
                                    href={item.path}
                                    className={`
                    group relative flex items-center gap-3 px-3 py-2.5 rounded-lg
                    transition-all duration-200
                    ${isActive
                                            ? 'bg-gradient-to-r from-purple-50 to-blue-50 text-purple-600'
                                            : 'text-gray-700 hover:bg-gray-100'
                                        }
                  `}
                                >
                                    {/* Icon */}
                                    <Icon className="w-5 h-5 flex-shrink-0" />

                                    {/* Text - shows when expanded */}
                                    {isExpanded && (
                                        <span className="font-medium text-sm whitespace-nowrap">
                                            {item.name}
                                        </span>
                                    )}

                                    {/* Active Indicator */}
                                    {isActive && (
                                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-gradient-to-b from-purple-600 to-blue-500 rounded-r-full" />
                                    )}

                                    {/* Tooltip when collapsed */}
                                    {!isExpanded && (
                                        <div className="absolute left-full ml-2 px-3 py-1.5 bg-gray-900 text-white text-sm rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                                            {item.name}
                                        </div>
                                    )}
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            </nav>

            {/* Logo/Branding at Bottom - Clickable to go home */}
            <Link
                href="/"
                className={`
                    border-t border-gray-200 p-4 bg-gradient-to-br from-purple-600 to-blue-500
                    transition-all duration-300 hover:from-purple-500 hover:to-blue-400
                    cursor-pointer block
                `}
            >
                <div className={`flex items-center gap-3 ${!isExpanded && 'justify-center'}`}>
                    {/* Logo Icon */}
                    <div className={`
                        rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center
                        transition-all duration-300
                        ${isExpanded ? 'w-10 h-10' : 'w-8 h-8'}
                    `}>
                        <Sparkles className={`text-white ${isExpanded ? 'w-6 h-6' : 'w-4 h-4'}`} />
                    </div>

                    {/* Text - shows when expanded */}
                    {isExpanded && (
                        <div className="flex-1 min-w-0">
                            <h1 className="text-base font-bold text-white truncate">Prism AI</h1>
                            <p className="text-xs text-white/80 truncate">Automation</p>
                        </div>
                    )}
                </div>
            </Link>
        </div>
    );
}
