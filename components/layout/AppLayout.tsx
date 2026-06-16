'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import AccountModal from '@/components/account/AccountModal';
import { useIsMobile, useHasMounted } from '@/lib/hooks/use-mobile';
import { useAppStore } from '@/lib/store/app-store';
import { useShallow } from 'zustand/react/shallow';
import { isDefaultWorkflowTitle } from '@/lib/utils/workflow-title';
import { Menu, Workflow } from 'lucide-react';

interface AppLayoutProps {
    children: React.ReactNode;
    hostClass?: 'app' | 'marketing' | 'neutral';
}

export default function AppLayout({ children, hostClass }: AppLayoutProps) {
    const pathname = usePathname();
    const isMobile = useIsMobile();
    const hasMounted = useHasMounted();
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // ✅ GLOBAL CATALOG FETCH: Ensure models and node types are loaded for labels
    const { fetchModels, fetchCategories, fetchNodeTypes, fetchProviders, fetchDataTypes, fetchTemplates, fetchCreditBreakdown, fetchUserName, fetchCurrentUser } = useAppStore(
        useShallow((state) => ({
            fetchModels: state.fetchModels,
            fetchCategories: state.fetchCategories,
            fetchNodeTypes: state.fetchNodeTypes,
            fetchProviders: state.fetchProviders,
            fetchDataTypes: state.fetchDataTypes,
            fetchTemplates: state.fetchTemplates,
            fetchCreditBreakdown: state.fetchCreditBreakdown,
            fetchUserName: state.fetchUserName,
            fetchCurrentUser: state.fetchCurrentUser,
        }))
    );

    React.useEffect(() => {
        // Fetch all catalog data once on app load
        fetchModels();
        fetchCategories();
        fetchNodeTypes();
        fetchProviders();
        fetchDataTypes();
        // Preload shared, app-wide data so it's ready on any page without a
        // per-page (or hover) fetch: the templates gallery + the credits popover
        // + the display name used by the chat welcome.
        fetchTemplates();
        fetchCreditBreakdown();
        fetchUserName();
        // Preload the full user so the account modal opens instantly from the store.
        fetchCurrentUser();
    }, [fetchModels, fetchCategories, fetchNodeTypes, fetchProviders, fetchDataTypes, fetchTemplates, fetchCreditBreakdown, fetchUserName, fetchCurrentUser]);

    // Get workflow name from store
    const currentWorkflow = useAppStore((state) => state.currentWorkflow);
    const workflowName = currentWorkflow?.name || 'Prisfol';

    // Mobile canvas-preview toggle. Only meaningful inside a chat session that
    // actually has a workflow on the canvas.
    const isMobileCanvasOpen = useAppStore((state) => state.isMobileCanvasOpen);
    const setIsMobileCanvasOpen = useAppStore((state) => state.setIsMobileCanvasOpen);
    const isChatFullscreen = useAppStore((state) => state.isChatFullscreen);
    const inSession = /^\/chat\/[a-zA-Z0-9_-]+/.test(pathname);
    const hasCanvas = !!currentWorkflow?.nodes?.length;
    const showCanvasToggle = inSession && hasCanvas && !isMobileCanvasOpen;

    // On the app host, `/` is the chat root (middleware rewrites it to /chat),
    // so it must get the full app shell, NOT the public/marketing layout.
    const isAppRootChat = hostClass === 'app' && pathname === '/';

    // Hide sidebar on home page, login page, demo page, legal pages, billing landing pages, and checkout
    const isPublicPage = !isAppRootChat && (pathname === '/' || pathname === '/login' || pathname === '/demo' || pathname === '/pricing' || pathname.startsWith('/legal') || pathname.startsWith('/blog') || pathname.startsWith('/roadmap') || pathname.startsWith('/billing') || pathname.startsWith('/checkout'));

    // Lock the mobile viewport on internal app pages so the browser chrome stays put.
    // Public pages keep normal scroll behavior.
    React.useEffect(() => {
        const mq = window.matchMedia('(max-width: 767px)');
        const apply = () => {
            const lock = !isPublicPage && mq.matches;
            document.documentElement.classList.toggle('app-locked', lock);
        };
        apply();
        mq.addEventListener('change', apply);
        return () => mq.removeEventListener('change', apply);
    }, [isPublicPage]);

    // Mirror the active session's title into the browser tab. The session title
    // and currentWorkflow.name are mirrors of one value, so this stays in sync
    // through realtime renames + title generation. Public/marketing pages keep
    // their own Next metadata title (skip them so we don't clobber it).
    React.useEffect(() => {
        if (isPublicPage) return;
        const base = 'Prisfol';
        const name = (currentWorkflow?.name || '').trim();
        const showSession = inSession && !isDefaultWorkflowTitle(name);
        document.title = showSession ? `${name} · ${base}` : base;
    }, [isPublicPage, inSession, currentWorkflow?.name]);

    // Public pages get full width, no sidebar, and allow scrolling
    if (isPublicPage) {
        return (
            <div className="w-full">
                {children}
            </div>
        );
    }

    // Gate the mobile/desktop layout split until we've mounted on the client and
    // know the real viewport width. Rendering a branch before `isMobile` is known
    // would mount the desktop tree first and tear it down when `isMobile` flips —
    // and unmounting that Radix-heavy subtree triggers a compose-refs ref-detach
    // loop (React #185). Holding back `children` for one frame means the authed
    // layout mounts exactly once, in the correct mode, with no teardown.
    if (!hasMounted) {
        return <div className="w-full h-[100dvh] bg-surface-secondary" />;
    }

    // Mobile layout: Header + Content + Slide-out drawer
    if (isMobile) {
        return (
            <div className="w-full h-[100dvh] flex flex-col overflow-hidden">
                {/* Mobile Header */}
                <header className="flex-shrink-0 h-14 bg-surface-primary border-b border-stroke-subtle flex items-center px-4 gap-3">
                    <button
                        onClick={() => setSidebarOpen(true)}
                        className="p-2 -ml-2 rounded-lg hover:bg-interactive-hover transition-colors"
                        aria-label="Open menu"
                    >
                        <Menu className="w-5 h-5 text-content-primary" />
                    </button>

                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="font-semibold text-content-primary truncate">
                            {workflowName}
                        </span>
                    </div>

                    {showCanvasToggle && (
                        <button
                            onClick={() => setIsMobileCanvasOpen(true)}
                            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 -mr-1 rounded-lg text-sm font-medium text-accent-primary hover:bg-accent-primary/10 transition-colors"
                            aria-label="View canvas"
                        >
                            <Workflow className="w-4 h-4" />
                            <span>Canvas</span>
                        </button>
                    )}
                </header>

                {/* Main Content */}
                <main className="flex-1 overflow-hidden bg-surface-secondary">
                    {children}
                </main>

                {/* Slide-out Sidebar */}
                <Sidebar
                    isOpen={sidebarOpen}
                    onClose={() => setSidebarOpen(false)}
                />

                {/* Global "Your account" modal — opened from the sidebar profile menu. */}
                <AccountModal />
            </div>
        );
    }

    // Inside a chat SESSION (/chat/<id>) the canvas is live and space is precious,
    // so the nav becomes a compact app-menu pinned to the top-left corner that
    // overlays the canvas and lets the content reclaim full width. The empty chat
    // page (/chat, no session → no canvas, just the welcome screen) and every
    // other page (library, assets, nodes, settings) keep the traditional docked
    // sidebar column.
    const isCanvasRoute = /^\/chat\/[^/]+/.test(pathname);

    // Full-screen chat reuses the empty-page shell: the regular DOCKED sidebar
    // fills the page and the chat takes the remaining column. So a session route
    // only gets the compact floating sidebar while NOT in full-screen chat.
    const useFloatingSidebar = isCanvasRoute && !isChatFullscreen;

    // Single, stable layout tree across both route types: the Sidebar always
    // renders at the same position and we only swap its `variant`. This keeps it
    // mounted when navigating between a session and another page, so the session
    // list + its realtime subscription persist instead of refetching/reloading.
    //   - docked   → in-flow left column
    //   - floating → absolute top-left overlay (out of flow → content fills full width)
    return (
        <div className="w-full h-[100dvh] flex relative overflow-hidden bg-surface-secondary">
            <Sidebar variant={useFloatingSidebar ? 'floating' : 'docked'} />

            {/* Main Content */}
            <div className="flex-1 min-w-0 overflow-hidden bg-surface-secondary">
                {children}
            </div>

            {/* Global "Your account" modal — opened from the sidebar profile menu. */}
            <AccountModal />
        </div>
    );
}
