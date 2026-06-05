'use client';

import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { MessageSquare, Pen, LayoutTemplate, Boxes, Settings, Menu, X, Trash2, Loader2, LogOut, User as UserIcon, Plus, Image, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { useAppStore } from '@/lib/store/app-store';
import { createClient } from '@/lib/supabase/client';
import { sessionsApi, userApi } from '@/lib/api/client';
import { useSession } from '@/lib/hooks/use-session';
import { ConfirmationModal } from '@/components/ui/ConfirmationModal';
import { useLongPress } from '@/lib/hooks/use-long-press';
import { MobileActionSheet, ActionItem } from '@/components/ui/MobileActionSheet';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { Logo } from '@/components/ui/Logo';

const navItems = [
    { name: 'New Chat', path: '/chat', icon: MessageSquare, desktopOnly: false },
    { name: 'Templates', path: '/templates', icon: LayoutTemplate, desktopOnly: false },
    { name: 'Assets', path: '/assets', icon: Image, desktopOnly: false },
    { name: 'Nodes', path: '/nodes', icon: Boxes, desktopOnly: false },
    { name: 'Settings', path: '/settings', icon: Settings, desktopOnly: false },
];

interface SidebarProps {
    isOpen?: boolean;
    onClose?: () => void;
    /** Desktop presentation:
     *  - 'docked'   → traditional collapsible left column (used on full pages
     *                 like /templates, /assets, /nodes, /settings).
     *  - 'floating' → compact top-left app-menu overlay (used on the canvas /
     *                 chat session pages where canvas space is precious). */
    variant?: 'docked' | 'floating';
}

export default function Sidebar({ isOpen = true, onClose, variant = 'docked' }: SidebarProps) {
    const [isExpanded, setIsExpanded] = React.useState(false);
    const [isProfileMenuOpen, setIsProfileMenuOpen] = React.useState(false);
    // Open/closed state for the floating (canvas) app-menu panel. Kept separate
    // from `isExpanded` (which is the docked bar's persistent width preference)
    // because the Sidebar now stays mounted across routes — sharing one flag
    // would carry an open panel into the next session. Reset on every route
    // change so navigating to a session always lands with the panel closed.
    const [menuOpen, setMenuOpen] = React.useState(false);
    const pathname = usePathname();
    const match = pathname?.match(/^\/chat\/([a-zA-Z0-9_-]+)/);
    const urlSessionId = match ? match[1] : null;
    const isMobile = useIsMobile();
    const [user, setUser] = React.useState<any>(null);
    const supabase = React.useMemo(() => createClient(), []);
    const router = useRouter();

    // Close the floating app-menu whenever the route changes (e.g. navigating
    // into a session) so it never lingers open over a freshly loaded workflow.
    React.useEffect(() => {
        setMenuOpen(false);
    }, [pathname]);

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
            const isDeletingActiveSession = pathname === `/chat/${deleteConfirmation.sessionId}`;

            setSessions(prev => prev.filter(s => s.id !== deleteConfirmation.sessionId));
            await deleteSession(deleteConfirmation.sessionId);
            setDeleteConfirmation({ isOpen: false, sessionId: null });

            if (isDeletingActiveSession) {
                handleNewChat();
                router.push('/chat');
            }
        }
    };

    React.useEffect(() => {
        if (user) {
            const fetchSessions = async () => {
                try {
                    const { sessions: data } = await sessionsApi.list();
                    if (data) {
                        setSessions(data);
                        // Seed last-known roles so navigating into any listed
                        // session (own or shared) resolves its edit affordances
                        // without a flash. The server still confirms on open.
                        const roleMap: Record<string, 'owner' | 'editor' | 'viewer'> = {};
                        for (const s of data) {
                            if (s?.id && (s.role === 'owner' || s.role === 'editor' || s.role === 'viewer')) {
                                roleMap[s.id] = s.role;
                            }
                        }
                        if (Object.keys(roleMap).length > 0) {
                            useAppStore.getState().setSessionRoles(roleMap);
                        }
                    }
                } catch (error) {
                    console.error("[Sidebar] Fetch failed", error);
                }
            };

            fetchSessions();

            // NOTE: Shared canvases (owned by other users) will NOT fire these user_id-scoped
            // row events; their title/metadata updates will only appear after the next sessionsApi.list() call (v1 behavior).
            // Subscribe to session changes (Realtime) with GRANULAR handlers
            // This avoids re-fetching the entire list on every change, eliminating blinks
            let channel: ReturnType<typeof supabase.channel> | null = null;

            if (supabase && user?.id) {
                channel = supabase
                    .channel('sidebar-sessions')
                    .on(
                        'postgres_changes',
                        { event: 'INSERT', schema: 'public', table: 'sessions', filter: `user_id=eq.${user.id}` },
                        (payload: any) => {
                            const newSession = payload.new;
                            setSessions(prev => {
                                // Don't add duplicates (optimistic UI may have already added it)
                                if (prev.some(s => s.id === newSession.id)) return prev;
                                return [newSession, ...prev];
                            });
                        }
                    )
                    .on(
                        'postgres_changes',
                        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `user_id=eq.${user.id}` },
                        (payload: any) => {
                            const updated = payload.new;
                            if (updated.is_deleted) {
                                setSessions(prev => prev.filter(s => s.id !== updated.id));
                            } else {
                                setSessions(prev =>
                                    prev.map(s => s.id === updated.id ? { ...s, ...updated } : s)
                                );
                            }
                        }
                    )
                    .on(
                        'postgres_changes',
                        { event: 'DELETE', schema: 'public', table: 'sessions', filter: `user_id=eq.${user.id}` },
                        (payload: any) => {
                            const deletedId = payload.old?.id;
                            if (deletedId) {
                                setSessions(prev => prev.filter(s => s.id !== deletedId));
                            }
                        }
                    )
                    .subscribe((status: string, err?: Error) => {
                        if (err) console.error('[Sidebar] Realtime subscription error:', err);
                    });
            }

            return () => {
                if (channel) {
                    supabase.removeChannel(channel);
                }
            };
        }
    }, [user, supabase]);

    const handleNewChat = () => {
        // Instantly transition local UI safely before the native Next router shifts pages
        useAppStore.getState().setActiveSessionId(null);

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
                        className="fixed inset-0 bg-surface-primary/60 z-40 transition-opacity duration-300"
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
                        <h1 className="font-bold text-content-primary">Prisfol</h1>
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
                                                    // DO NOT e.preventDefault() here! We WANT the native pre-fetched Next.js <Link> transition for zero latency!
                                                    handleNewChat();
                                                } else {
                                                    onClose?.();
                                                }
                                            }}
                                            className={`
                                                flex items-center gap-3 px-4 py-3 rounded-xl
                                                transition-all duration-200
                                                ${isActive
                                                    ? 'bg-accent-primary/10 text-accent-primary border border-accent-primary/10 shadow-sm'
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
                        {!sessions.find(s => s.id === actionSheetSessionId)?.shared && (
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
                        )}
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
                                <Logo variant="mark" className="w-5 h-5" />
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

    // Desktop · docked variant — the traditional collapsible left column, used
    // on full pages (templates / assets / nodes / settings). Flush full-height
    // bar, no inset, no rounded corners.
    if (variant === 'docked') {
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
                                const targetPath = item.path;
                                const isActive = pathname === item.path;

                                return (
                                    <li key={item.name}>
                                        <Link
                                            href={targetPath}
                                            onClick={() => {
                                                if (item.path === '/chat') {
                                                    // Native pre-fetched link transition for zero latency.
                                                    handleNewChat();
                                                }
                                            }}
                                            className={`
                                                group relative flex items-center gap-3 px-3 py-2.5 rounded-lg
                                                transition-all duration-200
                                                ${isActive
                                                    ? 'bg-interactive-hover text-accent-primary font-semibold'
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

                                            {!isExpanded && (
                                                <div className="absolute left-full ml-2 px-3 py-1.5 bg-content-primary text-surface-primary text-sm rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-[100] shadow-lg">
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
                                {sessions.map((session) => (
                                    <li
                                        key={session.id}
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

                {/* Profile (authenticated) / skeleton */}
                <div className="border-t border-stroke-subtle relative">
                    {user ? (
                        <div className="p-2">
                            <div className="relative">
                                <button
                                    onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                                    className="flex items-center w-full hover:bg-interactive-hover p-1.5 rounded-lg transition-colors overflow-hidden"
                                >
                                    <div className={`flex-shrink-0 flex items-center justify-center transition-all duration-300 ${!isExpanded ? 'w-9' : 'w-10'}`}>
                                        <UserAvatar
                                            user={user}
                                            className={`${isExpanded ? 'w-10 h-10 text-sm' : 'w-9 h-9 text-xs'} flex-shrink-0 transition-all duration-300`}
                                            showStatus={Object.keys(user).length > 0}
                                        />
                                    </div>

                                    <div
                                        className={`
                                                flex-1 min-w-0 flex items-center justify-between overflow-hidden transition-all duration-300 ease-in-out whitespace-nowrap
                                                ${isExpanded ? 'max-w-[200px] opacity-100 ml-3' : 'max-w-0 opacity-0 ml-0 pointer-events-none'}
                                            `}
                                    >
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-content-primary truncate whitespace-nowrap text-left">
                                                {user.user_metadata?.display_name || user.user_metadata?.full_name || 'User'}
                                            </p>
                                            <p className="text-xs text-content-tertiary truncate whitespace-nowrap text-left">
                                                {user.email}
                                            </p>
                                        </div>
                                        <div className="text-content-tertiary hidden md:block">
                                            <Settings className={`w-4 h-4 transition-transform duration-200 ${isProfileMenuOpen ? 'rotate-90' : ''}`} />
                                        </div>
                                    </div>
                                </button>

                                <AnimatePresence>
                                    {isProfileMenuOpen && (
                                        <motion.div
                                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                                            animate={{ opacity: 1, scale: 1, y: 0 }}
                                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                                            className={`
                                                absolute bottom-full mb-2 left-0 z-[100] bg-surface-primary border border-stroke-subtle shadow-2xl rounded-xl p-1.5 min-w-[200px]
                                                ${!isExpanded ? 'ml-2' : ''}
                                            `}
                                        >
                                            <Link
                                                href="/settings"
                                                onClick={() => setIsProfileMenuOpen(false)}
                                                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-content-primary hover:bg-interactive-hover transition-colors"
                                            >
                                                <Settings className="w-4 h-4 text-content-tertiary" />
                                                <span>Settings</span>
                                            </Link>
                                            {user?.is_admin && (
                                                <Link
                                                    href="/admin"
                                                    onClick={() => setIsProfileMenuOpen(false)}
                                                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-content-primary hover:bg-interactive-hover transition-colors"
                                                >
                                                    <Boxes className="w-4 h-4 text-content-tertiary" />
                                                    <span>Admin Panel</span>
                                                </Link>
                                            )}
                                            <div className="h-px bg-stroke-subtle my-1.5 mx-1" />
                                            <button
                                                onClick={handleLogout}
                                                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-red-500 hover:bg-red-500/10 transition-colors"
                                            >
                                                <LogOut className="w-4 h-4" />
                                                <span>Sign out</span>
                                            </button>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                    ) : (
                        <div className="p-3">
                            <div className={`flex items-center ${!isExpanded ? 'justify-center' : 'gap-3'} animate-pulse`}>
                                <div className={`
                                    rounded-full bg-surface-tertiary flex-shrink-0 transition-all duration-300
                                    ${isExpanded ? 'w-10 h-10' : 'w-9 h-9'}
                                `} />
                                <div className={`
                                    flex-1 min-w-0 flex flex-col gap-1.5 overflow-hidden transition-all duration-300
                                    ${isExpanded ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 opacity-0 ml-0'}
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

    // Desktop · floating variant — a compact button pinned to the top-left
    // corner that overlays the canvas; clicking it drops down a floating panel
    // with New session, the session list (switch from anywhere), secondary nav,
    // and profile. This reclaims the full canvas width while keeping every
    // destination one click away from any canvas.
    const secondaryNav = navItems.filter((item) => item.path !== '/chat');

    return (
        <>
            {/* Click-outside catcher — sits below the dock but above the canvas. */}
            {menuOpen && (
                <div
                    className="fixed inset-0 z-[60]"
                    onClick={() => setMenuOpen(false)}
                    aria-hidden="true"
                />
            )}

            <div className="absolute top-3 left-3 z-[61] flex flex-col items-start gap-2">
                {/* Collapsed trigger — transparent, icon-only. No background so
                    it sits directly on the canvas; kept fixed-width and offset
                    from the credits island. The current session title already
                    shows in the canvas toolbar. */}
                <button
                    onClick={() => setMenuOpen((v) => !v)}
                    className="group flex items-center gap-1.5 h-9 px-2 text-content-primary hover:text-content-primary transition-colors"
                    aria-label="Open menu and sessions"
                    aria-expanded={menuOpen}
                    title="Menu & sessions"
                >
                    <Logo variant="mark" className="w-4 h-4 flex-shrink-0" />
                    <ChevronDown
                        className={`w-3.5 h-3.5 flex-shrink-0 text-content-tertiary transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`}
                    />
                </button>

                {/* Expanded panel — floats over the canvas, never pushes it. */}
                <AnimatePresence>
                    {menuOpen && (
                        <motion.div
                            initial={{ opacity: 0, y: -8, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -8, scale: 0.98 }}
                            transition={{ duration: 0.15, ease: 'easeOut' }}
                            style={{ transformOrigin: 'top left' }}
                            className="w-64 max-h-[calc(100dvh-72px)] flex flex-col bg-surface-primary border border-stroke-subtle rounded-2xl shadow-2xl shadow-black/40 overflow-hidden"
                        >
                            {/* New session */}
                            <div className="p-2">
                                <Link
                                    href="/chat"
                                    onClick={() => {
                                        // Keep the native pre-fetched <Link> transition.
                                        handleNewChat();
                                        setMenuOpen(false);
                                    }}
                                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-content-primary hover:bg-interactive-hover transition-colors"
                                >
                                    <Plus className="w-4 h-4 flex-shrink-0 text-accent-primary" />
                                    <span>New session</span>
                                </Link>
                            </div>

                            {/* Session list — switch sessions from any canvas. */}
                            {sessions.length > 0 && (
                                <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 border-t border-stroke-subtle/60 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-content-tertiary/40">
                                    <div className="px-3 pt-2 pb-1.5 text-xs font-semibold text-content-tertiary uppercase tracking-wider sticky top-0 bg-surface-primary z-10">
                                        Sessions
                                    </div>
                                    <ul className="space-y-0.5">
                                        {sessions.map((session) => (
                                            <li key={session.id}>
                                                <SidebarSessionItem
                                                    session={session}
                                                    isActive={pathname === `/chat/${session.id}`}
                                                    isMobile={isMobile}
                                                    onClose={() => setMenuOpen(false)}
                                                    onDeleteClick={(id) => setDeleteConfirmation({ isOpen: true, sessionId: id })}
                                                    onLongPress={() => { }} // No op on desktop
                                                />
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* Secondary nav */}
                            <nav className="p-2 border-t border-stroke-subtle/60">
                                <ul className="space-y-0.5">
                                    {secondaryNav.map((item) => {
                                        const Icon = item.icon;
                                        const isActive = pathname === item.path;
                                        return (
                                            <li key={item.name}>
                                                <Link
                                                    href={item.path}
                                                    onClick={() => setMenuOpen(false)}
                                                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive
                                                        ? 'bg-accent-primary/10 text-accent-primary'
                                                        : 'text-content-primary hover:bg-interactive-hover'
                                                        }`}
                                                >
                                                    <Icon className="w-4 h-4 flex-shrink-0" />
                                                    <span>{item.name}</span>
                                                </Link>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </nav>

                            {/* Profile / account */}
                            {user && (
                                <div className="p-2 border-t border-stroke-subtle/60 bg-surface-secondary/60">
                                    <div className="flex items-center gap-3 px-1.5 py-1">
                                        <UserAvatar
                                            user={user}
                                            className="w-9 h-9 text-xs flex-shrink-0"
                                            showStatus={Object.keys(user).length > 0}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-semibold text-content-primary truncate text-left">
                                                {user.user_metadata?.display_name || user.user_metadata?.full_name || 'User'}
                                            </p>
                                            <p className="text-xs text-content-tertiary truncate text-left">
                                                {user.email}
                                            </p>
                                        </div>
                                        <button
                                            onClick={handleLogout}
                                            className="p-2 text-content-tertiary hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors flex-shrink-0"
                                            title="Sign out"
                                            aria-label="Sign out"
                                        >
                                            <LogOut className="w-4 h-4" />
                                        </button>
                                    </div>
                                    {user?.is_admin && (
                                        <Link
                                            href="/admin"
                                            onClick={() => setMenuOpen(false)}
                                            className="mt-1 flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-content-primary hover:bg-interactive-hover transition-colors"
                                        >
                                            <Boxes className="w-4 h-4 text-content-tertiary" />
                                            <span>Admin Panel</span>
                                        </Link>
                                    )}
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>

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
        </>
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
    const [isExecuting, setIsExecuting] = React.useState(false);
    const supabase = React.useMemo(() => createClient(), []);

    const isGeneratingName = !session.title;
    const sessionTitle = session.title || '';

    React.useEffect(() => {
        if (!isActive) {
            setIsExecuting(false);
            return;
        }

        let channel: ReturnType<typeof supabase.channel> | null = null;
        let isMounted = true;

        const checkExecutionStatus = async () => {
            const { data } = await supabase.from('messages')
                .select('id')
                .eq('session_id', session.id)
                .eq('status', 'processing')
                .limit(1);
            if (isMounted) {
                setIsExecuting(!!data?.length);
            }
        };

        checkExecutionStatus();

        channel = supabase.channel(`sidebar-session-${session.id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `session_id=eq.${session.id}` }, (payload: any) => {
                if (payload.new && 'status' in payload.new) {
                    if (payload.new.status === 'processing') setIsExecuting(true);
                    else if (payload.new.status === 'completed' || payload.new.status === 'failed') setIsExecuting(false);
                }
            }).subscribe();

        return () => {
            isMounted = false;
            if (channel) supabase.removeChannel(channel);
        }
    }, [session.id, supabase]);

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
                        ? 'bg-accent-primary/10 text-accent-primary font-bold border border-accent-primary/10 shadow-sm'
                        : 'text-content-secondary hover:bg-interactive-hover hover:text-content-primary'
                    }
                `}
            >
                <div className="flex-1 overflow-hidden relative flex items-center h-5">
                    <AnimatePresence mode="popLayout">
                        <motion.span
                            key={sessionTitle}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -10 }}
                            transition={{ duration: 0.2 }}
                            className={`absolute left-0 w-full truncate text-sm text-left ${isGeneratingName ? 'opacity-0' : ''}`}
                        >
                            {sessionTitle}
                        </motion.span>
                        {isGeneratingName && (
                            <motion.div
                                key="skeleton"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="absolute left-0 w-full h-full flex items-center"
                            >
                                <div className="h-3 bg-stroke-strong/50 rounded-md w-24 relative overflow-hidden">
                                    <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
                {session.shared && (
                    <span className="ml-1 text-[10px] uppercase tracking-wide text-text-tertiary border border-stroke-subtle rounded px-1 py-0.5 flex-shrink-0">
                        Shared
                    </span>
                )}
                {isExecuting && (
                    <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-primary flex-shrink-0" />
                    </motion.div>
                )}
            </div>
        );
    }

    // DESKTOP RENDER (Standard)
    return (
        <Link
            href={`/chat/${session.id}`}
            onClick={() => onClose?.()}
            className={`
                    group relative flex items-center gap-3 px-3 py-2 rounded-lg
                    transition-all duration-200
                    ${isActive
                    ? 'bg-accent-primary/10 text-accent-primary font-bold border border-accent-primary/10 shadow-sm'
                    : 'text-content-secondary hover:bg-interactive-hover hover:text-content-primary'
                }
                `}
        >
            <div className="flex-1 overflow-hidden relative flex items-center h-5">
                <AnimatePresence mode="popLayout">
                    <motion.span
                        key={sessionTitle}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={{ duration: 0.2 }}
                        className={`absolute left-0 w-full truncate text-sm text-left ${isGeneratingName ? 'opacity-0' : ''}`}
                    >
                        {sessionTitle}
                    </motion.span>
                    {isGeneratingName && (
                        <motion.div
                            key="skeleton"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute left-0 w-full h-full flex items-center"
                        >
                            <div className="h-3 bg-stroke-strong/50 rounded-md w-28 relative overflow-hidden">
                                <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {session.shared && (
                <span className="ml-1 text-[10px] uppercase tracking-wide text-text-tertiary border border-stroke-subtle rounded px-1 py-0.5 flex-shrink-0">
                    Shared
                </span>
            )}

            {isExecuting && (
                <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} className="flex-shrink-0 mr-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-primary" />
                </motion.div>
            )}

            {!session.shared && (
                <button
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onDeleteClick(session.id);
                    }}
                    className={`p-1.5 text-content-tertiary hover:text-red-500 hover:bg-red-500/10 rounded-md transition-all z-10 ${isExecuting ? 'opacity-0 scale-95 pointer-events-none' : 'opacity-0 group-hover:opacity-100 scale-100'}`}
                    title="Delete session"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            )}
        </Link>
    );
}
