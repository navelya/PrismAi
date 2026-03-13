'use client';

import React, { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Workflow as WorkflowIcon, MessageSquare, Minimize2, Maximize2, Plus, X, Zap } from 'lucide-react';
import SharedWorkflowEditor from '@/components/editor/SharedWorkflowEditor';
import { useAppStore } from '@/lib/store/app-store';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { Workflow } from '@/lib/nodes/types';

interface WorkspaceLayoutProps {
    chatPanel: React.ReactNode;
    workflow: Workflow | null;
    onExecutionResult?: (result: any) => void;
    sessionId?: string;
}

// ─── Animation configs ────────────────────────────────────────────────────────
// Fix 4a: Chat → Sidebar = clean CSS width tween (no morph, no scale)
const RESIZE_TRANSITION = {
    type: 'tween' as const,
    ease: 'easeInOut' as const,
    duration: 0.25,
};

// Fix 4b: Sidebar → FAB = playful spring morph/scale
const MORPH_SPRING = {
    type: 'spring' as const,
    stiffness: 380,
    damping: 28,
    mass: 0.6,
};

// Canvas blur/reveal — cinematic
const CANVAS_TRANSITION = {
    type: 'tween' as const,
    ease: 'easeOut' as const,
    duration: 0.4,
};

const SIDEBAR_WIDTH = 340;
const SIDEBAR_HEIGHT = 520; // Increased for better aspect ratio

export default function WorkspaceLayout({
    chatPanel,
    workflow,
    onExecutionResult,
    sessionId,
}: WorkspaceLayoutProps) {
    const isMobile = useIsMobile();
    const isCanvasMode = useAppStore((s) => s.isCanvasMode);
    const setIsCanvasMode = useAppStore((s) => s.setIsCanvasMode);
    const isCopilotMinimized = useAppStore((s) => s.isCopilotMinimized);
    const setIsCopilotMinimized = useAppStore((s) => s.setIsCopilotMinimized);
    const [isNodeLibraryOpen, setIsNodeLibraryOpen] = useState(false);

    // Measure the container so we can compute numeric left/top for the sidebar.
    // This avoids `left: 'auto'` which Framer Motion cannot tween (causing the
    // end-of-minimize snap). With exact pixel values, both directions animate cleanly.
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            setContainerSize({ w: width, h: height });
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Exact pixel position for the sidebar — numerically tweeneable (NOW DOCKED LEFT)
    const PAD = 20;
    const canvasLeft = PAD;
    const canvasTop = Math.max(0, containerSize.h - SIDEBAR_HEIGHT - PAD);

    const hasWorkflow = !!workflow;

    // ── Mobile ────────────────────────────────────────────────────────────────
    if (isMobile) {
        return <div className="w-full h-full flex flex-col">{chatPanel}</div>;
    }

    // ── Desktop ───────────────────────────────────────────────────────────────
    return (
        <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-surface-primary">

            {/* ─────────── LAYER 1 · Canvas ───────────────────────────────────── */}
            <motion.div
                className="absolute inset-0"
                animate={{
                    filter: isCanvasMode
                        ? 'blur(0px) brightness(1)'
                        : 'blur(14px) brightness(0.3)',
                    pointerEvents: isCanvasMode ? 'auto' : 'none',
                }}
                transition={CANVAS_TRANSITION}
                style={{ willChange: 'filter' }}
            >
                <SharedWorkflowEditor
                    key={sessionId || 'empty-session-canvas'}
                    workflow={workflow}
                    showToolbar={true}
                    showResultsPanel={false}
                    readOnly={false}
                    onExecutionComplete={(result) => {
                        if (onExecutionResult) onExecutionResult(result);
                    }}
                />
            </motion.div>

            {/* ─────────── LAYER 3 · Node Library Panel ───────────────────── */}
            <AnimatePresence>
                {isCanvasMode && isNodeLibraryOpen && (
                    <motion.div
                        key="node-library"
                        className="absolute left-4 top-4 bottom-4 z-[55] pointer-events-auto"
                        style={{ width: '320px' }}
                        initial={{ opacity: 0, x: -24 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -24 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                    >
                        <div className="w-full h-full bg-surface-elevated/80 backdrop-blur-md border border-stroke-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden">
                            {/* Header — same as PropertyPanel */}
                            <div className="flex items-center justify-between p-4 bg-white/5 border-b border-stroke-subtle flex-shrink-0">
                                <div className="flex items-center gap-2">
                                    <div className="w-1 h-3 bg-accent-primary rounded-full" />
                                    <h3 className="font-bold text-sm text-content-primary">Node Library</h3>
                                </div>
                                <button
                                    onClick={() => setIsNodeLibraryOpen(false)}
                                    className="p-1.5 hover:bg-white/10 rounded-lg transition-colors group"
                                >
                                    <X className="w-4 h-4 text-content-tertiary group-hover:text-content-primary" />
                                </button>
                            </div>

                            {/* Content */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-content-tertiary">Dynamic Nodes</p>

                                {/* AI Generator Card — the only node */}
                                <div
                                    draggable
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData('application/reactflow', 'ai_generator');
                                        e.dataTransfer.effectAllowed = 'move';
                                        setIsNodeLibraryOpen(false);
                                    }}
                                    className="group/card flex items-start gap-3 p-4 border border-accent-primary/20 hover:border-accent-primary/50 rounded-xl cursor-move bg-accent-primary/5 hover:bg-accent-primary/10 transition-all duration-200 hover:shadow-lg hover:shadow-accent-primary/10"
                                >
                                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-accent-primary/10 border border-accent-primary/20 group-hover/card:bg-accent-primary/20 transition-colors">
                                        <Zap className="w-5 h-5 text-accent-primary" />
                                    </div>
                                    <div className="flex-1 min-w-0 pt-0.5">
                                        <div className="font-bold text-sm text-content-primary">AI Generator</div>
                                        <div className="text-xs text-content-secondary mt-1 leading-relaxed">
                                            Dynamic AI model node. Drag onto canvas and select any model — handles and controls are built automatically from the model schema.
                                        </div>
                                        <div className="mt-2 text-[10px] font-bold text-accent-primary uppercase tracking-widest">Drag to place ↗</div>
                                    </div>
                                </div>

                                {/* Hint */}
                                <div className="p-3 bg-white/5 border border-stroke-subtle rounded-xl">
                                    <p className="text-[10px] text-content-tertiary leading-relaxed">
                                        The AI Generator node auto-configures its inputs, outputs, and controls from the model registered in the Admin Panel.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ─────────── LAYER 2 · Chat / Copilot ──────────────────────────── */}
            <AnimatePresence mode="popLayout" initial={false}>
                {isCanvasMode && isCopilotMinimized ? (
                    /* ── FAB GROUP · DOCKED LEFT ──────────── */
                    <motion.div
                        key="fab"
                        className="absolute bottom-6 left-6 z-50 flex items-center gap-2"
                        initial={{ opacity: 0, scale: 0.3 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.3 }}
                        transition={MORPH_SPRING}
                    >
                        {/* Chat open button */}
                        <motion.button
                            onClick={() => setIsCopilotMinimized(false)}
                            className="w-14 h-14 rounded-full bg-surface-elevated border border-stroke-subtle shadow-xl shadow-black/40 flex items-center justify-center"
                            aria-label="Open Copilot"
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                        >
                            <MessageSquare className="w-6 h-6 text-accent-primary" />
                        </motion.button>

                        {/* Node Library toggle button — same style */}
                        <motion.button
                            onClick={() => setIsNodeLibraryOpen(prev => !prev)}
                            className={`w-14 h-14 rounded-full border shadow-xl shadow-black/40 flex items-center justify-center transition-colors ${isNodeLibraryOpen
                                ? 'bg-accent-primary border-accent-primary text-white'
                                : 'bg-surface-elevated border-stroke-subtle'
                                }`}
                            aria-label="Node Library"
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            title="Node Library"
                        >
                            <Plus className={`w-6 h-6 ${isNodeLibraryOpen ? 'text-white' : 'text-accent-primary'}`} />
                        </motion.button>
                    </motion.div>

                ) : (
                    /* ── Chat/Sidebar · tween RESIZE · always absolute (no position switch) ── */
                    <motion.div
                        key="chat"
                        className={[
                            'absolute z-20 flex flex-col overflow-hidden',
                            isCanvasMode
                                ? 'rounded-2xl border border-white/10 shadow-2xl shadow-black/50'
                                : '',
                        ].join(' ')}
                        // Animate ALL 6 geometric values explicitly so both directions are
                        // perfectly symmetrical — position type never changes, no jump.
                        animate={
                            isCanvasMode
                                ? {
                                    // Canvas: computed pixel position (Docked LEFT)
                                    left: canvasLeft,
                                    top: canvasTop,
                                    bottom: PAD,
                                    width: SIDEBAR_WIDTH,
                                    height: SIDEBAR_HEIGHT,
                                    opacity: 1,
                                }
                                : {
                                    // Chat: fill parent
                                    left: 0,
                                    top: 0,
                                    right: 0,
                                    bottom: 0,
                                    width: '100%' as any,
                                    height: '100%' as any,
                                    opacity: 1,
                                }
                        }
                        initial={false}
                        transition={RESIZE_TRANSITION}
                        style={
                            isCanvasMode
                                ? {
                                    backdropFilter: 'blur(24px) saturate(180%)',
                                    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                                    background: 'rgba(12, 12, 16, 0.88)',
                                }
                                : {
                                    background: undefined,
                                }
                        }
                    >
                        {/* ── Copilot Floating Controls ─── */}
                        <AnimatePresence>
                            {isCanvasMode && (
                                <motion.div
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    className="absolute top-3 right-3 z-30 flex items-center gap-0.5 p-0.5 bg-surface-elevated/80 backdrop-blur-md border border-stroke-subtle rounded-full"
                                >
                                    <button
                                        onClick={() => setIsCopilotMinimized(true)}
                                        className="p-1.5 rounded-full text-content-tertiary hover:text-content-primary hover:bg-white/10 transition-colors"
                                        title="Minimize copilot"
                                    >
                                        <Minimize2 className="w-3.5 h-3.5" />
                                    </button>
                                    <div className="w-[1px] h-3 bg-stroke-subtle" />
                                    <button
                                        onClick={() => { setIsCanvasMode(false); setIsCopilotMinimized(false); }}
                                        className="p-1.5 rounded-full text-content-tertiary hover:text-content-primary hover:bg-white/10 transition-colors"
                                        title="Exit canvas mode"
                                    >
                                        <Maximize2 className="w-3.5 h-3.5" />
                                    </button>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* ── Canvas toggle pill (Chat Mode, top-right) ─── */}
                        <AnimatePresence>
                            {!isCanvasMode && !!sessionId && (
                                <motion.button
                                    key="canvas-toggle"
                                    onClick={() => setIsCanvasMode(true)}
                                    className="absolute top-4 right-4 z-30 flex items-center gap-1.5 px-3 py-1.5 bg-surface-elevated/90 backdrop-blur-sm border border-stroke-subtle rounded-full text-xs font-medium text-content-secondary hover:text-accent-primary hover:border-accent-primary/30 hover:bg-surface-elevated transition-all duration-200 shadow-sm hover:shadow-md group"
                                    initial={{ opacity: 0, scale: 0.85 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.85 }}
                                    transition={{ duration: 0.15, delay: 0.1 }}
                                    title="Open canvas"
                                >
                                    <WorkflowIcon className="w-3.5 h-3.5 transition-transform group-hover:scale-110" />
                                    <span>Canvas</span>
                                </motion.button>
                            )}
                        </AnimatePresence>

                        {/* ── Chat content — fills remaining space, clips cleanly ── */}
                        <div className="flex-1 min-h-0 overflow-hidden">
                            {chatPanel}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
