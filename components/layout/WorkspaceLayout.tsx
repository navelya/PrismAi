'use client';

import React, { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Workflow as WorkflowIcon,
    MessageSquare, Minimize2, Maximize2, Plus, X, Zap,
    ArrowLeft, Folder, Box, Building2,
    Image as ImageIcon, BookOpen
} from 'lucide-react';
import * as Icons from 'lucide-react';
import SharedWorkflowEditor from '@/components/editor/SharedWorkflowEditor';
import { useAppStore } from '@/lib/store/app-store';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { Workflow } from '@/lib/nodes/types';
import { AssetsPanel } from '@/components/editor/AssetsPanel';
import { TemplatesModal } from '@/components/editor/TemplatesModal';

interface WorkspaceLayoutProps {
    chatPanel: React.ReactNode;
    workflow: Workflow | null;
    onExecutionResult?: (result: any) => void;
    sessionId?: string;
}

// ─── Animation configs ────────────────────────────────────────────────────────
const RESIZE_TRANSITION = { type: 'tween' as const, ease: 'easeInOut' as const, duration: 0.25 };
const MORPH_SPRING = { type: 'spring' as const, stiffness: 380, damping: 28, mass: 0.6 };
const CANVAS_TRANSITION = { type: 'tween' as const, ease: 'easeOut' as const, duration: 0.4 };
const RAIL_SPRING = { type: 'spring' as const, stiffness: 340, damping: 30 };

const SIDEBAR_WIDTH = 340;
const SIDEBAR_HEIGHT = 600;
const PANEL_W = 320; // left-side panel width

// ─── Types ────────────────────────────────────────────────────────────────────
type ActivePanel = 'node-library' | 'assets' | 'templates' | null;

export default function WorkspaceLayout({ chatPanel, workflow, onExecutionResult, sessionId }: WorkspaceLayoutProps) {
    const isMobile = useIsMobile();

    // BOOTSTRAP (render-phase, runs once before the first paint):
    // Sync the store to the optimistic mode now so the first paint and every
    // store subscriber (chat panel included) agree.
    const hasBootstrappedMode = useRef(false);
    if (!hasBootstrappedMode.current) {
        hasBootstrappedMode.current = true;
        const store = useAppStore.getState();
        const wantCanvas = !!sessionId;
        if (store.isCanvasMode !== wantCanvas) store.setIsCanvasMode(wantCanvas);
        if (store.isCopilotMinimized) store.setIsCopilotMinimized(false);
    }

    const isCanvasMode = useAppStore(s => s.isCanvasMode);
    const setIsCanvasMode = useAppStore(s => s.setIsCanvasMode);
    const isCopilotMinimized = useAppStore(s => s.isCopilotMinimized);
    const setIsCopilotMinimized = useAppStore(s => s.setIsCopilotMinimized);

    // ── Unified panel state ───────────────────────────────────────────────────
    const [activePanel, setActivePanel] = useState<ActivePanel>(null);

    // MAINTENANCE: While the session is still loading (workflow not yet
    // resolved), keep canvas mode pinned. This defends against
    // `clearAllState()` in /chat/[id]/page.tsx, which fires AFTER our render
    // bootstrap and resets isCanvasMode to false. useLayoutEffect runs before
    // paint, so the user never sees the intermediate full-screen frame.
    const hasHandledInitialMode = useRef(false);
    useLayoutEffect(() => {
        if (hasHandledInitialMode.current) return;
        const store = useAppStore.getState();
        const wantCanvas = !!sessionId;
        if (store.isCanvasMode !== wantCanvas) store.setIsCanvasMode(wantCanvas);
        if (store.isCopilotMinimized) store.setIsCopilotMinimized(false);
    });

    // VERIFICATION: When the workflow lands, commit the final mode based on
    // whether it has nodes, then release the maintenance loop above.
    useEffect(() => {
        if (!sessionId || hasHandledInitialMode.current) return;

        if (workflow && workflow.id === sessionId) {
            const hasNodes = (workflow.nodes?.length || 0) > 0;
            setIsCanvasMode(hasNodes);
            setIsCopilotMinimized(false);
            hasHandledInitialMode.current = true;
        }
    }, [sessionId, workflow, setIsCanvasMode, setIsCopilotMinimized]);

    const togglePanel = useCallback((panel: ActivePanel) => {
        setActivePanel(prev => (prev === panel ? null : panel));
        // Close chat when switching to a left panel
        if (!isCopilotMinimized) setIsCopilotMinimized(true);
    }, [isCopilotMinimized, setIsCopilotMinimized]);

    const isNodeLibraryOpen = activePanel === 'node-library';
    const isAssetsOpen = activePanel === 'assets';
    const isTemplatesOpen = activePanel === 'templates';
    const hasLeftPanel = isNodeLibraryOpen || isAssetsOpen;

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


    // ── Node Library catalog ─────────────────────────────────────────────────
    const categories = useAppStore(s => s.categories);
    const nodeTypes = useAppStore(s => s.nodeTypes);
    const providers = useAppStore(s => s.providers);
    const models = useAppStore(s => s.models);
    const fetchCategories = useAppStore(s => s.fetchCategories);
    const fetchNodeTypes = useAppStore(s => s.fetchNodeTypes);
    const fetchProviders = useAppStore(s => s.fetchProviders);
    const fetchModels = useAppStore(s => s.fetchModels);

    const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
    const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);

    useEffect(() => {
        if (isNodeLibraryOpen) {
            fetchCategories(); fetchNodeTypes(); fetchProviders(); fetchModels();
        }
    }, [isNodeLibraryOpen, fetchCategories, fetchNodeTypes, fetchProviders, fetchModels]);

    // ── Container size for sidebar positioning ───────────────────────────────
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(([e]) => setContainerSize({ w: e.contentRect.width, h: e.contentRect.height }));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const PAD = 16;
    const TOP_BAR_OFFSET = 64; // clears the credits/upgrade pill at top-left of the canvas
    const canvasLeft = 16;  // matches left-4 = 16px (same as other panels)
    const canvasTop = TOP_BAR_OFFSET;
    const chatHeight = Math.max(SIDEBAR_HEIGHT, containerSize.h - TOP_BAR_OFFSET - PAD);

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
    if (isMobile) return <div className="w-full h-full flex flex-col">{chatPanel}</div>;

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
                        className="absolute left-4 bottom-4 z-[55] pointer-events-auto"
                        style={{ width: `${PANEL_W}px`, top: `${TOP_BAR_OFFSET}px` }}
                        initial={{ opacity: 0, x: -24 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -24 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                    >
                        <div className="relative w-full h-full bg-surface-elevated/80 backdrop-blur-md border border-stroke-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden">
                            {/* Floating controls */}
                            <div className="absolute top-2 left-2 right-2 z-10 flex items-center justify-between pointer-events-none">
                                <div className="pointer-events-auto">
                                    {(selectedCategoryId || selectedProviderId) && (
                                        <button onClick={() => { if (selectedProviderId) setSelectedProviderId(null); else setSelectedCategoryId(null); }} className="flex items-center gap-2 px-2 py-1.5 bg-surface-elevated/80 backdrop-blur-md rounded-lg text-content-primary hover:text-accent-primary transition-colors group">
                                            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
                                            <span className="text-xs font-bold uppercase tracking-widest">Back</span>
                                        </button>
                                    )}
                                </div>
                                <button onClick={() => { setActivePanel(null); setSelectedCategoryId(null); setSelectedProviderId(null); }} className="pointer-events-auto p-1.5 bg-surface-elevated/80 backdrop-blur-md hover:bg-white/10 rounded-lg transition-colors group" title="Close">
                                    <X className="w-4 h-4 text-content-tertiary group-hover:text-content-primary" />
                                </button>
                            </div>

                            {/* Content */}
                            <div className="flex-1 overflow-y-auto overflow-x-hidden relative pt-10">
                                {/* Level 1 */}
                                <div className={cn('absolute inset-0 p-4 space-y-8 transition-all duration-300', (selectedCategoryId || selectedProviderId) ? '-translate-x-full opacity-0 pointer-events-none' : 'translate-x-0 opacity-100')}>
                                    {/* Common Tools */}
                                    <div>
                                        <div className="flex items-center gap-2 mb-3">
                                            <div className="w-4 h-4 rounded-md bg-accent-primary/10 flex items-center justify-center">
                                                <Icons.Wrench className="w-2.5 h-2.5 text-accent-primary" />
                                            </div>
                                            <h4 className="text-[10px] font-bold uppercase tracking-widest text-content-tertiary">Common Tools</h4>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            {[
                                                { id: 'media_input', name: 'Media Input', icon: Icons.Image, desc: 'Image/Video' },
                                                { id: 'compositor', name: 'Compositor', icon: Icons.Layers, desc: 'Canvas' },
                                                { id: 'prompt', name: 'Prompt', icon: Icons.Type, desc: 'Text input' },
                                                { id: 'blur', name: 'Blur Filter', icon: Icons.Droplet, desc: 'Effect' }
                                            ].map(tool => (
                                                <div key={tool.id} draggable onDragStart={e => { e.dataTransfer.setData('application/reactflow', JSON.stringify({ type: tool.id })); e.dataTransfer.effectAllowed = 'move'; setActivePanel(null); }} className="flex items-center gap-3 p-2.5 rounded-xl border border-stroke-subtle bg-surface-primary hover:border-accent-primary hover:bg-accent-primary/5 transition-all cursor-move group shadow-sm">
                                                    <div className="w-8 h-8 rounded-lg bg-surface-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-accent-primary/10 transition-colors">
                                                        <tool.icon className="w-4 h-4 text-content-secondary group-hover:text-accent-primary transition-colors" />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-semibold text-[11px] text-content-primary truncate">{tool.name}</div>
                                                        <div className="text-[9px] text-content-tertiary truncate">{tool.desc}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Categories */}
                                    <div>
                                        <div className="flex items-center gap-2 mb-3">
                                            <div className="w-4 h-4 rounded-md bg-accent-primary/10 flex items-center justify-center">
                                                <Icons.Grid className="w-2.5 h-2.5 text-accent-primary" />
                                            </div>
                                            <h4 className="text-[10px] font-bold uppercase tracking-widest text-content-tertiary">Categories</h4>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            {categories.map(category => {
                                                const IconComponent = (Icons[category.icon_reference as keyof typeof Icons] as React.ComponentType<any>) || Folder;
                                                return (
                                                    <button key={category.id} onClick={() => setSelectedCategoryId(category.id)} className="flex items-center gap-3 p-2.5 rounded-xl border border-stroke-subtle bg-surface-primary hover:border-accent-primary hover:bg-accent-primary/5 transition-all group shadow-sm text-left">
                                                        <div className="w-8 h-8 rounded-lg bg-surface-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-accent-primary/10 transition-colors">
                                                            <IconComponent className="w-4 h-4 text-content-primary group-hover:text-accent-primary transition-colors" />
                                                        </div>
                                                        <span className="text-[11px] font-semibold text-content-primary truncate">{category.display_name}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Providers */}
                                    <div>
                                        <div className="flex items-center gap-2 mb-3">
                                            <div className="w-4 h-4 rounded-md bg-accent-primary/10 flex items-center justify-center">
                                                <Icons.Server className="w-2.5 h-2.5 text-accent-primary" />
                                            </div>
                                            <h4 className="text-[10px] font-bold uppercase tracking-widest text-content-tertiary">Providers</h4>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            {providers.map(provider => (
                                                <button key={provider.id} onClick={() => setSelectedProviderId(provider.id)} className="flex items-center gap-3 p-2.5 rounded-xl border border-stroke-subtle bg-surface-primary hover:border-accent-primary hover:bg-accent-primary/5 transition-all group shadow-sm text-left">
                                                    <div className="w-8 h-8 rounded-lg bg-surface-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-accent-primary/10 transition-colors overflow-hidden p-1.5">
                                                        {provider.logo_url ? <img src={provider.logo_url} alt={provider.name} className="w-full h-full object-contain" /> : <Building2 className="w-4 h-4 text-content-primary group-hover:text-accent-primary transition-colors" />}
                                                    </div>
                                                    <span className="text-[11px] font-semibold text-content-primary truncate">{provider.name}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    {/* Spacer to ensure scrolling hits the bottom comfortably */}
                                    <div className="h-4" />
                                </div>

                                {/* Level 2 */}
                                <div className={cn('absolute inset-0 p-4 space-y-3 transition-all duration-300', (selectedCategoryId || selectedProviderId) ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0 pointer-events-none')}>
                                    <div className="mb-4">
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-content-tertiary">{selectedCategoryId ? 'Nodes for Category' : 'Models from Provider'}</p>
                                        <h4 className="text-lg font-bold text-content-primary">
                                            {selectedCategoryId ? categories.find(c => c.id === selectedCategoryId)?.display_name : providers.find(p => p.id === selectedProviderId)?.name}
                                        </h4>
                                    </div>
                                    <div className="space-y-2 pb-8">
                                        {selectedCategoryId ? (
                                            nodeTypes.filter(nt => nt.parent_categories?.includes(selectedCategoryId)).map(nt => {
                                                const IconComp = (Icons[nt.icon_reference as keyof typeof Icons] as React.ComponentType<any>) || Zap;
                                                return (
                                                    <div key={nt.id} draggable onDragStart={e => { e.dataTransfer.setData('application/reactflow', JSON.stringify({ type: 'ai_generator', node_type_id: nt.id, archetype_id: nt.archetype_id })); e.dataTransfer.effectAllowed = 'move'; setActivePanel(null); }} className="flex items-center gap-3 p-3 border border-stroke-subtle rounded-xl cursor-move hover:border-accent-primary hover:bg-accent-primary/5 transition-all bg-surface-primary group shadow-sm">
                                                        <div className="w-10 h-10 rounded-lg bg-surface-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-accent-primary/10 transition-colors">
                                                            <IconComp className="w-5 h-5 text-content-secondary group-hover:text-accent-primary transition-colors" />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="font-bold text-sm text-content-primary">{nt.display_name}</div>
                                                            <div className="text-[10px] text-content-tertiary uppercase tracking-wider">Dynamic Node</div>
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            models.filter(m => m.provider_id === selectedProviderId).map(model => {
                                                const p = providers.find(prov => prov.id === model.provider_id);
                                                return (
                                                    <div key={model.id} draggable onDragStart={e => { e.dataTransfer.setData('application/reactflow', JSON.stringify({ type: 'ai_generator', node_type_id: model.node_type_id, model_id: model.id })); e.dataTransfer.effectAllowed = 'move'; setActivePanel(null); }} className="flex items-center gap-3 p-3 border border-stroke-subtle rounded-xl cursor-move hover:border-accent-primary hover:bg-accent-primary/5 transition-all bg-surface-primary group shadow-sm">
                                                        <div className="w-10 h-10 rounded-lg bg-surface-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-accent-primary/10 transition-colors overflow-hidden p-1.5">
                                                            {p?.logo_url ? <img src={p.logo_url} alt={p.name} className="w-full h-full object-contain" /> : <Box className="w-5 h-5 text-content-secondary group-hover:text-accent-primary transition-colors" />}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="font-bold text-sm text-content-primary truncate">{model.display_name}</div>
                                                            <div className="text-[10px] text-content-tertiary uppercase tracking-wider">{model.replicate_model_id.split(':')[0]}</div>
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                        {((selectedCategoryId && nodeTypes.filter(nt => nt.parent_categories?.includes(selectedCategoryId)).length === 0) || (selectedProviderId && models.filter(m => m.provider_id === selectedProviderId).length === 0)) && (
                                            <div className="flex flex-col items-center justify-center py-12 text-content-tertiary">
                                                <Icons.Inbox className="w-8 h-8 mb-2 opacity-20" />
                                                <span className="text-xs">No items found</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── LAYER 3b · Assets Panel ────────────────────────────────────── */}
            <AnimatePresence>
                {isCanvasMode && isAssetsOpen && (
                    <motion.div
                        key="assets-panel"
                        className="absolute left-4 bottom-4 z-[55] pointer-events-auto"
                        style={{ width: `${PANEL_W}px`, top: `${TOP_BAR_OFFSET}px` }}
                        initial={{ opacity: 0, x: -24 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -24 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                    >
                        <AssetsPanel sessionId={sessionId} onClose={() => setActivePanel(null)} />
                    </motion.div>
                )}
            </AnimatePresence>

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
                        className="absolute top-1/2 -translate-y-1/2 z-[1] pointer-events-auto"
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
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── LAYER 2 · Chat / Copilot ───────────────────────────────────── */}
            <motion.div
                key="chat"
                className={['absolute flex flex-col overflow-hidden', isCanvasMode ? 'z-[55] rounded-2xl border border-white/10 shadow-2xl shadow-black/50' : 'z-20'].join(' ')}
                initial={false}
                animate={
                    !isCanvasMode
                        ? { left: 0, top: 0, right: 0, bottom: 0, width: '100%' as any, height: '100%' as any, opacity: 1, x: 0, pointerEvents: 'auto' as any }
                        : isCopilotMinimized
                            ? { left: canvasLeft, top: canvasTop, bottom: PAD, width: SIDEBAR_WIDTH, height: chatHeight, opacity: 0, x: -24, pointerEvents: 'none' as any }
                            : { left: canvasLeft, top: canvasTop, bottom: PAD, width: SIDEBAR_WIDTH, height: chatHeight, opacity: 1, x: 0, pointerEvents: 'auto' as any }
                }
                transition={isCanvasMode ? { duration: 0.18, ease: 'easeOut' } : RESIZE_TRANSITION}
                style={isCanvasMode ? { backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)', background: 'rgba(12, 12, 16, 0.88)' } : { background: undefined }}
            >
                {/* Copilot controls — minimize / exit canvas */}
                <AnimatePresence>
                    {isCanvasMode && !isCopilotMinimized && (
                        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="absolute top-3 right-3 z-30 flex items-center gap-0.5 p-0.5 bg-surface-elevated/80 backdrop-blur-md border border-stroke-subtle rounded-full">
                            <button onClick={() => setIsCopilotMinimized(true)} className="p-1.5 rounded-full text-content-tertiary hover:text-content-primary hover:bg-white/10 transition-colors" title="Minimize copilot">
                                <Minimize2 className="w-3.5 h-3.5" />
                            </button>
                            <div className="w-[1px] h-3 bg-stroke-subtle" />
                            <button onClick={() => { setIsCanvasMode(false); setIsCopilotMinimized(false); }} className="p-1.5 rounded-full text-content-tertiary hover:text-content-primary hover:bg-white/10 transition-colors" title="Exit canvas mode">
                                <Maximize2 className="w-3.5 h-3.5" />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Canvas toggle pill (Chat Mode) — original design, do not change */}
                <AnimatePresence>
                    {!isCanvasMode && !!sessionId && (
                        <motion.button
                            key="canvas-toggle"
                            onClick={() => setIsCanvasMode(true)}
                            className="absolute top-4 right-4 z-30 flex items-center gap-1.5 px-3 py-1.5 bg-surface-elevated/90 backdrop-blur-sm border border-stroke-subtle rounded-full text-xs font-medium text-content-secondary hover:text-accent-primary hover:border-accent-primary/30 hover:bg-surface-elevated transition-all duration-200 shadow-sm hover:shadow-md group"
                            initial={{ opacity: 0, scale: 0.85 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.85 }}
                            transition={MORPH_SPRING}
                        >
                            <WorkflowIcon className="w-3.5 h-3.5 group-hover:text-accent-primary transition-colors" />
                            Workflow
                        </motion.button>
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
}

function ToolRail({ activePanel, panelOpen, isChatOpen, onChatClick, onPanelToggle }: ToolRailProps) {
    type Btn = { id: ActivePanel | 'chat'; label: string; icon: React.ComponentType<{ className?: string }>; onClick: () => void; isChat?: boolean };

    const buttons: Btn[] = [
        { id: 'chat', label: 'Chat', icon: MessageSquare, onClick: onChatClick, isChat: true },
        { id: 'node-library', label: 'Add Node', icon: Plus, onClick: () => onPanelToggle('node-library') },
        { id: 'assets', label: 'Assets', icon: ImageIcon, onClick: () => onPanelToggle('assets') },
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
                                whileTap={{ scale: 0.88 }}
                                className={cn(
                                    'relative flex items-center justify-center w-9 h-9 rounded-xl transition-all duration-200',
                                    isActive
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
