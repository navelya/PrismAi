'use client';

import React, { useRef, useState, useLayoutEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    MessageSquare, Minimize2, Plus,
    Image as ImageIcon, BookOpen, Users
} from 'lucide-react';
import SharedWorkflowEditor from '@/components/editor/SharedWorkflowEditor';
import { useAppStore } from '@/lib/store/app-store';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { Workflow } from '@/lib/nodes/types';
import { AssetsPanel } from '@/components/editor/AssetsPanel';
import { CharactersPanel } from '@/components/editor/CharactersPanel';
import { TemplatesModal } from '@/components/editor/TemplatesModal';
import NodeLibraryPanel from '@/components/editor/NodeLibraryPanel';

interface WorkspaceLayoutProps {
    chatPanel: React.ReactNode;
    workflow: Workflow | null;
    onExecutionResult?: (result: any) => void;
    sessionId?: string;
}

// ─── Animation configs ────────────────────────────────────────────────────────
const RESIZE_TRANSITION = { type: 'tween' as const, ease: 'easeInOut' as const, duration: 0.25 };
const CANVAS_TRANSITION = { type: 'tween' as const, ease: 'easeOut' as const, duration: 0.4 };
const RAIL_SPRING = { type: 'spring' as const, stiffness: 340, damping: 30 };

const SIDEBAR_WIDTH = 340;
const PANEL_W = 320; // left-side panel width

// ─── Types ────────────────────────────────────────────────────────────────────
type ActivePanel = 'node-library' | 'assets' | 'characters' | 'templates' | null;

export default function WorkspaceLayout({ chatPanel, workflow, onExecutionResult, sessionId }: WorkspaceLayoutProps) {
    const isMobile = useIsMobile();

    // Canvas mode is a pure derivation of sessionId — no toggle, no store
    // round-trip. Session → sidebar chat + canvas; welcome → full-screen chat.
    const isCanvasMode = !!sessionId;
    const isCopilotMinimized = useAppStore(s => s.isCopilotMinimized);
    const setIsCopilotMinimized = useAppStore(s => s.setIsCopilotMinimized);
    const isMobileCanvasOpen = useAppStore(s => s.isMobileCanvasOpen);
    const setIsMobileCanvasOpen = useAppStore(s => s.setIsMobileCanvasOpen);

    const isViewer = useAppStore(s => s.collabRole) === 'viewer';

    // ── Unified panel state ───────────────────────────────────────────────────
    const [activePanel, setActivePanel] = useState<ActivePanel>(null);

    // Panels that fetch from the server (assets, characters) stay mounted once
    // first opened — they only animate in/out, never unmount. This keeps their
    // data (and the Assets realtime subscription) alive across open/close, so
    // reopening is instant and there is no redundant refetch. Lazily tracked so
    // we don't pay the fetch for panels the user never opens. The chat panel
    // (LAYER 2) uses this same always-mounted pattern.
    const [mountedPanels, setMountedPanels] = useState<Set<ActivePanel>>(() => new Set());

    // Reset transient sidebar visibility when the session changes so a stale
    // "chat minimized" toggle from a previous session doesn't carry over.
    useLayoutEffect(() => {
        if (useAppStore.getState().isCopilotMinimized) {
            useAppStore.getState().setIsCopilotMinimized(false);
        }
        // A stale "canvas open" toggle from a previous session must not carry
        // over — always land on the chat view when a session changes.
        if (useAppStore.getState().isMobileCanvasOpen) {
            useAppStore.getState().setIsMobileCanvasOpen(false);
        }
    }, [sessionId]);

    const togglePanel = useCallback((panel: ActivePanel) => {
        if (isViewer) return;
        setActivePanel(prev => (prev === panel ? null : panel));
        // Mark data-fetching panels as mounted on first open so they persist.
        if (panel === 'assets' || panel === 'characters') {
            setMountedPanels(prev => (prev.has(panel) ? prev : new Set(prev).add(panel)));
        }
        // Close chat when switching to a left panel
        if (!isCopilotMinimized) setIsCopilotMinimized(true);
    }, [isViewer, isCopilotMinimized, setIsCopilotMinimized]);

    const isNodeLibraryOpen = activePanel === 'node-library';
    const isAssetsOpen = activePanel === 'assets';
    const isCharactersOpen = activePanel === 'characters';
    const isTemplatesOpen = activePanel === 'templates';
    const hasLeftPanel = isNodeLibraryOpen || isAssetsOpen || isCharactersOpen;

    // Chat is open when copilot is not minimized (in canvas mode)
    const isChatOpen = isCanvasMode && !isCopilotMinimized;

    // Chat button click: if chat is open → minimize; if closed → open (and close any left panel)
    const handleChatToggle = useCallback(() => {
        if (isChatOpen) {
            setIsCopilotMinimized(true);
        } else {
            setActivePanel(null); // close any left-side panel
            setIsCopilotMinimized(false);
        }
    }, [isChatOpen, setIsCopilotMinimized]);


    const containerRef = useRef<HTMLDivElement>(null);
    const PAD = 16;
    const TOP_BAR_OFFSET = 64; // clears the credits/upgrade pill at top-left of the canvas
    const canvasLeft = 16;  // matches left-4 = 16px (same as other panels)
    const canvasTop = TOP_BAR_OFFSET;

    // Rail left position:
    //   chat open  → right edge of chat panel (PAD + SIDEBAR_WIDTH + gap)
    //   left panel → right edge of left panel (16 + PANEL_W + gap)
    //   nothing    → 16 (left-4)
    const railLeft = isChatOpen
        ? PAD + SIDEBAR_WIDTH + 8
        : hasLeftPanel
            ? 16 + PANEL_W + 8
            : 16;

    // ── Template load handler ─────────────────────────────────────────────────
    const handleLoadTemplate = (partial: { nodes: any[]; edges: any[] }) => {
        const newWorkflow: Workflow = { id: '', name: 'Untitled Workflow', nodes: partial.nodes, edges: partial.edges };
        useAppStore.getState().setCurrentWorkflow(newWorkflow, false);
        setActivePanel(null);
    };

    // ── Mobile ────────────────────────────────────────────────────────────────
    // Chat is the default surface; tapping "Canvas" in the header reveals a
    // read-only canvas underneath while the chat collapses toward a floating
    // bubble (bottom-left) that brings it back.
    if (isMobile) {
        return (
            <div className="relative w-full h-full overflow-hidden bg-surface-primary">
                {/* Read-only canvas — mounted only while open so it doesn't run
                    its draw loops behind the chat. fitView (inside EditorCanvas)
                    frames the whole graph to the mobile viewport on mount. */}
                {isCanvasMode && isMobileCanvasOpen && (
                    <div className="absolute inset-0">
                        <SharedWorkflowEditor
                            key={(sessionId || 'empty') + '-mobile-canvas'}
                            workflow={workflow}
                            showToolbar={false}
                            showResultsPanel={false}
                            readOnly
                        />
                    </div>
                )}

                {/* Chat surface — collapses down/out toward the bubble. */}
                <motion.div
                    className="absolute inset-0 z-20 flex flex-col bg-surface-secondary"
                    initial={false}
                    animate={isCanvasMode && isMobileCanvasOpen
                        ? { y: '100%', opacity: 0, scale: 0.96, pointerEvents: 'none' as any }
                        : { y: '0%', opacity: 1, scale: 1, pointerEvents: 'auto' as any }}
                    transition={{ type: 'tween', ease: 'easeInOut', duration: 0.3 }}
                    style={{ transformOrigin: 'bottom left' }}
                >
                    {chatPanel}
                </motion.div>

                {/* Floating chat bubble — returns to the chat from the canvas. */}
                <AnimatePresence>
                    {isCanvasMode && isMobileCanvasOpen && (
                        <motion.button
                            key="chat-bubble"
                            onClick={() => setIsMobileCanvasOpen(false)}
                            initial={{ opacity: 0, scale: 0.4, y: 24 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.4, y: 24 }}
                            transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                            whileTap={{ scale: 0.9 }}
                            className="absolute bottom-5 left-5 z-50 w-14 h-14 rounded-full bg-accent-primary text-content-inverted shadow-2xl shadow-black/40 flex items-center justify-center"
                            aria-label="Back to chat"
                        >
                            <MessageSquare className="w-6 h-6" />
                        </motion.button>
                    )}
                </AnimatePresence>
            </div>
        );
    }

    // ── Desktop ───────────────────────────────────────────────────────────────
    return (
        <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-surface-primary">

            {/* ── LAYER 1 · Canvas ──────────────────────────────────────────── */}
            <motion.div
                className="absolute inset-0"
                animate={{ filter: isCanvasMode ? 'blur(0px) brightness(1)' : 'blur(14px) brightness(0.3)', pointerEvents: isCanvasMode ? 'auto' : 'none' }}
                transition={CANVAS_TRANSITION}
                style={{ willChange: 'filter' }}
            >
                <SharedWorkflowEditor
                    key={sessionId || 'empty-session-canvas'}
                    workflow={workflow}
                    showToolbar={true}
                    showResultsPanel={false}
                    readOnly={false}
                    onExecutionComplete={result => { if (onExecutionResult) onExecutionResult(result); }}
                />
            </motion.div>

            {/* ── LAYER 3a · Node Library Panel ─────────────────────────────── */}
            <AnimatePresence>
                {isCanvasMode && isNodeLibraryOpen && (
                    <motion.div
                        key="node-library"
                        className="marquee-passthrough absolute left-4 bottom-4 z-[55] pointer-events-auto"
                        style={{ width: `${PANEL_W}px`, top: `${TOP_BAR_OFFSET}px` }}
                        initial={{ opacity: 0, x: -24 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -24 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                    >
                        <NodeLibraryPanel onClose={() => setActivePanel(null)} />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── LAYER 3b · Assets Panel ────────────────────────────────────── */}
            {/* Mounted once first opened, then animated in/out — never unmounted,
                so its data + realtime subscription survive close/reopen. */}
            {isCanvasMode && mountedPanels.has('assets') && (
                <motion.div
                    key="assets-panel"
                    className="marquee-passthrough absolute left-4 bottom-4 z-[55]"
                    style={{ width: `${PANEL_W}px`, top: `${TOP_BAR_OFFSET}px` }}
                    initial={{ opacity: 0, x: -24 }}
                    animate={isAssetsOpen
                        ? { opacity: 1, x: 0, pointerEvents: 'auto' as any }
                        : { opacity: 0, x: -24, pointerEvents: 'none' as any }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                >
                    <AssetsPanel sessionId={sessionId} onClose={() => setActivePanel(null)} />
                </motion.div>
            )}

            {/* ── LAYER 3b' · Characters Panel ───────────────────────────────── */}
            {isCanvasMode && mountedPanels.has('characters') && (
                <motion.div
                    key="characters-panel"
                    className="marquee-passthrough absolute left-4 bottom-4 z-[55]"
                    style={{ width: `${PANEL_W}px`, top: `${TOP_BAR_OFFSET}px` }}
                    initial={{ opacity: 0, x: -24 }}
                    animate={isCharactersOpen
                        ? { opacity: 1, x: 0, pointerEvents: 'auto' as any }
                        : { opacity: 0, x: -24, pointerEvents: 'none' as any }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                >
                    <CharactersPanel onClose={() => setActivePanel(null)} />
                </motion.div>
            )}

            {/* ── LAYER 3c · Templates Modal ─────────────────────────────────── */}
            <TemplatesModal
                isOpen={isCanvasMode && isTemplatesOpen}
                onClose={() => setActivePanel(null)}
                onLoad={handleLoadTemplate}
            />

            {/* ── LAYER 4 · Vertical Tool Rail (always visible in canvas mode) ── */}
            <AnimatePresence>
                {isCanvasMode && (
                    <motion.div
                        key="tool-rail"
                        className="marquee-passthrough absolute top-1/2 -translate-y-1/2 z-[1] pointer-events-auto"
                        animate={{ left: railLeft, opacity: 1, x: 0 }}
                        initial={{ opacity: 0, x: -16 }}
                        exit={{ opacity: 0, x: -16 }}
                        transition={RAIL_SPRING}
                    >
                        <ToolRail
                            activePanel={activePanel}
                            panelOpen={hasLeftPanel || isChatOpen}
                            isChatOpen={isChatOpen}
                            onChatClick={handleChatToggle}
                            onPanelToggle={togglePanel}
                            isViewer={isViewer}
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── LAYER 2 · Chat / Copilot ───────────────────────────────────── */}
            <motion.div
                key="chat"
                className={['marquee-passthrough absolute flex flex-col overflow-hidden', isCanvasMode ? 'z-[55] rounded-2xl border border-white/10 shadow-2xl shadow-black/50' : 'z-20'].join(' ')}
                initial={false}
                animate={
                    !isCanvasMode
                        ? { left: 0, top: 0, right: 0, bottom: 0, width: '100%' as any, height: '100%' as any, opacity: 1, x: 0, pointerEvents: 'auto' as any }
                        : isCopilotMinimized
                            ? { left: canvasLeft, top: canvasTop, bottom: PAD, width: SIDEBAR_WIDTH, opacity: 0, x: -24, pointerEvents: 'none' as any }
                            : { left: canvasLeft, top: canvasTop, bottom: PAD, width: SIDEBAR_WIDTH, opacity: 1, x: 0, pointerEvents: 'auto' as any }
                }
                transition={isCanvasMode ? { duration: 0.18, ease: 'easeOut' } : RESIZE_TRANSITION}
                style={isCanvasMode ? { backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)', background: 'rgba(12, 12, 16, 0.88)' } : { background: undefined }}
            >
                {/* Copilot minimize control — only on session pages */}
                <AnimatePresence>
                    {isCanvasMode && !isCopilotMinimized && (
                        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="absolute top-3 right-3 z-30 flex items-center gap-0.5 p-0.5 bg-surface-elevated/80 backdrop-blur-md border border-stroke-subtle rounded-full">
                            <button onClick={() => setIsCopilotMinimized(true)} className="p-1.5 rounded-full text-content-tertiary hover:text-content-primary hover:bg-white/10 transition-colors" title="Minimize copilot">
                                <Minimize2 className="w-3.5 h-3.5" />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Chat content */}
                <div className="flex-1 min-h-0 overflow-hidden">
                    {chatPanel}
                </div>
            </motion.div>
        </div>
    );
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function cn(...classes: any[]) { return classes.filter(Boolean).join(' '); }

// ─── Tool Rail ────────────────────────────────────────────────────────────────

interface ToolRailProps {
    activePanel: ActivePanel;
    /** True when any panel (left or chat) is open */
    panelOpen: boolean;
    /** True when the chat sidebar is open */
    isChatOpen: boolean;
    onChatClick: () => void;
    onPanelToggle: (panel: ActivePanel) => void;
    /** Viewer role — non-chat panel buttons are visually disabled */
    isViewer?: boolean;
}

function ToolRail({ activePanel, panelOpen, isChatOpen, onChatClick, onPanelToggle, isViewer = false }: ToolRailProps) {
    type Btn = { id: ActivePanel | 'chat'; label: string; icon: React.ComponentType<{ className?: string }>; onClick: () => void; isChat?: boolean };

    const buttons: Btn[] = [
        { id: 'chat', label: 'Chat', icon: MessageSquare, onClick: onChatClick, isChat: true },
        { id: 'node-library', label: 'Add Node', icon: Plus, onClick: () => onPanelToggle('node-library') },
        { id: 'assets', label: 'Assets', icon: ImageIcon, onClick: () => onPanelToggle('assets') },
        { id: 'characters', label: 'Characters', icon: Users, onClick: () => onPanelToggle('characters') },
        { id: 'templates', label: 'Templates', icon: BookOpen, onClick: () => onPanelToggle('templates') },
    ];

    return (
        <div className={cn(
            'flex flex-col gap-1 py-2 px-1.5',
            panelOpen
                // Attached mode: minimal, blends with panel edge
                ? 'rounded-r-2xl bg-surface-elevated/75 backdrop-blur-md border border-l-0 border-stroke-subtle shadow-lg'
                // Floating mode: full glassmorphism pill
                : 'rounded-2xl bg-surface-elevated/90 backdrop-blur-md border border-stroke-subtle shadow-xl shadow-black/30'
        )}>
            {buttons.map((btn, index) => {
                // Active: non-chat panels check activePanel; chat button checks isChatOpen
                const isActive = btn.isChat ? isChatOpen : activePanel === btn.id;
                const Icon = btn.icon;
                return (
                    <React.Fragment key={btn.id}>
                        {index === 1 && <div className="w-full h-px bg-stroke-subtle my-0.5 mx-auto" style={{ width: '60%' }} />}

                        {/* Tooltip wrapper */}
                        <div className="relative group">
                            <motion.button
                                onClick={btn.onClick}
                                whileTap={isViewer && !btn.isChat ? {} : { scale: 0.88 }}
                                disabled={isViewer && !btn.isChat}
                                className={cn(
                                    'relative flex items-center justify-center w-9 h-9 rounded-xl transition-all duration-200',
                                    isViewer && !btn.isChat
                                        ? 'opacity-40 cursor-not-allowed text-content-tertiary'
                                        : isActive
                                            ? 'bg-accent-primary/15 text-accent-primary'
                                            : btn.isChat
                                                ? 'text-accent-primary hover:bg-accent-primary/10'
                                                : 'text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary'
                                )}
                                aria-label={btn.label}
                            >
                                {isActive && (
                                    <motion.span
                                        layoutId="rail-dot"
                                        className="absolute top-1 right-1 w-1 h-1 rounded-full bg-accent-primary"
                                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                                    />
                                )}
                                <Icon className="w-[17px] h-[17px]" />
                            </motion.button>

                            {/* Tooltip — right side */}
                            <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-[70] opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 ease-out">
                                <div className="px-2.5 py-1.5 rounded-lg bg-surface-elevated border border-stroke-subtle shadow-lg shadow-black/30 whitespace-nowrap">
                                    <span className="text-[11px] font-semibold text-content-primary">{btn.label}</span>
                                </div>
                            </div>
                        </div>
                    </React.Fragment>
                );
            })}
        </div>
    );
}
