'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { motion, useScroll, useTransform } from 'framer-motion';
import ReactFlow, {
    applyNodeChanges,
    CoordinateExtent,
    Node,
    NodeChange,
    Edge,
    Handle,
    Position,
    ReactFlowProvider,
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
    <div
        className="flex flex-col gap-2 group"
        style={{
            transform: 'scale(var(--home-demo-node-zoom-comp, 1))',
            transformOrigin: 'top left'
        }}
    >
        <Handle type="target" position={Position.Left} className="w-0 h-0 border-none bg-transparent" />
        <div className="flex items-center gap-1.5 px-1">
            <data.icon className="w-2.5 h-2.5 text-accent-primary" />
            <span className="text-[7px] font-black uppercase tracking-[0.2em] text-slate-400 group-hover:text-accent-primary transition-colors">{data.title}</span>
        </div>
        <div className={cn(
            "relative rounded-xl overflow-hidden border border-slate-200 bg-white shadow-xl transition-all duration-700 group-hover:shadow-2xl group-hover:border-accent-primary/40",
            data.type === 'image' ? "w-36 h-36" : "w-52 p-4"
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
        { id: '1', type: 'demo', position: { x: 120, y: 120 }, data: { title: 'SOURCE_ALPHA', icon: ImageIcon, image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400', type: 'image' } },
        { id: '2', type: 'demo', position: { x: 120, y: 350 }, data: { title: 'ASSET_BETA', icon: Target, image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&q=80&w=400', type: 'image' } },
        { id: '3', type: 'demo', position: { x: 380, y: 250 }, data: { title: 'NEURAL_PROMPT', icon: Sparkles, type: 'prompt', image: 'MAXIMUM PRECISION. CINEMATIC TEXTURE. MINIMALIST BALANCE. OPTIMIZED ENGINE.' } },
        { id: '4', type: 'demo', position: { x: 700, y: 250 }, data: { title: 'PROCESS_FRAME', icon: Activity, image: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&q=80&w=400', type: 'image' } },
        { id: '5', type: 'demo', position: { x: 960, y: 250 }, data: { title: 'FINAL_OUTPUT', icon: Play, image: 'https://images.unsplash.com/photo-1492707892479-7bc8d5a4ee93?auto=format&fit=crop&q=80&w=400', type: 'image' } },
    ];

    const [nodes, setNodes] = React.useState<Node[]>(baseNodes);
    const [edges, , onEdgesChange] = useEdgesState(initialEdges);
    const containerRef = useRef<HTMLDivElement>(null);
    const layoutInitializedRef = useRef(false);
    const nodeRatiosRef = useRef<Record<string, { xRatio: number; yBottomRatio: number }>>({});
    const initialDevicePixelRatioRef = useRef<number | null>(null);
    const [nodeExtent, setNodeExtent] = React.useState<CoordinateExtent>([[-600, -400], [1800, 1200]]);
    const [nodeZoomCompensation, setNodeZoomCompensation] = React.useState(1);
    const { screenToFlowPosition } = useReactFlow();

    const getEffectiveNodeSize = React.useCallback((node: Node) => {
        const fallbackWidth = node.data?.type === 'prompt' ? 220 : 150;
        const fallbackHeight = node.data?.type === 'prompt' ? 120 : 180;

        return {
            width: (node.width ?? fallbackWidth) * nodeZoomCompensation,
            height: (node.height ?? fallbackHeight) * nodeZoomCompensation
        };
    }, [nodeZoomCompensation]);

    const createNodeRatios = React.useCallback((nodesToMap: Node[], extent: CoordinateExtent) => {
        const [[minX, minY], [maxX, maxY]] = extent;
        const flowWidth = maxX - minX;
        const flowHeight = maxY - minY;
        if (flowWidth <= 0 || flowHeight <= 0) return {};

        return nodesToMap.reduce<Record<string, { xRatio: number; yBottomRatio: number }>>((acc, node) => {
            const { width, height } = getEffectiveNodeSize(node);
            const xRange = Math.max(1, flowWidth - width);
            const yRange = Math.max(1, flowHeight - height);
            const xRatio = Math.min(1, Math.max(0, (node.position.x - minX) / xRange));
            const yBottomRatio = Math.min(1, Math.max(0, (maxY - height - node.position.y) / yRange));

            acc[node.id] = { xRatio, yBottomRatio };
            return acc;
        }, {});
    }, [getEffectiveNodeSize]);

    const applyInitialGridLayout = React.useCallback((extent: CoordinateExtent) => {
        const [[minX, minY], [maxX, maxY]] = extent;
        const flowWidth = maxX - minX;
        const flowHeight = maxY - minY;
        if (flowWidth <= 0 || flowHeight <= 0) return;

        const horizontalPadding = 24;
        const topPadding = 24;
        const bottomPadding = 24;
        const baseImageWidth = 150;
        const baseImageHeight = 180;
        const basePromptWidth = 220;
        const basePromptHeight = 120;
        const imageWidth = baseImageWidth * nodeZoomCompensation;
        const imageHeight = baseImageHeight * nodeZoomCompensation;
        const promptWidth = basePromptWidth * nodeZoomCompensation;
        const promptHeight = basePromptHeight * nodeZoomCompensation;
        const leftEdge = minX + horizontalPadding;
        const rightEdge = maxX - horizontalPadding;
        const availableWidth = Math.max(0, rightEdge - leftEdge);
        const totalNodeWidth = (imageWidth * 3) + promptWidth;
        const gap = Math.max(0, (availableWidth - totalNodeWidth) / 3);

        const leftImageX = leftEdge;
        const promptX = leftImageX + imageWidth + gap;
        const processX = promptX + promptWidth + gap;
        const rightImageX = processX + imageWidth + gap;
        const imageBottomY = maxY - bottomPadding - imageHeight;
        const rowGap = Math.max(20, Math.min(64, flowHeight * 0.09));
        const topLeftY = Math.max(minY + topPadding, imageBottomY - imageHeight - rowGap);
        const promptY = imageBottomY + (imageHeight - promptHeight) / 2;

        setNodes((currentNodes) => {
            let hasChanges = false;

            const laidOutNodes = currentNodes.map((node) => {
                const nextPosition = (() => {
                    if (node.id === '1') return { x: leftImageX, y: topLeftY };
                    if (node.id === '2') return { x: leftImageX, y: imageBottomY };
                    if (node.id === '3') return { x: promptX, y: promptY };
                    if (node.id === '4') return { x: processX, y: imageBottomY };
                    if (node.id === '5') return { x: rightImageX, y: imageBottomY };
                    return node.position;
                })();

                if (nextPosition.x === node.position.x && nextPosition.y === node.position.y) {
                    return node;
                }

                hasChanges = true;
                return { ...node, position: nextPosition };
            });

            const resultNodes = hasChanges ? laidOutNodes : currentNodes;
            nodeRatiosRef.current = createNodeRatios(resultNodes, extent);
            layoutInitializedRef.current = true;
            return resultNodes;
        });
    }, [createNodeRatios, nodeZoomCompensation]);

    const applyRatioLayout = React.useCallback((extent: CoordinateExtent) => {
        const ratios = nodeRatiosRef.current;
        if (!Object.keys(ratios).length) return;

        const [[minX, minY], [maxX, maxY]] = extent;
        const flowWidth = maxX - minX;
        const flowHeight = maxY - minY;
        if (flowWidth <= 0 || flowHeight <= 0) return;

        setNodes((currentNodes) => {
            let hasChanges = false;

            const ratioNodes = currentNodes.map((node) => {
                const ratio = ratios[node.id];
                if (!ratio) return node;

                const { width, height } = getEffectiveNodeSize(node);
                const xRange = Math.max(0, flowWidth - width);
                const yRange = Math.max(0, flowHeight - height);
                const nextPosition = {
                    x: minX + ratio.xRatio * xRange,
                    y: maxY - height - ratio.yBottomRatio * yRange
                };

                if (
                    Math.abs(nextPosition.x - node.position.x) < 0.001 &&
                    Math.abs(nextPosition.y - node.position.y) < 0.001
                ) {
                    return node;
                }

                hasChanges = true;
                return { ...node, position: nextPosition };
            });

            return hasChanges ? ratioNodes : currentNodes;
        });
    }, [getEffectiveNodeSize]);

    const clampNodePosition = React.useCallback((node: Node, position: { x: number; y: number }) => {
        const [[minX, minY], [maxX, maxY]] = nodeExtent;
        const { width, height } = getEffectiveNodeSize(node);

        return {
            x: Math.min(Math.max(position.x, minX), Math.max(minX, maxX - width)),
            y: Math.min(Math.max(position.y, minY), Math.max(minY, maxY - height))
        };
    }, [getEffectiveNodeSize, nodeExtent]);

    const onNodesChange = React.useCallback((changes: NodeChange[]) => {
        setNodes((currentNodes) => {
            const nodesById = new Map(currentNodes.map((node) => [node.id, node]));
            const boundedChanges = changes.map((change) => {
                if (change.type !== 'position' || !change.position) return change;
                const targetNode = nodesById.get(change.id);
                if (!targetNode) return change;

                return {
                    ...change,
                    position: clampNodePosition(targetNode, change.position)
                };
            });

            const nextNodes = applyNodeChanges(boundedChanges, currentNodes);
            if (changes.some((change) => change.type === 'position' && change.position)) {
                nodeRatiosRef.current = createNodeRatios(nextNodes, nodeExtent);
                layoutInitializedRef.current = true;
            }

            return nextNodes;
        });
    }, [clampNodePosition, createNodeRatios, nodeExtent]);

    const updateExtent = React.useCallback(() => {
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const padding = 16;
        const topLeft = screenToFlowPosition({ x: rect.left + padding, y: rect.top + padding });
        const bottomRight = screenToFlowPosition({ x: rect.right - padding, y: rect.bottom - padding });
        const normalizedExtent: CoordinateExtent = [
            [Math.min(topLeft.x, bottomRight.x), Math.min(topLeft.y, bottomRight.y)],
            [Math.max(topLeft.x, bottomRight.x), Math.max(topLeft.y, bottomRight.y)]
        ];

        setNodeExtent(normalizedExtent);
        if (!layoutInitializedRef.current) {
            applyInitialGridLayout(normalizedExtent);
        } else {
            applyRatioLayout(normalizedExtent);
        }
    }, [applyInitialGridLayout, applyRatioLayout, screenToFlowPosition]);

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

    // 2. Keep drag bounds in sync with the visible workflow area
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const resizeAndBound = () => {
            window.requestAnimationFrame(updateExtent);
        };

        const resizeObserver = new ResizeObserver(resizeAndBound);

        resizeObserver.observe(container);
        resizeAndBound();

        return () => resizeObserver.disconnect();
    }, [updateExtent]);

    // 3. Counter browser page zoom so nodes keep a stable on-screen size.
    useEffect(() => {
        const updateNodeZoomCompensation = () => {
            const currentDevicePixelRatio = window.devicePixelRatio || 1;
            if (initialDevicePixelRatioRef.current === null) {
                initialDevicePixelRatioRef.current = currentDevicePixelRatio;
            }

            const baseDevicePixelRatio = initialDevicePixelRatioRef.current || 1;
            const pageZoomFactor = currentDevicePixelRatio / baseDevicePixelRatio;
            const nextCompensation = Number.isFinite(pageZoomFactor) && pageZoomFactor > 0
                ? 1 / pageZoomFactor
                : 1;

            setNodeZoomCompensation((currentCompensation) => (
                Math.abs(currentCompensation - nextCompensation) < 0.001
                    ? currentCompensation
                    : nextCompensation
            ));
        };

        let dppxMediaQuery: MediaQueryList | null = null;
        const handleDppxChange = () => {
            updateNodeZoomCompensation();
            if (dppxMediaQuery) {
                dppxMediaQuery.removeEventListener('change', handleDppxChange);
            }
            dppxMediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
            dppxMediaQuery.addEventListener('change', handleDppxChange);
        };

        updateNodeZoomCompensation();
        dppxMediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        dppxMediaQuery.addEventListener('change', handleDppxChange);
        window.addEventListener('resize', updateNodeZoomCompensation);
        window.visualViewport?.addEventListener('resize', updateNodeZoomCompensation);

        return () => {
            dppxMediaQuery?.removeEventListener('change', handleDppxChange);
            window.removeEventListener('resize', updateNodeZoomCompensation);
            window.visualViewport?.removeEventListener('resize', updateNodeZoomCompensation);
        };
    }, []);

    useEffect(() => {
        if (!layoutInitializedRef.current) return;
        applyRatioLayout(nodeExtent);
    }, [applyRatioLayout, nodeExtent, nodeZoomCompensation]);

    return (
        <div
            ref={containerRef}
            className="w-full h-full"
            style={{ ['--home-demo-node-zoom-comp' as any]: nodeZoomCompensation }}
        >
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                nodeExtent={nodeExtent}
                nodesDraggable={true}
                nodesConnectable={false}
                elementsSelectable={true}
                minZoom={1}
                maxZoom={1}
                zoomOnScroll={false}
                zoomOnPinch={false}
                zoomOnDoubleClick={false}
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
    const [mounted, setMounted] = React.useState(false);
    const [zoomCompensation, setZoomCompensation] = React.useState(1);
    const initialDevicePixelRatioRef = React.useRef<number | null>(null);

    useEffect(() => {
        setMounted(true);

        const updateZoom = () => {
            const currentDPR = window.devicePixelRatio || 1;
            if (initialDevicePixelRatioRef.current === null) {
                initialDevicePixelRatioRef.current = currentDPR;
            }
            const baseDPR = initialDevicePixelRatioRef.current || 1;
            const factor = currentDPR / baseDPR;
            setZoomCompensation(factor > 0 ? 1 / factor : 1);
        };

        let mql: MediaQueryList | null = null;
        const handleMql = () => {
            updateZoom();
            if (mql) mql.removeEventListener('change', handleMql);
            mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
            mql.addEventListener('change', handleMql);
        };

        updateZoom();
        mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        mql.addEventListener('change', handleMql);
        window.addEventListener('resize', updateZoom);

        return () => {
            mql?.removeEventListener('change', handleMql);
            window.removeEventListener('resize', updateZoom);
        };
    }, []);

    // Parallax and Dynamic Effects
    const backgroundY = useTransform(scrollYProgress, [0, 1], ['0%', '20%']);
    const gridOpacity = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0.07, 0.1, 0.1, 0.05]);
    const meshScale = useTransform(scrollYProgress, [0, 1], [1, 1.2]);

    return (
        <div className="relative w-full flex flex-col items-center overflow-x-hidden" suppressHydrationWarning>
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
                        backgroundImage: `linear-gradient(#000 ${0.5 * zoomCompensation}px, transparent ${0.5 * zoomCompensation}px), linear-gradient(90deg, #000 ${0.5 * zoomCompensation}px, transparent ${0.5 * zoomCompensation}px)`,
                        backgroundSize: `${24 * zoomCompensation}px ${24 * zoomCompensation}px`,
                        backgroundAttachment: 'local'
                    }}
                    className="absolute inset-0"
                />
                <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: `linear-gradient(#000 ${0.2 * zoomCompensation}px, transparent ${0.2 * zoomCompensation}px), linear-gradient(90deg, #000 ${0.2 * zoomCompensation}px, transparent ${0.2 * zoomCompensation}px)`, backgroundSize: `${8 * zoomCompensation}px ${8 * zoomCompensation}px` }} />

            </div>

            <div className="relative z-10 w-full flex flex-col items-center overflow-x-hidden">
                {/* ─── Hero & Workflow Unified Section ─────────────────────────── */}
                <section className="relative w-full min-h-[calc(100vh+16rem)] flex flex-col items-center pb-16" id="workflow">
                    {/* Workflow Canvas as Interactive Background */}
                    <div className="absolute inset-x-0 top-0 bottom-10 z-0 overflow-hidden">
                        {mounted && <InteractiveWorkflowDemo />}
                    </div>

                    {/* ─── Navigation ─────────────────────────────────────────── */}
                    <nav className="relative z-20 w-full max-w-7xl px-8 py-6 flex justify-between items-center">
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

                    {/* Hero Text Overlay */}
                    <motion.div
                        initial={{ opacity: 0, y: 30, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                        className="relative z-20 space-y-10 text-center px-6 md:pt-10 pointer-events-none max-w-7xl w-full"
                    >
                        <h1 className="text-[clamp(2.5rem,10vw,5.5rem)] font-black tracking-tighter text-slate-900 leading-[0.85] font-display uppercase px-4 drop-shadow-sm">
                            The Visual Engine for Your <span className="text-accent-primary italic">Imagination</span>.
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

                {/* ─── Dark Sections Wrapper ───────────────────────────────── */}
                <div className="w-full bg-slate-900 flex flex-col items-center">
                    <motion.section
                        className="w-full max-w-5xl px-8 pt-24 pb-12"
                        initial={{ opacity: 0, y: 40 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.8 }}
                    >
                        <div className="relative w-full rounded-3xl overflow-hidden shadow-[0_32px_64px_-16px_rgba(0,0,0,0.15)]" style={{ display: 'flex', backgroundColor: 'transparent' }}>
                            <video
                                src="https://wyqkbwpybqokmtlghdsr.supabase.co/storage/v1/object/public/chat-assets/demo.mp4"
                                style={{ width: '100%', height: 'auto', display: 'block', backgroundColor: 'transparent', objectFit: 'fill' }}
                                autoPlay loop muted playsInline
                            />
                        </div>
                    </motion.section>

                    {/* ─── Brand Carousel ───────────────────────────────────────── */}
                    {mounted && (
                        <motion.div
                            className="w-full py-8"
                            initial={{ opacity: 0 }}
                            whileInView={{ opacity: 1 }}
                            viewport={{ once: true }}
                        >
                            <BrandCarousel />
                        </motion.div>
                    )}

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
        </div>
    );
}

