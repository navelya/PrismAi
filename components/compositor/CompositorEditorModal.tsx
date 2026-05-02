'use client';

import React, { useCallback, useEffect, useRef, useState, useMemo, useTransition } from 'react';
import { Stage, Layer, Rect, Image as KonvaImage, Transformer, Path, Line, Text as KonvaText } from 'react-konva';
import useImage from 'use-image';
import {
    X, Eye, EyeOff, Lock, Unlock, Trash2, Layers2, ChevronUp, ChevronDown,
    RotateCcw, FlipHorizontal, FlipVertical, ChevronLeft, ChevronRight, Plus, Crop,
    Monitor, Smartphone, Square, ZoomIn, ZoomOut, Maximize2,
    Instagram, Youtube, Facebook, Linkedin, Video, Play, MessageSquare, Twitter,
    Image as ImageIcon
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { cn, generateNodeId } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import { NumberInput } from '@/components/ui/NumberInput';
import { CompositorConfig, CompositorLayer, LayerTransform, ImageObject, calculateInitialTransform } from '@/lib/nodes/types';
import { toLegacyRenderableOutput } from '@/lib/workflow/result-format';

const IMAGES_PER_PAGE = 6;
const VIEWPORT_PADDING = 1000;

const CANVAS_PRESETS = [
    { label: 'IG Story', width: 1080, height: 1920, icon: Instagram, color: '#E4405F', category: 'Instagram' },
    { label: 'IG Post', width: 1080, height: 1080, icon: Instagram, color: '#E4405F', category: 'Instagram' },
    { label: 'IG Portrait', width: 1080, height: 1350, icon: Instagram, color: '#E4405F', category: 'Instagram' },
    { label: 'TikTok', width: 1080, height: 1920, icon: Video, color: '#00F2EA', category: 'TikTok' },
    { label: 'YouTube', width: 1920, height: 1080, icon: Youtube, color: '#FF0000', category: 'YouTube' },
    { label: 'YT Shorts', width: 1080, height: 1920, icon: Play, color: '#FF0000', category: 'YouTube' },
    { label: 'FB Post', width: 1200, height: 630, icon: Facebook, color: '#1877F2', category: 'Facebook' },
    { label: 'LinkedIn', width: 1200, height: 627, icon: Linkedin, color: '#0A66C2', category: 'LinkedIn' },
    { label: 'X Post', width: 1200, height: 675, icon: Twitter, color: '#1DA1F2', category: 'X' },
    { label: 'Full HD', width: 1920, height: 1080, icon: Monitor, color: '#6366f1', category: 'General' },
];

// 1. MEMOIZED CANVAS IMAGE
const URLImage = React.memo(({
    layer,
    imageUrl,
    onSelect,
    onChange,
    onDragMove,
    onLoad
}: {
    layer: CompositorLayer,
    imageUrl: string,
    onSelect: () => void,
    onChange: (updates: Partial<LayerTransform>) => void,
    onDragMove: (e: any) => void,
    onLoad?: (img: HTMLImageElement) => void
}) => {
    const [img] = useImage(imageUrl, 'anonymous');
    const shapeRef = useRef<any>(null);

    useEffect(() => {
        if (img && onLoad) {
            onLoad(img);
        }
    }, [img, onLoad]);

    if (!img) return null;

    return (
        <KonvaImage
            image={img}
            ref={shapeRef}
            name={`img-${layer.id}`}
            x={layer.transform.x}
            y={layer.transform.y}
            width={layer.transform.width}
            height={layer.transform.height}
            rotation={layer.transform.rotation}
            opacity={layer.transform.opacity}
            scaleX={layer.transform.flipX ? -1 : 1}
            scaleY={layer.transform.flipY ? -1 : 1}
            offsetX={layer.transform.flipX ? layer.transform.width : 0}
            offsetY={layer.transform.flipY ? layer.transform.height : 0}
            draggable={!layer.locked}
            onClick={onSelect}
            onTap={onSelect}
            onDragStart={onSelect}
            onDragMove={onDragMove}
            onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
            onTransformEnd={(e) => {
                const node = shapeRef.current;
                const scaleX = node.scaleX();
                const scaleY = node.scaleY();

                node.scaleX(layer.transform.flipX ? -1 : 1);
                node.scaleY(layer.transform.flipY ? -1 : 1);

                onChange({
                    x: node.x(),
                    y: node.y(),
                    rotation: node.rotation(),
                    width: Math.max(5, node.width() * Math.abs(scaleX)),
                    height: Math.max(5, node.height() * Math.abs(scaleY)),
                });
            }}
        />
    );
}, (prevProps, nextProps) => {
    return (
        prevProps.imageUrl === nextProps.imageUrl &&
        prevProps.layer.locked === nextProps.layer.locked &&
        prevProps.layer.transform === nextProps.layer.transform
    );
});

// 2. MEMOIZED CANVAS TEXT
const URLText = React.memo(({
    layer,
    text,
    onSelect,
    onChange,
    onDragMove
}: {
    layer: CompositorLayer,
    text: string,
    onSelect: () => void,
    onChange: (updates: Partial<LayerTransform>) => void,
    onDragMove: (e: any) => void
}) => {
    const shapeRef = useRef<any>(null);

    return (
        <KonvaText
            text={text}
            ref={shapeRef}
            name={`img-${layer.id}`}
            x={layer.transform.x}
            y={layer.transform.y}
            width={layer.transform.width}
            height={layer.transform.height}
            rotation={layer.transform.rotation}
            opacity={layer.transform.opacity}
            scaleX={layer.transform.flipX ? -1 : 1}
            scaleY={layer.transform.flipY ? -1 : 1}
            offsetX={layer.transform.flipX ? layer.transform.width : 0}
            offsetY={layer.transform.flipY ? layer.transform.height : 0}
            draggable={!layer.locked}
            fontSize={48}
            fill="#ffffff"
            fontStyle="bold"
            align="center"
            verticalAlign="middle"
            onClick={onSelect}
            onTap={onSelect}
            onDragStart={onSelect}
            onDragMove={onDragMove}
            onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
            onTransformEnd={(e) => {
                const node = shapeRef.current;
                const scaleX = node.scaleX();
                const scaleY = node.scaleY();

                node.scaleX(layer.transform.flipX ? -1 : 1);
                node.scaleY(layer.transform.flipY ? -1 : 1);

                onChange({
                    x: node.x(),
                    y: node.y(),
                    rotation: node.rotation(),
                    width: Math.max(5, node.width() * Math.abs(scaleX)),
                    height: Math.max(5, node.height() * Math.abs(scaleY)),
                });
            }}
        />
    );
}, (prevProps, nextProps) => {
    return (
        prevProps.text === nextProps.text &&
        prevProps.layer.locked === nextProps.layer.locked &&
        prevProps.layer.transform === nextProps.layer.transform
    );
});

// 3. MEMOIZED SIDEBAR ITEM
const LayerListItem = React.memo(({
    layer,
    isSelected,
    type,
    onSelect,
    onToggleVisibility,
    onToggleLock
}: any) => {
    let Icon = ImageIcon;
    if (type === 'prompt') Icon = MessageSquare;
    if (type === 'ai_generate_image') Icon = ImageIcon;
    if (type === 'media_input') Icon = Smartphone;
    if (type === 'remove_background') Icon = ImageIcon;

    return (
        <Reorder.Item
            value={layer}
            onClick={() => onSelect(layer.id)}
            className={cn(
                "p-1.5 rounded-lg border cursor-grab active:cursor-grabbing select-none transition-colors duration-200",
                isSelected ? "bg-accent-primary/20 border-accent-primary/40 shadow-lg shadow-accent-primary/5" : "bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/20"
            )}
        >
            <div className="flex items-center gap-2">
                <div className={cn("w-5 h-5 rounded-md flex items-center justify-center border", isSelected ? "bg-accent-primary text-white border-white/20" : "bg-white/10 text-white/40 border-white/10")}>
                    <Icon className="w-2.5 h-2.5" />
                </div>
                <span className={cn("flex-1 text-[10px] font-bold truncate", isSelected ? "text-white" : "text-white/60")}>{layer.name}</span>
                <div className="flex items-center gap-1 opacity-40 group-hover:opacity-100">
                    <button onClick={(e) => { e.stopPropagation(); onToggleVisibility(layer.id); }} className="p-0.5 hover:text-white transition-colors cursor-pointer">
                        {layer.visible ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onToggleLock(layer.id); }} className="p-0.5 hover:text-white transition-colors cursor-pointer">
                        {layer.locked ? <Lock className="w-2.5 h-2.5 text-amber-500" /> : <Unlock className="w-2.5 h-2.5" />}
                    </button>
                </div>
            </div>
        </Reorder.Item>
    );
});

interface CompositorEditorModalProps {
    nodeId: string;
    config: CompositorConfig;
    onClose: () => void;
    onConfigChange: (config: Partial<CompositorConfig>) => void;
}

export default function CompositorEditorModal({
    nodeId,
    config,
    onClose,
    onConfigChange,
}: CompositorEditorModalProps) {
    const currentWorkflow = useAppStore((state) => state.currentWorkflow);
    const nodeOutputs = useAppStore((state) => state.nodeOutputs);

    const connectedInputs = useMemo(() => {
        if (!currentWorkflow) return {};
        const edges = currentWorkflow.edges.filter(e => e.target === nodeId);
        const inputs: Record<string, { images: ImageObject[], type: string, sourceNodeLabel: string }> = {};

        edges.forEach(edge => {
            const handleId = (edge as any).targetHandle || 'layers';
            const inputKey = handleId === 'layers' ? edge.id : handleId;
            
            const sourceNode = currentWorkflow.nodes.find(n => n.id === edge.source);
            const sourceOutput = nodeOutputs[edge.source];
            if (sourceOutput) {
                const normalized = toLegacyRenderableOutput(sourceOutput);
                if (normalized === undefined || normalized === null) return;
                inputs[inputKey] = {
                    images: Array.isArray(normalized) ? normalized : [normalized],
                    type: sourceNode?.type || 'unknown',
                    sourceNodeLabel: sourceNode?.data?.label || 'Source'
                };
            }
        });
        return inputs;
    }, [currentWorkflow, nodeId, nodeOutputs]);

    const localCanvasWidth = config.canvasWidth || 1920;
    const localCanvasHeight = config.canvasHeight || 1080;

    // Initialize localLayers by merging config.layers with connected edges
    const [localLayers, setLocalLayers] = useState<CompositorLayer[]>(() => {
        const savedLayers = config.layers || [];
        const edges = currentWorkflow?.edges.filter(e => e.target === nodeId && (e.targetHandle === 'layers' || !e.targetHandle)) || [];
        
        return edges.map(edge => {
            const savedLayer = savedLayers.find(l => l.sourceHandleId === edge.id);
            if (savedLayer) return { ...savedLayer, visible: true };

            const sourceNode = currentWorkflow?.nodes.find(n => n.id === edge.source);
            
            // Shared centering logic for new layers - start as NOT auto-centered to allow handleImageLoad to run once
            return {
                id: `layer_${edge.id}`,
                name: sourceNode?.data?.label || `Layer`,
                sourceHandleId: edge.id,
                selectedIndex: 0,
                transform: {
                    x: (localCanvasWidth - 400) / 2,
                    y: (localCanvasHeight - 300) / 2,
                    width: 400,
                    height: 300,
                    rotation: 0,
                    opacity: 1,
                    flipX: false,
                    flipY: false,
                    isAutoCentered: false,
                    crop: null,
                },
                visible: true,
                locked: false,
            };
        });
    });

    const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
    const [canvasWidth, setCanvasWidth] = useState(localCanvasWidth);
    const [canvasHeight, setCanvasHeight] = useState(localCanvasHeight);
    const [imagePageIndex, setImagePageIndex] = useState(0);

    const [guidelines, setGuidelines] = useState<{ type: 'vertical' | 'horizontal', position: number }[]>([]);
    const [isPending, startTransition] = useTransition();

    const stageRef = useRef<any>(null);
    const transformerRef = useRef<any>(null);
    const stageContainerRef = useRef<HTMLDivElement>(null);

    const [stageZoom, setStageZoom] = useState(1);
    const [stagePan, setStagePan] = useState({ x: VIEWPORT_PADDING, y: VIEWPORT_PADDING });
    const [isPanning, setIsPanning] = useState(false);
    const [spaceHeld, setSpaceHeld] = useState(false);

    // Attach Transformer
    useEffect(() => {
        if (selectedLayerId && transformerRef.current && stageRef.current) {
            const selectedNode = stageRef.current.findOne(`.img-${selectedLayerId}`);
            if (selectedNode) {
                transformerRef.current.nodes([selectedNode]);
                transformerRef.current.getLayer().batchDraw();
            }
        } else if (transformerRef.current) {
            transformerRef.current.nodes([]);
            transformerRef.current.getLayer().batchDraw();
        }
    }, [selectedLayerId, localLayers]);

    const handleDone = useCallback(() => {
        // Validation: ensure we have a valid state before saving
        if (!localLayers) return;

        onConfigChange({
            layers: [...localLayers],
            canvasWidth: canvasWidth,
            canvasHeight: canvasHeight,
        });
        onClose();
    }, [localLayers, canvasWidth, canvasHeight, onConfigChange, onClose]);

    const changeCanvasSize = useCallback((width: number, height: number) => {
        setCanvasWidth(width);
        setCanvasHeight(height);
    }, []);

    const fitToView = useCallback(() => {
        const container = stageContainerRef.current;
        if (!container) return;
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const padding = 100;

        const zoomX = (cw - padding * 2) / canvasWidth;
        const zoomY = (ch - padding * 2) / canvasHeight;
        const zoom = Math.min(zoomX, zoomY, 2);

        const panX = (cw - canvasWidth * zoom) / 2;
        const panY = (ch - canvasHeight * zoom) / 2;

        setStageZoom(zoom);
        setStagePan({ x: panX, y: panY });
    }, [canvasWidth, canvasHeight]);

    useEffect(() => { fitToView(); }, [fitToView]);

    const handleStageWheel = useCallback((e: any) => {
        e.evt.preventDefault();
        const stage = e.target.getStage();
        const oldScale = stage.scaleX();
        const pointer = stage.getPointerPosition();

        const mousePointTo = {
            x: (pointer.x - stage.x()) / oldScale,
            y: (pointer.y - stage.y()) / oldScale,
        };

        const zoomFactor = e.evt.deltaY < 0 ? 1.1 : 0.9;
        const newScale = Math.min(Math.max(oldScale * zoomFactor, 0.1), 5);

        setStageZoom(newScale);
        setStagePan({
            x: pointer.x - mousePointTo.x * newScale,
            y: pointer.y - mousePointTo.y * newScale,
        });
    }, []);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.code === 'Space' && !e.repeat && e.target === document.body) {
                e.preventDefault();
                setSpaceHeld(true);
            }
        };
        const onKeyUp = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                setSpaceHeld(false);
                setIsPanning(false);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, []);

    const checkDeselect = (e: any) => {
        const clickedOnEmpty = e.target === e.target.getStage() || e.target.name() === 'background';
        if (clickedOnEmpty) {
            setSelectedLayerId(null);
        }
    };

    const toggleVisibility = useCallback((layerId: string) => {
        setLocalLayers(prev => prev.map(l => l.id === layerId ? { ...l, visible: !l.visible } : l));
    }, []);

    const toggleLock = useCallback((layerId: string) => {
        setLocalLayers(prev => prev.map(l => l.id === layerId ? { ...l, locked: !l.locked } : l));
        if (selectedLayerId === layerId) setSelectedLayerId(null);
    }, [selectedLayerId]);

    const reorderLayers = useCallback((newOrder: CompositorLayer[]) => {
        startTransition(() => {
            setLocalLayers(newOrder);
        });
    }, []);

    const updateTransform = useCallback((layerId: string, updates: Partial<LayerTransform>) => {
        setLocalLayers(prev => prev.map(l =>
            l.id === layerId ? { ...l, transform: { ...l.transform, ...updates } } : l
        ));
    }, []);

    const toggleFlip = useCallback((layerId: string, axis: 'flipX' | 'flipY') => {
        setLocalLayers(prev => prev.map(l =>
            l.id === layerId ? { ...l, transform: { ...l.transform, [axis]: !l.transform[axis] } } : l
        ));
    }, []);

    const resetTransform = useCallback((layerId: string) => {
        // Reset to centered transform
        const sourceData = connectedInputs[localLayers.find(l => l.id === layerId)?.sourceHandleId || ''];
        const res = sourceData?.images?.[0]?.resolution;
        const newT = calculateInitialTransform(res?.width || 400, res?.height || 300, canvasWidth, canvasHeight);
        updateTransform(layerId, newT);
    }, [updateTransform, connectedInputs, localLayers, canvasWidth, canvasHeight]);

    const updateSelectedIndex = useCallback((layerId: string, newIdx: number) => {
        setLocalLayers(prev => prev.map(l => l.id === layerId ? { ...l, selectedIndex: newIdx } : l));
    }, []);

    const selectOnCanvas = useCallback((layerId: string) => {
        setSelectedLayerId(layerId);
        setImagePageIndex(0);
    }, []);

    // 🚀 Smart Auto-Centering using shared utility
    const handleImageLoad = useCallback((layerId: string, img: HTMLImageElement) => {
        setLocalLayers(prev => prev.map(l => {
            // Only auto-center if the layer is using the absolute default size (haven't been adjusted)
            // or if it was just initialized with 400x300
            if (l.id === layerId && l.transform.width === 400 && l.transform.height === 300) {
                const newT = calculateInitialTransform(img.width, img.height, canvasWidth, canvasHeight);
                return { ...l, transform: newT };
            }
            return l;
        }));
    }, [canvasWidth, canvasHeight]);

    const handleDragMove = useCallback((e: any) => {
        const layer = e.target.getLayer();
        const node = e.target;
        const snapThreshold = 5 / stageZoom;

        const verticalStops = [0, canvasWidth / 2, canvasWidth];
        const horizontalStops = [0, canvasHeight / 2, canvasHeight];

        layer.find('Image').forEach((item: any) => {
            if (item === node) return;
            const box = item.getClientRect({ relativeTo: layer });
            verticalStops.push(box.x, box.x + box.width / 2, box.x + box.width);
            horizontalStops.push(box.y, box.y + box.height / 2, box.y + box.height);
        });

        const box = node.getClientRect({ relativeTo: layer });
        const offsetX = node.x() - box.x;
        const offsetY = node.y() - box.y;

        const nodeV = [
            { guide: box.x, offset: offsetX },
            { guide: box.x + box.width / 2, offset: offsetX - box.width / 2 },
            { guide: box.x + box.width, offset: offsetX - box.width },
        ];

        const nodeH = [
            { guide: box.y, offset: offsetY },
            { guide: box.y + box.height / 2, offset: offsetY - box.height / 2 },
            { guide: box.y + box.height, offset: offsetY - box.height },
        ];

        let closestV: any = null;
        let minDiffV = snapThreshold;
        verticalStops.forEach(stop => {
            nodeV.forEach(nv => {
                const diff = Math.abs(stop - nv.guide);
                if (diff < minDiffV) {
                    minDiffV = diff;
                    closestV = { stop, offset: nv.offset };
                }
            });
        });

        let closestH: any = null;
        let minDiffH = snapThreshold;
        horizontalStops.forEach(stop => {
            nodeH.forEach(nh => {
                const diff = Math.abs(stop - nh.guide);
                if (diff < minDiffH) {
                    minDiffH = diff;
                    closestH = { stop, offset: nh.offset };
                }
            });
        });

        if (closestV) node.x(closestV.stop + closestV.offset);
        if (closestH) node.y(closestH.stop + closestH.offset);

        const newGuidelines = [];
        if (closestV) newGuidelines.push({ type: 'vertical', position: closestV.stop });
        if (closestH) newGuidelines.push({ type: 'horizontal', position: closestH.stop });

        setGuidelines(newGuidelines as any);
    }, [canvasWidth, canvasHeight, stageZoom]);

    const selectedLayer = useMemo(() => localLayers.find(l => l.id === selectedLayerId) || null, [localLayers, selectedLayerId]);
    const selectedSourceData = selectedLayer ? connectedInputs[selectedLayer.sourceHandleId] : null;
    const selectedSourceImages = selectedSourceData?.images || [];

    const totalPages = Math.ceil(selectedSourceImages.length / IMAGES_PER_PAGE);
    const showPagination = selectedSourceImages.length > IMAGES_PER_PAGE;
    const visibleImages = selectedSourceImages.slice(
        imagePageIndex * IMAGES_PER_PAGE,
        (imagePageIndex + 1) * IMAGES_PER_PAGE
    );

    const dimmerPathData = `
        M -99999 -99999 L 99999 -99999 L 99999 99999 L -99999 99999 Z 
        M 0 0 L 0 ${canvasHeight} L ${canvasWidth} ${canvasHeight} L ${canvasWidth} 0 Z
    `;

    return (
        <div className="fixed inset-0 z-[100000] bg-black/60 backdrop-blur-sm flex items-center justify-center pointer-events-auto">
            <div className="bg-surface-primary/90 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-[0_0_50px_-12px_rgba(0,0,0,0.5)] w-[94vw] h-[90vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/5">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-accent-primary/20 flex items-center justify-center border border-accent-primary/30">
                            <Layers2 className="w-6 h-6 text-accent-primary" />
                        </div>
                        <div>
                            <h2 className="font-bold text-lg text-content-primary leading-tight">Compositor Editor</h2>
                            <p className="text-[10px] text-content-tertiary uppercase tracking-widest font-bold">Studio Canvas</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-content-secondary hover:bg-white/5 transition-all">
                            Cancel
                        </button>
                        <button onClick={handleDone} className="px-6 py-2 rounded-xl bg-accent-primary text-white font-bold text-sm shadow-lg shadow-accent-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all">
                            Save Changes
                        </button>
                    </div>
                </div>

                {/* Main Content */}
                <div className="flex-1 flex overflow-hidden">
                    {/* Left Panel - Layers */}
                    <div className="w-52 border-r border-white/5 flex flex-col bg-white/5 backdrop-blur-3xl">
                        <div className="p-4 border-b border-white/5 bg-white/5 flex items-center justify-between">
                            <span className="text-xs font-bold text-content-primary uppercase tracking-wider">Layers</span>
                            <div className="text-[10px] text-content-tertiary px-1 uppercase font-bold opacity-50">Auto</div>
                        </div>

                        <Reorder.Group axis="y" values={localLayers} onReorder={reorderLayers} className="flex-1 overflow-y-auto p-1.5 space-y-1 custom-scrollbar">
                            {localLayers.map((layer) => {
                                const sourceData = connectedInputs[layer.sourceHandleId];
                                return (
                                    <LayerListItem
                                        key={layer.id}
                                        layer={layer}
                                        isSelected={selectedLayerId === layer.id}
                                        type={sourceData?.type}
                                        onSelect={selectOnCanvas}
                                        onToggleVisibility={toggleVisibility}
                                        onToggleLock={toggleLock}
                                    />
                                );
                            })}
                        </Reorder.Group>
                    </div>

                    {/* Center - Konva Stage */}
                    <div ref={stageContainerRef} className="flex-1 relative bg-[#050505] overflow-hidden" style={{ cursor: spaceHeld ? (isPanning ? 'grabbing' : 'grab') : 'default' }}>
                        <Stage
                            ref={stageRef}
                            width={stageContainerRef.current?.clientWidth || window.innerWidth}
                            height={stageContainerRef.current?.clientHeight || window.innerHeight}
                            onWheel={handleStageWheel}
                            scaleX={stageZoom}
                            scaleY={stageZoom}
                            x={stagePan.x}
                            y={stagePan.y}
                            draggable={spaceHeld}
                            onDragStart={() => setIsPanning(true)}
                            onDragEnd={(e) => {
                                if (e.target === e.target.getStage()) {
                                    setIsPanning(false);
                                    setStagePan({ x: e.target.x(), y: e.target.y() });
                                }
                            }}
                            onMouseDown={checkDeselect}
                            onTouchStart={checkDeselect}
                            onMouseUp={() => setGuidelines([])}
                            onTouchEnd={() => setGuidelines([])}
                        >
                            <Layer>
                                {/* 1. Artboard Background */}
                                <Rect
                                    name="background"
                                    x={0}
                                    y={0}
                                    width={canvasWidth}
                                    height={canvasHeight}
                                    fill="#111"
                                    stroke="rgba(255,255,255,0.2)"
                                    strokeWidth={1}
                                    shadowColor="black"
                                    shadowBlur={50}
                                    shadowOpacity={0.8}
                                />

                                {/* 2. Render Images/Text */}
                                {localLayers.map((layer) => {
                                    if (!layer.visible) return null;

                                    const sourceData = connectedInputs[layer.sourceHandleId];
                                    const data = sourceData?.images?.[layer.selectedIndex] || sourceData?.images?.[0];
                                    
                                    if (!data) return null;

                                    // Handle Image (object with url)
                                    if (data.url) {
                                        return (
                                            <URLImage
                                                key={layer.id}
                                                layer={layer}
                                                imageUrl={data.url}
                                                onSelect={() => selectOnCanvas(layer.id)}
                                                onChange={(updates) => updateTransform(layer.id, updates)}
                                                onDragMove={handleDragMove}
                                                onLoad={(img) => handleImageLoad(layer.id, img)}
                                            />
                                        );
                                    }

                                    // Handle Text (string)
                                    if (typeof data === 'string') {
                                        return (
                                            <URLText
                                                key={layer.id}
                                                layer={layer}
                                                text={data}
                                                onSelect={() => selectOnCanvas(layer.id)}
                                                onChange={(updates) => updateTransform(layer.id, updates)}
                                                onDragMove={handleDragMove}
                                            />
                                        );
                                    }

                                    return null;
                                })}

                                {/* 3. The Dimmer Overlay (Fades out anything outside the artboard) */}
                                <Path
                                    data={dimmerPathData}
                                    fill="rgba(0,0,0,0.6)"
                                    fillRule="evenodd"
                                    listening={false}
                                />

                                {/* 4. Smart Guidelines */}
                                {guidelines.map((line, i) => {
                                    const points = line.type === 'vertical'
                                        ? [line.position, -5000, line.position, 5000]
                                        : [-5000, line.position, 5000, line.position];

                                    return (
                                        <Line
                                            key={i}
                                            points={points}
                                            stroke="#00F2EA"
                                            strokeWidth={1 / stageZoom}
                                            dash={[4 / stageZoom, 4 / stageZoom]}
                                            listening={false}
                                        />
                                    );
                                })}

                                {/* 5. Master Transformer */}
                                {selectedLayer && !selectedLayer.locked && (
                                    <Transformer
                                        ref={transformerRef}
                                        flipEnabled={false}
                                        boundBoxFunc={(oldBox, newBox) => {
                                            if (newBox.width < 5 || newBox.height < 5) return oldBox;
                                            return newBox;
                                        }}
                                    />
                                )}
                            </Layer>
                        </Stage>

                        {/* Zoom Controls */}
                        <div className="absolute top-3 right-3 flex items-center gap-1 bg-surface-primary/80 backdrop-blur-sm rounded-lg border border-white/5 px-1 py-0.5 z-10 shadow-xl">
                            <button onClick={() => setStageZoom(Math.max(stageZoom * 0.8, 0.1))} className="p-1 rounded hover:bg-white/10 transition-colors">
                                <ZoomOut className="w-3.5 h-3.5 text-content-secondary" />
                            </button>
                            <span className="text-[10px] font-bold text-content-secondary min-w-[36px] text-center">{Math.round(stageZoom * 100)}%</span>
                            <button onClick={() => setStageZoom(Math.min(stageZoom * 1.25, 5))} className="p-1 rounded hover:bg-white/10 transition-colors">
                                <ZoomIn className="w-3.5 h-3.5 text-content-secondary" />
                            </button>
                            <div className="w-px h-4 bg-white/10 mx-0.5" />
                            <button onClick={fitToView} className="p-1 rounded hover:bg-white/10 transition-colors">
                                <Maximize2 className="w-3.5 h-3.5 text-content-secondary" />
                            </button>
                        </div>
                    </div>

                    {/* Right Panel - Properties */}
                    <div className="w-72 border-l border-white/5 flex flex-col bg-white/5 backdrop-blur-3xl overflow-hidden shadow-[-10px_0_30px_-15px_rgba(0,0,0,0.5)]">
                        <div className="p-4 border-b border-white/5 bg-white/5 font-bold text-[10px] uppercase tracking-wider text-white/40">Properties</div>

                        {selectedLayer ? (
                            <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
                                {/* Image Selector with Pagination */}
                                {selectedSourceImages.length > 1 && (
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <label className="text-[10px] font-bold text-white/40 uppercase tracking-tighter">Source Selection</label>
                                            <span className="text-[9px] text-accent-primary font-bold">{selectedLayer.selectedIndex + 1} / {selectedSourceImages.length}</span>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="grid grid-cols-3 gap-2">
                                                {visibleImages.map((img, idx) => {
                                                    const actualIdx = imagePageIndex * IMAGES_PER_PAGE + idx;
                                                    return (
                                                        <button
                                                            key={actualIdx}
                                                            onClick={() => updateSelectedIndex(selectedLayerId!, actualIdx)}
                                                            className={cn(
                                                                "aspect-square rounded-xl border-2 overflow-hidden transition-all duration-300",
                                                                selectedLayer.selectedIndex === actualIdx ? "border-accent-primary scale-[1.05] shadow-lg shadow-accent-primary/20" : "border-white/5 hover:border-white/20"
                                                            )}
                                                        >
                                                            <img src={img.url} alt="" className="w-full h-full object-cover" />
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            {showPagination && (
                                                <div className="flex items-center justify-between bg-white/5 rounded-lg p-1">
                                                    <button onClick={() => setImagePageIndex(p => Math.max(0, p - 1))} disabled={imagePageIndex === 0} className="p-1.5 rounded-md hover:bg-white/10 disabled:opacity-20 transition-all font-bold">
                                                        <ChevronLeft className="w-4 h-4" />
                                                    </button>
                                                    <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest">Page {imagePageIndex + 1}</span>
                                                    <button onClick={() => setImagePageIndex(p => Math.min(totalPages - 1, p + 1))} disabled={imagePageIndex >= totalPages - 1} className="p-1.5 rounded-md hover:bg-white/10 disabled:opacity-20 transition-all font-bold">
                                                        <ChevronRight className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-2">
                                        <NumberInput
                                            label="X Position"
                                            value={Math.round(selectedLayer.transform.x)}
                                            onChange={(e) => updateTransform(selectedLayerId!, { x: Number(e.target.value) })}
                                        />
                                        <NumberInput
                                            label="Y Position"
                                            value={Math.round(selectedLayer.transform.y)}
                                            onChange={(e) => updateTransform(selectedLayerId!, { y: Number(e.target.value) })}
                                        />
                                        <NumberInput
                                            label="Width"
                                            value={Math.round(selectedLayer.transform.width)}
                                            onChange={(e) => updateTransform(selectedLayerId!, { width: Number(e.target.value) })}
                                        />
                                        <NumberInput
                                            label="Height"
                                            value={Math.round(selectedLayer.transform.height)}
                                            onChange={(e) => updateTransform(selectedLayerId!, { height: Number(e.target.value) })}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                        <label className="text-[9px] font-bold text-white/20 uppercase tracking-tighter">Opacity</label>
                                        <span className="text-[9px] font-bold text-accent-primary">{Math.round(selectedLayer.transform.opacity * 100)}%</span>
                                    </div>
                                    <input type="range" min="0" max="1" step="0.05" value={selectedLayer.transform.opacity} onChange={(e) => updateTransform(selectedLayerId!, { opacity: Number(e.target.value) })} className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-accent-primary" />
                                </div>

                                <div className="grid grid-cols-3 gap-1.5">
                                    <button onClick={() => toggleFlip(selectedLayerId!, 'flipX')} className={cn("p-2 rounded-lg border transition-all flex items-center justify-center", selectedLayer.transform.flipX ? "bg-accent-primary/20 border-accent-primary/50 text-accent-primary" : "bg-white/5 border-white/5 hover:bg-white/10 text-white/40")}>
                                        <FlipHorizontal className="w-3.5 h-3.5" />
                                    </button>
                                    <button onClick={() => toggleFlip(selectedLayerId!, 'flipY')} className={cn("p-2 rounded-lg border transition-all flex items-center justify-center", selectedLayer.transform.flipY ? "bg-accent-primary/20 border-accent-primary/50 text-accent-primary" : "bg-white/5 border-white/5 hover:bg-white/10 text-white/40")}>
                                        <FlipVertical className="w-3.5 h-3.5" />
                                    </button>
                                    <button onClick={() => resetTransform(selectedLayerId!)} className="p-2 rounded-lg border bg-white/5 border-white/5 hover:bg-white/10 transition-all flex items-center justify-center text-white/40">
                                        <RotateCcw className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col overflow-hidden">
                                <div className="p-4 border-b border-white/5">
                                    <h3 className="text-xs font-bold text-content-primary uppercase tracking-wider">Canvas Settings</h3>
                                    <p className="text-[10px] text-content-tertiary mt-1">Adjust dimensions or choose a preset</p>
                                </div>

                                <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
                                    <div className="space-y-3">
                                        <label className="text-[10px] font-bold text-white/40 uppercase tracking-tighter">Custom Size</label>
                                        <div className="grid grid-cols-2 gap-3">
                                            <NumberInput
                                                label="Width"
                                                value={canvasWidth}
                                                onChange={(e) => setCanvasWidth(Math.max(100, Number(e.target.value)))}
                                            />
                                            <NumberInput
                                                label="Height"
                                                value={canvasHeight}
                                                onChange={(e) => setCanvasHeight(Math.max(100, Number(e.target.value)))}
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <label className="text-[10px] font-bold text-white/40 uppercase tracking-tighter">Social Presets</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {CANVAS_PRESETS.map((preset) => {
                                                const Icon = preset.icon;
                                                const isActive = canvasWidth === preset.width && canvasHeight === preset.height;
                                                return (
                                                    <button
                                                        key={preset.label}
                                                        onClick={() => changeCanvasSize(preset.width, preset.height)}
                                                        className={cn("flex flex-col items-center justify-center p-2.5 rounded-xl border transition-all duration-300 gap-1.5", isActive ? "bg-accent-primary/20 border-accent-primary/40 shadow-lg shadow-primary/10" : "bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/20")}
                                                    >
                                                        <div className="w-7 h-7 rounded-lg flex items-center justify-center shadow-sm" style={{ backgroundColor: preset.color + '20', color: preset.color }}>
                                                            <Icon className="w-3.5 h-3.5" />
                                                        </div>
                                                        <div className="flex flex-col items-center text-center">
                                                            <span className={cn("text-[9px] font-bold leading-tight", isActive ? "text-white" : "text-white/60")}>{preset.label}</span>
                                                            <span className="text-[8px] text-white/20 font-medium">{preset.width}×{preset.height}</span>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
