'use client';

import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { MessageSquare, Pen, BookOpen, Boxes, Settings, Menu, Sparkles, X } from 'lucide-react';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { useAppStore } from '@/lib/store/app-store';
import { createClient } from '@/lib/supabase/client';
import { LogOut, User as UserIcon } from 'lucide-react';

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
    const [user, setUser] = React.useState<any>(null);
    const supabase = createClient();
    const router = useRouter(); // Error: useRouter needs to be imported

    React.useEffect(() => {
        const getUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            setUser(user);
        };
        getUser();
    }, []);

    const handleLogout = async () => {
        await supabase.auth.signOut();
        router.refresh(); // Refresh to trigger middleware redirect if on protected route? 
        // Or manual redirect
        window.location.href = '/login';
    };

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
                    className={`fixed top-0 left-0 h-full w-72 bg-surface-primary z-50 transform transition-transform duration-300 ease-out shadow-2xl
                        ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
                >
                    {/* Drawer Header */}
                    <div className="flex items-center justify-between p-4 border-b border-stroke-subtle">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-premium flex items-center justify-center">
                                <Sparkles className="w-5 h-5 text-content-inverted" />
                            </div>
                            <div>
                                <h1 className="font-bold text-content-primary">Prism AI</h1>
                                <p className="text-xs text-content-secondary">Automation Platform</p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-lg hover:bg-interactive-hover transition-colors"
                        >
                            <X className="w-5 h-5 text-content-secondary" />
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
                                                    ? 'bg-gradient-to-r from-purple-500/10 to-blue-500/10 text-accent-primary'
                                                    : 'text-content-primary hover:bg-interactive-hover'
                                                }
                                            `}
                                        >
                                            <Icon className="w-5 h-5" />
                                            <span className="font-medium">{item.name}</span>
                                            {isActive && (
                                                <div className="ml-auto w-2 h-2 rounded-full bg-accent-primary" />
                                            )}
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    </nav>

                    {/* Bottom Section */}
                    <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-stroke-subtle">
                        <Link
                            href="/"
                            onClick={onClose}
                            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-tertiary hover:bg-interactive-hover transition-colors"
                        >
                            <Sparkles className="w-5 h-5 text-accent-primary" />
                            <span className="font-medium text-content-primary">Back to Home</span>
                        </Link>
                    </div>
                </div>
            </>
        );
    }

    // Desktop: Side navigation
    return (
        <div
            className={`
                flex flex-col bg-surface-primary border-r border-stroke-subtle h-full
                transition-all duration-300 ease-in-out
                ${isExpanded ? 'w-60' : 'w-16'}
            `}
        >
            {/* Burger Menu */}
            <div className="h-14 flex items-center px-3">
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="p-2 rounded-lg hover:bg-interactive-hover transition-colors text-content-primary"
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
                                            ? 'bg-gradient-to-r from-purple-500/10 to-blue-500/10 text-accent-primary'
                                            : 'text-content-primary hover:bg-interactive-hover'
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
                                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-gradient-premium rounded-r-full" />
                                    )}

                                    {!isExpanded && (
                                        <div className="absolute left-full ml-2 px-3 py-1.5 bg-content-primary text-surface-primary text-sm rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-lg">
                                            {item.name}
                                        </div>
                                    )}
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            </nav>

            {/* Logo at Bottom (Replaced by Profile for Authenticated Users) */}
            <div className="border-t border-stroke-subtle bg-surface-secondary">
                {user ? (
                    <div className="p-3">
                        <div className={`flex items-center gap-3 ${!isExpanded && 'justify-center'}`}>
                            {/* Avatar */}
                            <div className="relative group">
                                <div className={`
                                    rounded-full bg-gradient-premium flex items-center justify-center text-white font-medium
                                    shadow-md ring-2 ring-white/10
                                    ${isExpanded ? 'w-10 h-10 text-sm' : 'w-9 h-9 text-xs'}
                                `}>
                                    {user.user_metadata?.avatar_url ? (
                                        <img
                                            src={user.user_metadata.avatar_url}
                                            alt={user.email}
                                            className="w-full h-full rounded-full object-cover"
                                        />
                                    ) : (
                                        <span>{user.email?.[0].toUpperCase()}</span>
                                    )}
                                </div>

                                {/* Status Indicator */}
                                <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-surface-secondary rounded-full"></div>
                            </div>

                            {isExpanded && (
                                <div className="flex-1 min-w-0 flex items-center justify-between">
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-content-primary truncate">
                                            {user.user_metadata?.display_name || user.user_metadata?.full_name || 'User'}
                                        </p>
                                        <p className="text-xs text-content-tertiary truncate">
                                            {user.email}
                                        </p>
                                    </div>
                                    <button
                                        onClick={handleLogout}
                                        className="p-1.5 text-content-tertiary hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                                        title="Sign out"
                                    >
                                        <LogOut className="w-4 h-4" />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <Link
                        href="/"
                        className="block p-4 transition-all duration-300 hover:brightness-110 cursor-pointer bg-gradient-premium"
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
                )}
            </div>
        </div>
    );
}
