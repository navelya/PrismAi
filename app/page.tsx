'use client';

import React, { useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { motion, useScroll, useTransform } from 'framer-motion';
import ReactFlow, {
    Node,
    Edge,
    Handle,
    Position,
    ReactFlowProvider,
    useNodesState,
    useEdgesState,
    useReactFlow
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
    ArrowRight,
    Play,
    Workflow,
    Activity,
    Target,
    Image as ImageIcon,
    Sparkles
} from 'lucide-react';
import { BrandCarousel } from '@/components/ui/BrandCarousel';
import { useSession } from '@/lib/hooks/use-session';
import { cn } from '@/lib/utils';

// =============================================================================
// UNIQUE BRAND ICONS (Custom SVG)
// =============================================================================

const BrandIcon = ({ type, className }: { type: string, className?: string }) => {
    const icons: Record<string, React.ReactNode> = {
        core: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <path d="M9 9h6v6H9z" fill="currentColor" fillOpacity="0.1" />
                <path d="M12 4v2m0 14v2M4 12h2m14 0h2" />
            </svg>
        ),
        layers: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5M2 12l10 5 10-5" opacity="0.5" />
            </svg>
        ),
        secure: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <circle cx="12" cy="12" r="3" fill="currentColor" fillOpacity="0.1" />
            </svg>
        ),
        speed: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
        ),
        mesh: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                <path d="M2 12h20" />
            </svg>
        ),
        bridge: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
                <path d="M4 17V7a2 2 0 012-2h12a2 2 0 012 2v10" />
                <path d="M4 12h16M12 5v14" />
            </svg>
        )
    };
    return <>{icons[type] || icons.core}</>;
};

const PrisfolLogo = ({ className, dark = false }: { className?: string, dark?: boolean }) => (
    <div className={cn("flex items-center gap-2", className)}>
        <div className="relative w-6 h-6">
            <div className={cn("absolute inset-0 transform rotate-45 rounded-sm opacity-20", dark ? "bg-white" : "bg-accent-primary")} />
            <div className={cn("absolute inset-1 border-2 transform rotate-45 rounded-sm", dark ? "border-white" : "border-accent-primary")} />
            <div className={cn("absolute inset-[8px] rounded-full", dark ? "bg-white/40" : "bg-accent-secondary")} />
        </div>
        <span className={cn("text-base font-black tracking-tighter font-display uppercase", dark ? "text-white" : "text-slate-900")}>Prisfol</span>
    </div>
);

const SectionHeader = ({ tag, title, description, dark = false, center = false }: { tag: string, title: string, description?: string, dark?: boolean, center?: boolean }) => (
    <motion.div
        initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
        whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        className={cn("mb-12 space-y-3", center && "text-center flex flex-col items-center")}
    >
        <span className="text-[7px] font-black uppercase tracking-[0.5em] text-accent-primary opacity-60">{tag}</span>
        <h2 className={cn(
            "text-2xl md:text-4xl font-black leading-tight uppercase font-display",
            dark ? "text-white" : "text-slate-900"
        )}>
            {title}
        </h2>
        {description && (
            <p className={cn(
                "text-xs max-w-lg leading-relaxed font-bold uppercase tracking-wider",
                dark ? "text-slate-400" : "text-slate-500"
            )}>
                {description}
            </p>
        )}
    </motion.div>
);

// =============================================================================
// REACT FLOW DEMO COMPONENTS
// =============================================================================

const DemoNode = ({ data }: any) => (
    <div className="flex flex-col gap-2 group">
        <Handle type="target" position={Position.Left} className="w-0 h-0 border-none bg-transparent" />
        <div className="flex items-center gap-1.5 px-1">
            <data.icon className="w-2.5 h-2.5 text-accent-primary" />
            <span className="text-[7px] font-black uppercase tracking-[0.2em] text-slate-400 group-hover:text-accent-primary transition-colors">{data.title}</span>
        </div>
        <div className={cn(
            "relative rounded-xl overflow-hidden border border-slate-200 bg-white shadow-xl transition-all duration-700 group-hover:shadow-2xl group-hover:border-accent-primary/40",
            data.type === 'image' ? "w-32 h-32 md:w-36 md:h-36" : "w-48 md:w-52 p-4"
        )}>
            {data.type === 'image' ? (
                <img src={data.image} className="w-full h-full object-cover grayscale-[40%] group-hover:grayscale-0 transition-all duration-700" alt={data.title} />
            ) : (
                <p className="text-[9px] text-slate-500 leading-relaxed font-bold uppercase tracking-tight">
                    {data.image}
                </p>
            )}
        </div>
        <Handle type="source" position={Position.Right} className="w-0 h-0 border-none bg-transparent" />
    </div>
);

const nodeTypes = { demo: DemoNode };

const initialNodes: Node[] = [
    { id: '1', type: 'demo', position: { x: 0, y: 0 }, data: { title: 'SOURCE_ALPHA', icon: ImageIcon, image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400', type: 'image' } },
    { id: '2', type: 'demo', position: { x: 0, y: 170 }, data: { title: 'ASSET_BETA', icon: Target, image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&q=80&w=400', type: 'image' } },
    { id: '3', type: 'demo', position: { x: 220, y: 85 }, data: { title: 'NEURAL_PROMPT', icon: Sparkles, type: 'prompt', image: 'MAXIMUM PRECISION. CINEMATIC TEXTURE. MINIMALIST BALANCE. OPTIMIZED ENGINE.' } },
    { id: '4', type: 'demo', position: { x: 500, y: 85 }, data: { title: 'PROCESS_FRAME', icon: Activity, image: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&q=80&w=400', type: 'image' } },
    { id: '5', type: 'demo', position: { x: 740, y: 85 }, data: { title: 'FINAL_OUTPUT', icon: Play, image: 'https://images.unsplash.com/photo-1492707892479-7bc8d5a4ee93?auto=format&fit=crop&q=80&w=400', type: 'image' } },
];

const initialEdges: Edge[] = [
    { id: 'e1-3', source: '1', target: '3', style: { stroke: '#cbd5e1', strokeWidth: 2 } },
    { id: 'e2-3', source: '2', target: '3', style: { stroke: '#cbd5e1', strokeWidth: 2 } },
    { id: 'e3-4', source: '3', target: '4', style: { stroke: '#cbd5e1', strokeWidth: 2 } },
    { id: 'e4-5', source: '4', target: '5', style: { stroke: '#cbd5e1', strokeWidth: 2 } },
];

// =============================================================================
// INTERACTIVE WORKFLOW DEMO COMPONENT
// =============================================================================

function InteractiveWorkflowDemoInner() {
    const baseNodes: Node[] = [
        { id: '1', type: 'demo', position: { x: 0, y: 0 }, data: { title: 'SOURCE_ALPHA', icon: ImageIcon, image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400', type: 'image' } },
        { id: '2', type: 'demo', position: { x: 0, y: 170 }, data: { title: 'ASSET_BETA', icon: Target, image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&q=80&w=400', type: 'image' } },
        { id: '3', type: 'demo', position: { x: 250, y: 85 }, data: { title: 'NEURAL_PROMPT', icon: Sparkles, type: 'prompt', image: 'MAXIMUM PRECISION. CINEMATIC TEXTURE. MINIMALIST BALANCE. OPTIMIZED ENGINE.' } },
        { id: '4', type: 'demo', position: { x: 550, y: 85 }, data: { title: 'PROCESS_FRAME', icon: Activity, image: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&q=80&w=400', type: 'image' } },
        { id: '5', type: 'demo', position: { x: 800, y: 85 }, data: { title: 'FINAL_OUTPUT', icon: Play, image: 'https://images.unsplash.com/photo-1492707892479-7bc8d5a4ee93?auto=format&fit=crop&q=80&w=400', type: 'image' } },
    ];

    const [nodes, setNodes, onNodesChange] = useNodesState(baseNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
    const containerRef = useRef<HTMLDivElement>(null);
    const { fitView } = useReactFlow();

    // 1. Native Browser Zoom Override (Ctrl + Scroll)
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) {
                // Stop React Flow from capturing the zoom event, let the browser handle it natively
                e.stopPropagation();
            }
        };

        // Capture phase ensures we intercept the event BEFORE React Flow's d3-zoom gets it
        container.addEventListener('wheel', handleWheel, { capture: true, passive: false });
        return () => container.removeEventListener('wheel', handleWheel, { capture: true });
    }, []);



    return (
        <div ref={containerRef} className="w-full h-full">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.1, maxZoom: 1, minZoom: 0.5 }}
                nodesDraggable={true}
                nodesConnectable={false}
                elementsSelectable={true}
                zoomOnScroll={false}
                zoomOnPinch={false}
                panOnDrag={false}
                preventScrolling={false}
                autoPanOnNodeDrag={false}
                proOptions={{ hideAttribution: true }}
                className="bg-transparent"
            />
        </div>
    );
}

function InteractiveWorkflowDemo() {
    return (
        <ReactFlowProvider>
            <InteractiveWorkflowDemoInner />
        </ReactFlowProvider>
    );
}

// =============================================================================
// MAIN HOME PAGE
// =============================================================================

export default function Home() {
    const { createNewSession, isLoading } = useSession();
    const { scrollYProgress } = useScroll();

    // Parallax and Dynamic Effects
    const backgroundY = useTransform(scrollYProgress, [0, 1], ['0%', '20%']);
    const gridOpacity = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0.07, 0.1, 0.1, 0.05]);
    const meshScale = useTransform(scrollYProgress, [0, 1], [1, 1.2]);

    return (
        <div className="relative w-full flex flex-col items-center overflow-x-hidden">
            {/* Advanced Dynamic Background System */}
            <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
                {/* Base Layer */}
                <div className="absolute inset-0 bg-white" />

                {/* Primary Mesh Glow with Parallax */}
                <motion.div
                    style={{ y: backgroundY, scale: meshScale }}
                    className="absolute inset-0 bg-[radial-gradient(at_50%_0%,rgba(56,189,248,0.15)_0%,transparent_50%)]"
                />
                <motion.div
                    style={{ y: useTransform(scrollYProgress, [0, 1], ['0%', '40%']) }}
                    className="absolute top-[20%] right-[-10%] w-[50vw] h-[50vw] bg-accent-secondary/5 blur-[120px] rounded-full"
                />

                {/* Precision Grid Layer (Responsive to Scroll) - Smaller Grid */}
                <motion.div
                    style={{
                        opacity: gridOpacity,
                        backgroundImage: `linear-gradient(#000 0.5px, transparent 0.5px), linear-gradient(90deg, #000 0.5px, transparent 0.5px)`,
                        backgroundSize: '24px 24px',
                        backgroundAttachment: 'local'
                    }}
                    className="absolute inset-0"
                />
                <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: `linear-gradient(#000 0.2px, transparent 0.2px), linear-gradient(90deg, #000 0.2px, transparent 0.2px)`, backgroundSize: '8px 8px' }} />

                {/* Dynamic Transition Overlay (Light to Dark) */}
                <div className="absolute inset-0 bg-gradient-to-b from-transparent from-[25%] to-slate-900 to-[25%] pointer-events-none z-10" />
            </div>

            <div className="relative z-10 w-full flex flex-col items-center overflow-x-hidden">
                {/* ─── Navigation ─────────────────────────────────────────── */}
                <nav className="w-full max-w-7xl px-8 py-6 flex justify-between items-center">
                    <PrisfolLogo />
                    <div className="hidden md:flex items-center gap-10">
                        <Link href="#workflow" className="text-[7px] font-black uppercase tracking-[0.4em] text-slate-400 hover:text-slate-900 transition-colors">Orchestrator</Link>
                        <Link href="#architecture" className="text-[7px] font-black uppercase tracking-[0.4em] text-slate-400 hover:text-slate-900 transition-colors">Architecture</Link>
                        <Link
                            href="/chat"
                            className="px-5 py-2 rounded-lg border border-slate-200 text-[7px] font-black uppercase tracking-[0.4em] text-slate-900 hover:bg-slate-900 hover:text-white transition-all shadow-sm"
                        >
                            Log In
                        </Link>
                    </div>
                </nav>

                {/* ─── Hero & Workflow Unified Section ─────────────────────────── */}
                <section className="relative w-full min-h-[800px] flex flex-col items-center pt-4 md:pt-8" id="workflow">
                    {/* Workflow Canvas as Interactive Background */}
                    <div className="absolute inset-0 z-0 overflow-hidden">
                        <InteractiveWorkflowDemo />
                    </div>

                    {/* Hero Text Overlay */}
                    <motion.div
                        initial={{ opacity: 0, y: 30, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                        className="relative z-10 space-y-10 text-center px-6 pointer-events-none max-w-7xl w-full"
                    >
                        <h1 className="text-[clamp(2.5rem,10vw,5.5rem)] font-black tracking-tighter text-slate-900 leading-[0.85] font-display uppercase px-4 drop-shadow-sm">
                            Orchestrate <span className="text-accent-primary italic">Intelligence</span> at Scale.
                        </h1>

                        <div className="flex flex-col sm:flex-row items-center justify-center gap-6 pointer-events-auto">
                            <Link
                                href="/chat"
                                className="w-full sm:w-auto group flex items-center justify-center gap-3 px-10 py-5 rounded-2xl bg-slate-900 text-white font-black text-base hover:scale-105 transition-all shadow-2xl"
                            >
                                START BUILDING
                                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                            </Link>
                            <button
                                onClick={createNewSession}
                                disabled={isLoading}
                                className="w-full sm:w-auto bg-white flex items-center justify-center gap-3 px-10 py-5 rounded-2xl border border-slate-200 text-slate-900 font-black text-base hover:bg-slate-50 transition-all shadow-lg"
                            >
                                {isLoading ? <div className="w-5 h-5 border-2 border-accent-secondary border-t-transparent animate-spin rounded-full" /> : <Workflow className="w-5 h-5 text-accent-secondary" />}
                                NEW SESSION
                            </button>
                        </div>
                    </motion.div>
                </section>

                {/* ─── Video Showcase (Transition to Dark) ────────────────── */}
                <motion.section
                    className="w-full max-w-5xl px-8 py-20"
                    initial={{ opacity: 0, y: 40 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.8 }}
                >
                    <div className="relative group rounded-3xl overflow-hidden shadow-[0_32px_64px_-16px_rgba(0,0,0,0.15)]">
                        <div className="relative overflow-hidden">
                            <video
                                className="w-full h-auto max-h-[75vh] object-cover rounded-3xl"
                                src="https://wyqkbwpybqokmtlghdsr.supabase.co/storage/v1/object/public/chat-assets/demo.mp4"
                                autoPlay loop muted playsInline
                            />
                        </div>
                    </div>
                </motion.section>

                {/* ─── Brand Carousel ───────────────────────────────────────── */}
                <motion.div
                    className="w-full py-16"
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 0.6 }}
                    viewport={{ once: true }}
                >
                    <BrandCarousel />
                </motion.div>

                {/* ─── Architecture (Dark Theme) ───────────────────────────── */}
                <section className="w-full max-w-7xl px-8 py-24" id="architecture">
                    <SectionHeader tag="Structure" title="Built for Performance." description="Technical specifications of the PrismAI runtime environment." dark />

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {[
                            { icon: 'core', name: "Inference Engine", desc: "Low-latency graph traversal optimized for complex neural branches." },
                            { icon: 'layers', name: "Recursive DAG", desc: "Advanced directed acyclic graph architecture for infinite scalability." },
                            { icon: 'secure', name: "Logic Mesh", desc: "End-to-end encrypted node communication for enterprise security." },
                            { icon: 'speed', name: "Nominal Speed", desc: "Optimized runtime ensuring sub-10ms logic propagation globally." },
                            { icon: 'mesh', name: "State Sync", desc: "Synchronized state management across distributed agentic clusters." },
                            { icon: 'bridge', name: "Neural Bridge", desc: "Low-level API for seamless integration of custom AI models." }
                        ].map((feat, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ duration: 0.5, delay: i * 0.1 }}
                                className="p-10 rounded-2xl border border-white/5 bg-white/5 backdrop-blur-xl hover:border-accent-primary/40 transition-all duration-500 group"
                            >
                                <BrandIcon type={feat.icon} className="w-8 h-8 text-white/30 group-hover:text-accent-primary transition-colors mb-8" />
                                <h3 className="text-xl font-black text-white mb-3 uppercase font-display tracking-tight">{feat.name}</h3>
                                <p className="text-[10px] text-white/40 font-bold leading-relaxed uppercase tracking-widest">{feat.desc}</p>
                            </motion.div>
                        ))}
                    </div>
                </section>

                {/* ─── Footer (Condensed) ─────────────────────────────────── */}
                <footer className="w-full max-w-7xl px-12 py-16 mt-8">
                    <div className="flex flex-col md:flex-row justify-between items-start gap-12 mb-12">
                        <PrisfolLogo dark />
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-16">
                            <div className="space-y-4">
                                <h4 className="text-[7px] font-black uppercase tracking-[0.4em] text-accent-primary opacity-60">Engine</h4>
                                <ul className="space-y-2 text-[7px] font-black text-white/40 uppercase tracking-[0.2em]">
                                    <li><a href="#" className="hover:text-white transition-colors">Nodes</a></li>
                                    <li><a href="#" className="hover:text-white transition-colors">Models</a></li>
                                </ul>
                            </div>
                            <div className="space-y-4">
                                <h4 className="text-[7px] font-black uppercase tracking-[0.4em] text-accent-primary opacity-60">Network</h4>
                                <ul className="space-y-2 text-[7px] font-black text-white/40 uppercase tracking-[0.2em]">
                                    <li><a href="#" className="hover:text-white transition-colors">GitHub</a></li>
                                    <li><a href="#" className="hover:text-white transition-colors">Discord</a></li>
                                </ul>
                            </div>
                        </div>
                    </div>
                    <div className="flex justify-between items-center pt-8 border-t border-white/5 text-[7px] font-black tracking-[0.6em] text-white/10 uppercase">
                        <div>© 2026 PRISFOL</div>
                        <div className="flex gap-6"><span>NOMINAL</span><span>EDGE_GLOBAL</span></div>
                    </div>
                </footer>
            </div>
        </div>
    );
}

