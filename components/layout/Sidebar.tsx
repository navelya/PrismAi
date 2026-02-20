'use client';

import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { MessageSquare, Pen, BookOpen, Boxes, Settings, Menu, Sparkles, X, Trash2 } from 'lucide-react';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { useAppStore } from '@/lib/store/app-store';
import { createClient } from '@/lib/supabase/client';
import { sessionsApi, userApi } from '@/lib/api/client';
import { useSession } from '@/lib/hooks/use-session';
import { LogOut, User as UserIcon, Plus } from 'lucide-react';
import { ConfirmationModal } from '@/components/ui/ConfirmationModal';
import { useLongPress } from '@/lib/hooks/use-long-press';
import { MobileActionSheet, ActionItem } from '@/components/ui/MobileActionSheet';
import { UserAvatar } from '@/components/ui/UserAvatar';

const navItems = [
    { name: 'New Chat', path: '/chat', icon: MessageSquare, desktopOnly: false },
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
    const router = useRouter();

    React.useEffect(() => {
        const getUser = async () => {
            try {
                const { user } = await userApi.me();
                if (user) setUser(user);
            } catch {
                // Not authenticated
            }
        };
        getUser();

        // Listen for profile updates from the Settings page
        window.addEventListener('profile-updated', getUser);
        return () => window.removeEventListener('profile-updated', getUser);
    }, []);

    // ...

    const [sessions, setSessions] = React.useState<any[]>([]);
    const { createNewSession, deleteSession } = useSession();
    const [deleteConfirmation, setDeleteConfirmation] = React.useState<{ isOpen: boolean, sessionId: string | null }>({ isOpen: false, sessionId: null });
    const [actionSheetSessionId, setActionSheetSessionId] = React.useState<string | null>(null);

    const confirmDelete = async () => {
        if (deleteConfirmation.sessionId) {
            setSessions(prev => prev.filter(s => s.id !== deleteConfirmation.sessionId));
            await deleteSession(deleteConfirmation.sessionId);
        }
    };

    React.useEffect(() => {
        if (user) {
            const fetchSessions = async () => {
                try {
                    // Force fresh fetch
                    console.log('[Sidebar] Fetching sessions...');
                    const { sessions: data } = await sessionsApi.list();
                    if (data) {
                        console.log('[Sidebar] Sessions fetched:', data.length);
                        setSessions(data);
                    }
                } catch (error) {
                    console.error("[Sidebar] Fetch failed", error);
                }
            };

            fetchSessions();

            fetchSessions();

            // Subscribe to session changes (Realtime)
            let channel: ReturnType<typeof supabase.channel> | null = null;

            // Only try to subscribe if we have a valid initialized client and authenticated user
            if (supabase && user?.id) {
                channel = supabase
                    .channel('sidebar-sessions')
                    .on(
                        'postgres_changes',
                        { event: '*', schema: 'public', table: 'sessions', filter: `user_id=eq.${user.id}` },
                        (payload: any) => {
                            fetchSessions();
                        }
                    )
                    .subscribe((status: string, err?: Error) => {
                        if (err) console.error('[Sidebar] Realtime subscription error:', err);
                    });
            }

            // Listen for custom local events (Immediate UI update fallback)
            const handleLocalUpdate = () => {
                console.log('[Sidebar] session-updated event received, refreshing...');
                // Small delay to allow DB propagation
                setTimeout(fetchSessions, 500);
            };
            window.addEventListener('session-updated', handleLocalUpdate);

            return () => {
                if (channel) {
                    supabase.removeChannel(channel);
                }
                window.removeEventListener('session-updated', handleLocalUpdate);
            };
        }
    }, [user, supabase]);

    const handleNewChat = () => {
        // Reset ALL state immediately (synchronously before navigation)
        const store = useAppStore.getState();



        // Clear workflow and close canvas FIRST
        store.setCurrentWorkflow(null);
        store.setEditorState({ isCanvasOpen: false, splitRatio: 50 });

        // Clear chat messages and execution state
        store.clearMessages();
        store.clearExecutionResults();
        store.resetNodeStatuses();
        store.clearNodeOutputs();

        // Clear active session ID - this is key for fresh state
        store.setActiveSessionId(null);




        // Navigate to fresh chat (session will be created lazily on first message)
        router.push('/chat');

        if (isMobile && onClose) onClose();
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
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
                    className={`fixed top-0 left-0 h-full w-72 bg-surface-primary z-50 transform transition-transform duration-300 ease-out shadow-2xl flex flex-col
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

                    {/* Navigation Items - Fixed */}
                    <div className="p-3">
                        <ul className="space-y-1">
                            {visibleItems.map((item) => {
                                const Icon = item.icon;
                                const isActive = pathname === item.path;

                                return (
                                    <li key={item.path}>
                                        <Link
                                            href={item.path}
                                            onClick={(e) => {
                                                if (item.path === '/chat') {
                                                    e.preventDefault();
                                                    handleNewChat();
                                                } else {
                                                    onClose?.();
                                                }
                                            }}
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
                    </div>

                    {/* Mobile History List - Scrollable (No Scrollbar) */}
                    {sessions.length > 0 && (
                        <div className="flex-1 overflow-y-auto px-3 pb-3 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:none]">
                            <div className="pt-2 border-t border-stroke-subtle">
                                <div className="px-4 mb-2 text-xs font-semibold text-content-tertiary uppercase tracking-wider sticky top-0 bg-surface-primary py-2 z-10">
                                    History
                                </div>
                                <ul className="space-y-1">
                                    {sessions.map((session, index) => (
                                        <li
                                            key={session.id}
                                            className={`transition-all duration-200 ease-out origin-left ${isOpen
                                                ? 'opacity-100 translate-x-0'
                                                : 'opacity-0 -translate-x-4'
                                                }`}
                                            style={{
                                                transitionDelay: isOpen
                                                    ? `${index * 30}ms`
                                                    : '0ms'
                                            }}
                                        >
                                            <SidebarSessionItem
                                                session={session}
                                                isActive={pathname === `/chat/${session.id}`}
                                                isMobile={isMobile}
                                                onClose={onClose}
                                                onDeleteClick={(id) => setDeleteConfirmation({ isOpen: true, sessionId: id })}
                                                onLongPress={(id) => setActionSheetSessionId(id)}
                                            />
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    )}

                    {/* Spacer if no sessions to push bottom section down */}
                    {sessions.length === 0 && <div className="flex-1" />}

                    <MobileActionSheet
                        isOpen={!!actionSheetSessionId}
                        onClose={() => setActionSheetSessionId(null)}
                        title="Session Options"
                    >
                        <ActionItem
                            icon={Trash2}
                            label="Delete Chat"
                            variant="danger"
                            onClick={() => {
                                if (actionSheetSessionId) {
                                    setDeleteConfirmation({ isOpen: true, sessionId: actionSheetSessionId });
                                    setActionSheetSessionId(null);
                                }
                            }}
                        />
                    </MobileActionSheet>

                    {/* Bottom Section - Fixed in Flex column */}
                    <div className="p-4 border-t border-stroke-subtle bg-surface-primary safe-area-bottom">
                        {user ? (
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="relative group">
                                        <UserAvatar
                                            user={user}
                                            className="w-10 h-10"
                                            showStatus={Object.keys(user).length > 0}
                                        />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-content-primary truncate max-w-[120px]">
                                            {user.user_metadata?.display_name || user.user_metadata?.full_name || 'User'}
                                        </p>
                                        <p className="text-xs text-content-tertiary truncate max-w-[120px]">
                                            {user.email}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={handleLogout}
                                    className="p-2 text-content-tertiary hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                                    title="Sign out"
                                >
                                    <LogOut className="w-5 h-5" />
                                </button>
                            </div>
                        ) : (
                            <Link
                                href="/"
                                onClick={onClose}
                                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-tertiary hover:bg-interactive-hover transition-colors"
                            >
                                <Sparkles className="w-5 h-5 text-accent-primary" />
                                <span className="font-medium text-content-primary">Back to Home</span>
                            </Link>
                        )}
                    </div>

                    <ConfirmationModal
                        isOpen={deleteConfirmation.isOpen}
                        onClose={() => setDeleteConfirmation({ isOpen: false, sessionId: null })}
                        onConfirm={confirmDelete}
                        title="Delete Chat?"
                        message="This action cannot be undone. The chat history will be permanently removed."
                        confirmText="Delete"
                        variant="danger"
                    />
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

            {/* Navigation Section */}
            <div className={`flex flex-col flex-1 min-h-0 ${isExpanded ? 'overflow-hidden' : ''}`}>

                {/* Fixed Nav Items */}
                <nav className="flex-shrink-0 px-2 py-2">
                    <ul className="space-y-1 mb-2">
                        {navItems.map((item) => {
                            const Icon = item.icon;
                            const isActive = pathname === item.path;

                            return (
                                <li key={item.path}>
                                    <Link
                                        href={item.path}
                                        onClick={(e) => {
                                            if (item.path === '/chat') {
                                                e.preventDefault();
                                                handleNewChat();
                                            }
                                        }}
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

                                        <span
                                            className={`
                                                font-medium text-sm whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out
                                                ${isExpanded ? 'max-w-[200px]' : 'max-w-0'}
                                            `}
                                        >
                                            {item.name}
                                        </span>

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

                {sessions.length > 0 && (
                    <div className={`
                        flex-1 overflow-y-auto px-2 pb-2 min-h-0 border-t border-stroke-subtle/50 
                        [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-content-tertiary/40 
                        transition-all duration-300 ease-in-out origin-top
                        ${isExpanded
                            ? 'opacity-100 translate-x-0'
                            : 'opacity-0 -translate-x-4 pointer-events-none'
                        }
                    `}>
                        <div className="px-3 py-2 text-xs font-semibold text-content-tertiary uppercase tracking-wider whitespace-nowrap sticky top-0 bg-surface-primary z-10">
                            History
                        </div>
                        <ul className="space-y-0.5">
                            {sessions.map((session, index) => (
                                <li
                                    key={session.id}
                                    style={{
                                        transitionDelay: isExpanded
                                            ? `${index * 30}ms`
                                            : '0ms'
                                    }}
                                    className={`transition-all duration-200 ease-out origin-left ${isExpanded
                                        ? 'opacity-100 translate-x-0'
                                        : 'opacity-0 -translate-x-4'
                                        }`}
                                >
                                    <SidebarSessionItem
                                        session={session}
                                        isActive={pathname === `/chat/${session.id}`}
                                        isMobile={isMobile}
                                        onDeleteClick={(id) => setDeleteConfirmation({ isOpen: true, sessionId: id })}
                                        onLongPress={() => { }} // No op on desktop
                                    />
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {/* Logo at Bottom (Replaced by Profile for Authenticated Users) */}
            <div className="border-t border-stroke-subtle bg-surface-secondary">
                {user ? (
                    <div className="p-3">
                        <div className={`flex items-center gap-3 ${!isExpanded && 'justify-center'}`}>
                            {/* Avatar */}
                            <div className="relative group">
                                <UserAvatar
                                    user={user}
                                    className={isExpanded ? 'w-10 h-10 text-sm' : 'w-9 h-9 text-xs'}
                                    showStatus={Object.keys(user).length > 0}
                                />
                            </div>

                            <div
                                className={`
                                        flex-1 min-w-0 flex items-center justify-between overflow-hidden transition-all duration-300 ease-in-out
                                        ${isExpanded ? 'max-w-[200px]' : 'max-w-0'}
                                    `}
                            >
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-content-primary truncate whitespace-nowrap">
                                        {user.user_metadata?.display_name || user.user_metadata?.full_name || 'User'}
                                    </p>
                                    <p className="text-xs text-content-tertiary truncate whitespace-nowrap">
                                        {user.email}
                                    </p>
                                </div>
                                <button
                                    onClick={handleLogout}
                                    className="p-1.5 text-content-tertiary hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors flex-shrink-0"
                                    title="Sign out"
                                >
                                    <LogOut className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="p-3">
                        <div className={`flex items-center gap-3 ${!isExpanded && 'justify-center'} animate-pulse`}>
                            {/* Avatar Skeleton */}
                            <div className={`
                                rounded-full bg-surface-tertiary
                                ${isExpanded ? 'w-10 h-10' : 'w-9 h-9'}
                            `} />

                            {/* Text Skeleton */}
                            <div className={`
                                flex-1 min-w-0 flex flex-col gap-1.5 overflow-hidden transition-all duration-300
                                ${isExpanded ? 'max-w-[200px]' : 'max-w-0'}
                            `}>
                                <div className="h-4 w-24 bg-surface-tertiary rounded" />
                                <div className="h-3 w-32 bg-surface-tertiary rounded" />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <ConfirmationModal
                isOpen={deleteConfirmation.isOpen}
                onClose={() => setDeleteConfirmation({ isOpen: false, sessionId: null })}
                onConfirm={confirmDelete}
                title="Delete Chat?"
                message="This will permanently delete this chat session and all its history. This action cannot be undone."
                confirmText="Delete"
                variant="danger"
            />
        </div>
    );
}

// Helper Component for Mobile Long Press
function SidebarSessionItem({
    session,
    isActive,
    isMobile,
    onClose,
    onDeleteClick,
    onLongPress
}: {
    session: any;
    isActive: boolean;
    isMobile: boolean;
    onClose?: () => void;
    onDeleteClick: (id: string) => void;
    onLongPress: (id: string) => void;
}) {
    const router = useRouter();

    const longPressProps = useLongPress(
        // On Long Press
        (e) => {
            if (isMobile) {
                // Prevent navigation/click
                e.preventDefault();
                onLongPress(session.id);
            }
        },
        // On Click (Normal)
        (e) => {
            if (onClose) onClose();
            router.push(`/chat/${session.id}`);
        },
        {
            shouldPreventDefault: true,
            delay: 500,
        }
    );

    if (isMobile) {
        return (
            <div
                {...longPressProps}
                className={`
                    group flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer
                    transition-all duration-200 select-none
                    ${isActive
                        ? 'bg-surface-tertiary text-content-primary font-medium'
                        : 'text-content-secondary hover:bg-interactive-hover hover:text-content-primary'
                    }
                `}
            >
                <MessageSquare className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-accent-primary' : 'opacity-50'}`} />
                <span className="text-sm truncate flex-1">
                    {session.title || 'Untitled Session'}
                </span>
            </div>
        );
    }

    // DESKTOP RENDER (Standard)
    return (
        <Link
            href={`/chat/${session.id}`}
            className={`
                    group relative flex items-center gap-3 px-3 py-2 rounded-lg
                    transition-all duration-200
                    ${isActive
                    ? 'bg-surface-tertiary text-content-primary font-medium'
                    : 'text-content-secondary hover:bg-interactive-hover hover:text-content-primary'
                }
                `}
        >
            <MessageSquare className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-accent-primary' : 'opacity-50'}`} />
            <span className="text-sm truncate flex-1 text-left whitespace-nowrap">
                {session.title || 'Untitled Session'}
            </span>
            <button
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDeleteClick(session.id);
                }}
                className="p-1.5 text-content-tertiary hover:text-red-500 hover:bg-red-500/10 rounded-md opacity-0 group-hover:opacity-100 transition-all z-10"
                title="Delete session"
            >
                <Trash2 className="w-4 h-4" />
            </button>
        </Link>
    );
}
