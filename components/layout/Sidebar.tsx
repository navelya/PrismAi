'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { MessageSquare, Pen, BookOpen, Boxes, Settings, Menu, Sparkles, X } from 'lucide-react';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { useAppStore } from '@/lib/store/app-store';

const navItems = [
    { name: 'Chat', path: '/chat', icon: MessageSquare, desktopOnly: false },
    { name: 'Editor', path: '/editor', icon: Pen, desktopOnly: true },
    { name: 'Library', path: '/library', icon: BookOpen, desktopOnly: false },
    { name: 'Nodes', path: '/nodes', icon: Boxes, desktopOnly: false },
    { name: 'Settings', path: '/settings', icon: Settings, desktopOnly: false },
];

interface SidebarProps {
    isOpen?: boolean;
    onClose?: () => void;
}

export default function Sidebar({ isOpen = true, onClose }: SidebarProps) {
    const [isExpanded, setIsExpanded] = React.useState(false);
    const pathname = usePathname();
    const isMobile = useIsMobile();

    // Filter items for mobile (exclude desktop-only items)
    const visibleItems = isMobile
        ? navItems.filter(item => !item.desktopOnly)
        : navItems;

    // Mobile: Slide-out drawer
    if (isMobile) {
        return (
            <>
                {/* Backdrop */}
                {isOpen && (
                    <div
                        className="fixed inset-0 bg-black/50 z-40 transition-opacity duration-300"
                        onClick={onClose}
                    />
                )}

                {/* Drawer */}
                <div
                    className={`fixed top-0 left-0 h-full w-72 bg-white z-50 transform transition-transform duration-300 ease-out shadow-2xl
                        ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
                >
                    {/* Drawer Header */}
                    <div className="flex items-center justify-between p-4 border-b border-gray-100">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-blue-500 flex items-center justify-center">
                                <Sparkles className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h1 className="font-bold text-gray-900">Prism AI</h1>
                                <p className="text-xs text-gray-500">Automation Platform</p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                            <X className="w-5 h-5 text-gray-500" />
                        </button>
                    </div>

                    {/* Navigation Items */}
                    <nav className="p-3">
                        <ul className="space-y-1">
                            {visibleItems.map((item) => {
                                const Icon = item.icon;
                                const isActive = pathname === item.path;

                                return (
                                    <li key={item.path}>
                                        <Link
                                            href={item.path}
                                            onClick={onClose}
                                            className={`
                                                flex items-center gap-3 px-4 py-3 rounded-xl
                                                transition-all duration-200
                                                ${isActive
                                                    ? 'bg-gradient-to-r from-purple-50 to-blue-50 text-purple-600'
                                                    : 'text-gray-700 hover:bg-gray-50'
                                                }
                                            `}
                                        >
                                            <Icon className="w-5 h-5" />
                                            <span className="font-medium">{item.name}</span>
                                            {isActive && (
                                                <div className="ml-auto w-2 h-2 rounded-full bg-purple-500" />
                                            )}
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    </nav>

                    {/* Bottom Section */}
                    <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-100">
                        <Link
                            href="/"
                            onClick={onClose}
                            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
                        >
                            <Sparkles className="w-5 h-5 text-purple-600" />
                            <span className="font-medium text-gray-700">Back to Home</span>
                        </Link>
                    </div>
                </div>
            </>
        );
    }

    // Desktop: Side navigation (unchanged)
    return (
        <div
            className={`
                flex flex-col bg-white border-r border-gray-200 h-full
                transition-all duration-300 ease-in-out
                ${isExpanded ? 'w-60' : 'w-16'}
            `}
        >
            {/* Burger Menu */}
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
                                    <Icon className="w-5 h-5 flex-shrink-0" />

                                    {isExpanded && (
                                        <span className="font-medium text-sm whitespace-nowrap">
                                            {item.name}
                                        </span>
                                    )}

                                    {isActive && (
                                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-gradient-to-b from-purple-600 to-blue-500 rounded-r-full" />
                                    )}

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

            {/* Logo at Bottom */}
            <Link
                href="/"
                className="border-t border-gray-200 p-4 bg-gradient-to-br from-purple-600 to-blue-500 transition-all duration-300 hover:from-purple-500 hover:to-blue-400 cursor-pointer block"
            >
                <div className={`flex items-center gap-3 ${!isExpanded && 'justify-center'}`}>
                    <div className={`
                        rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center
                        transition-all duration-300
                        ${isExpanded ? 'w-10 h-10' : 'w-8 h-8'}
                    `}>
                        <Sparkles className={`text-white ${isExpanded ? 'w-6 h-6' : 'w-4 h-4'}`} />
                    </div>

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
