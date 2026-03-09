'use client';

import React, { memo, useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { NodeProps, useReactFlow, useEdges } from 'reactflow';
import { Plus, Edit3, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import BaseNode from './BaseNode';
import { CompositorConfig, CompositorLayer, LayerTransform, ImageObject } from '@/lib/nodes/types';
import CompositorEditorModal from '@/components/compositor/CompositorEditorModal';
import ImageLightbox from '@/components/ui/ImageLightbox';

// Layer colors for visual distinction
const LAYER_COLORS = [
    '#22c55e', '#f59e0b', '#3b82f6', '#ec4899',
    '#8b5cf6', '#06b6d4', '#f97316', '#84cc16',
];

// Default transform for new layers
const defaultTransform: LayerTransform = {
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    rotation: 0,
    opacity: 1,
    flipX: false,
    flipY: false,
    crop: null,
};

// Default compositor config
const defaultConfig: CompositorConfig = {
    canvasWidth: 1920,
    canvasHeight: 1080,
    backgroundColor: '#00000000',
    layers: [
        {
            id: 'layer_0',
            name: 'Layer 1',
            sourceHandleId: 'layer_0',
            selectedIndex: 0,
            transform: {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
                rotation: 0,
                opacity: 1,
                flipX: false,
                flipY: false,
                crop: null,
            },
            visible: true,
            locked: false,
        },
        {
            id: 'layer_1',
            name: 'Layer 2',
            sourceHandleId: 'layer_1',
            selectedIndex: 0,
            transform: {
                x: 100,
                y: 100,
                width: 400,
                height: 300,
                rotation: 0,
                opacity: 1,
                flipX: false,
                flipY: false,
                crop: null,
            },
            visible: true,
            locked: false,
        }
    ],
    outputFormat: 'png',
    outputQuality: 1.0,
};

interface CompositorNodeData {
    label: string;
    config: CompositorConfig;
}

// Live preview component using canvas-absolute coordinates (matching editor)
function LivePreview({
    id,
    config,
    connectedInputs,
    containerWidth,
    containerHeight,
}: {
    id: string;
    config: CompositorConfig;
    connectedInputs: Record<string, ImageObject[]>;
    containerWidth: number;
    containerHeight: number;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imagesLoadedRef = useRef<Map<string, HTMLImageElement>>(new Map());

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = containerWidth;
        canvas.height = containerHeight;

        // Fixed scale: preview pixels → canvas-absolute pixels
        const canvasWidth = config.canvasWidth || 1920;
        const canvasHeight = config.canvasHeight || 1080;
        const scale = containerWidth / canvasWidth;

        // Clear canvas (no background grid)
        ctx.clearRect(0, 0, containerWidth, containerHeight);

        // Draw each layer
        const drawLayers = async () => {
            for (let i = 0; i < config.layers.length; i++) {
                const layer = config.layers[i];
                if (!layer.visible) continue;

                const sourceImages = connectedInputs[layer.sourceHandleId];
                if (!sourceImages || sourceImages.length === 0) continue;

                const imageData = sourceImages[layer.selectedIndex] || sourceImages[0];
                if (!imageData?.url) continue;

                // Load or get cached image
                let img = imagesLoadedRef.current.get(imageData.url);
                if (!img) {
                    img = new Image();
                    img.crossOrigin = 'anonymous';
                    img.src = imageData.url;
                    imagesLoadedRef.current.set(imageData.url, img);
                    await new Promise<void>((resolve) => {
                        img!.onload = () => resolve();
                        img!.onerror = () => resolve();
                    });
                }

                if (!img.complete || img.naturalWidth === 0) continue;

                ctx.save();
                ctx.globalAlpha = layer.transform.opacity;

                // Canvas-absolute coords → preview coords
                const x = layer.transform.x * scale;
                const y = layer.transform.y * scale;
                const w = layer.transform.width * scale;
                const h = layer.transform.height * scale;

                ctx.translate(x + w / 2, y + h / 2);
                ctx.rotate((layer.transform.rotation * Math.PI) / 180);
                ctx.scale(layer.transform.flipX ? -1 : 1, layer.transform.flipY ? -1 : 1);

                ctx.drawImage(img, -w / 2, -h / 2, w, h);
                ctx.restore();
            }
        };

        drawLayers();
    }, [config, connectedInputs, containerWidth, containerHeight]);

    return <canvas id={`canvas-${id}`} ref={canvasRef} className="w-full h-full" />;
}

function CompositorNode({ data, id }: NodeProps<CompositorNodeData>) {
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const previewRef = useRef<HTMLDivElement>(null);
    const liveCanvasRef = useRef<HTMLCanvasElement>(null);

    const currentWorkflow = useAppStore((state) => state.currentWorkflow);
    const nodeOutputs = useAppStore((state) => state.nodeOutputs);

    // Get config with defaults
    const config: CompositorConfig = useMemo(() => ({
        ...defaultConfig,
        ...data.config,
        layers: data.config?.layers || defaultConfig.layers,
    }), [data.config]);

    const edges = useEdges();
    const connectedEdges = useMemo(() => edges.filter(e => e.target === id), [edges, id]);

    // Find the max index currently connected
    const maxConnectedIndex = useMemo(() => {
        let max = -1;
        connectedEdges.forEach(edge => {
            const handleId = edge.targetHandle;
            if (handleId && handleId.startsWith('layer_')) {
                const index = parseInt(handleId.split('_')[1], 10);
                if (!isNaN(index) && index > max) max = index;
            }
        });
        return max;
    }, [connectedEdges]);

    // Always have one more handle than the max connected (Strict N+1)
    const handleCount = Math.max(1, maxConnectedIndex + 2);

    // Get connected inputs for live preview
    const connectedInputs = useMemo(() => {
        if (!currentWorkflow) return {};
        const edges = currentWorkflow.edges?.filter(e => e.target === id) || [];
        const inputs: Record<string, ImageObject[]> = {};

        edges.forEach(edge => {
            const handleId = (edge as any).targetHandle || 'default';
            const sourceOutput = nodeOutputs[edge.source];
            if (sourceOutput) {
                inputs[handleId] = Array.isArray(sourceOutput) ? sourceOutput : [sourceOutput];
            }
        });

        return inputs;
    }, [currentWorkflow, id, nodeOutputs]);

    const hasConnectedInputs = useMemo(() => {
        return Object.keys(connectedInputs).length > 0 &&
            Object.values(connectedInputs).some(arr => arr && arr.length > 0);
    }, [connectedInputs]);

    // Use React Flow hook for direct graph manipulation
    const { setNodes } = useReactFlow();

    // Sync layers with handle count automatically
    useEffect(() => {
        const currentLayers = data.config?.layers || defaultConfig.layers;
        if (currentLayers.length !== handleCount) {
            let newLayers = [...currentLayers];

            if (newLayers.length < handleCount) {
                // Add missing
                for (let i = newLayers.length; i < handleCount; i++) {
                    newLayers.push({
                        id: `layer_${i}`,
                        name: `Layer ${i + 1}`,
                        sourceHandleId: `layer_${i}`,
                        selectedIndex: 0,
                        transform: { ...defaultTransform },
                        visible: true,
                        locked: false,
                    });
                }
            } else {
                // Prune extra
                newLayers = newLayers.slice(0, handleCount);
            }

            setNodes((nds) =>
                nds.map((node) => {
                    if (node.id === id) {
                        return {
                            ...node,
                            data: {
                                ...node.data,
                                config: { ...node.data.config, layers: newLayers },
                            },
                        };
                    }
                    return node;
                })
            );
        }
    }, [handleCount, id, setNodes, data.config]);

    // Update node config
    const updateConfig = useCallback((newConfig: Partial<CompositorConfig>) => {
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === id) {
                    return {
                        ...node,
                        data: {
                            ...node.data,
                            config: { ...config, ...newConfig },
                        },
                    };
                }
                return node;
            })
        );
    }, [id, config, setNodes]);

    // Add a new layer
    const addLayer = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        const newLayerIndex = config.layers.length;
        const newLayer: CompositorLayer = {
            id: `layer_${newLayerIndex}`,
            name: `Layer ${newLayerIndex + 1}`,
            sourceHandleId: `layer_${newLayerIndex}`,
            selectedIndex: 0,
            transform: { ...defaultTransform },
            visible: true,
            locked: false,
        };
        updateConfig({ layers: [...config.layers, newLayer] });
    }, [config.layers, updateConfig]);

    const openEditor = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsEditorOpen(true);
    };

    // Input handles derived from needed handles
    const inputHandles = useMemo(() => {
        const handles = [];
        for (let i = 0; i < handleCount; i++) {
            handles.push({
                id: `layer_${i}`,
                label: `L${i + 1}`,
                color: LAYER_COLORS[i % LAYER_COLORS.length],
            });
        }
        return handles;
    }, [handleCount]);

    // Dynamic constraint configuration for the live preview
    const canvasW = config.canvasWidth || 1920;
    const canvasH = config.canvasHeight || 1080;
    const MAX_PREVIEW_H = 300;

    const openLightbox = (e: React.MouseEvent) => {
        e.stopPropagation();
        setLightboxOpen(true);
    };

    // Use a reasonable internal buffer resolution for the preview canvas
    const PREVIEW_RENDER_SIZE = 512;
    const renderScale = Math.min(PREVIEW_RENDER_SIZE / canvasW, PREVIEW_RENDER_SIZE / canvasH);
    const renderWidth = Math.max(1, Math.floor(canvasW * renderScale));
    const renderHeight = Math.max(1, Math.floor(canvasH * renderScale));

    return (
        <>
            <BaseNode
                id={id}
                type="compositor"
                label={data.label}
                badgeCount={config.layers.length}
                width={320}
                customInputs={inputHandles}
                customActions={
                    <button
                        onClick={openEditor}
                        className="w-6 h-6 rounded-full bg-accent-primary/90 hover:bg-accent-primary backdrop-blur-sm
                                flex items-center justify-center shadow-lg hover:scale-110 transition-all duration-200"
                        title="Edit compositor"
                    >
                        <Edit3 className="w-3 h-3 text-content-inverted" />
                    </button>
                }
                contentClassName="p-0 overflow-hidden"
            >
                <div
                    onClick={openLightbox}
                    className="relative w-full group/compositor bg-canvas-bg/20 backdrop-blur-sm transition-all duration-500 cursor-zoom-in"
                    style={{
                        aspectRatio: `${canvasW} / ${canvasH}`,
                        minHeight: '160px',
                    }}
                >
                    {hasConnectedInputs ? (
                        <div className="w-full h-full p-1">
                            <div className="w-full h-full relative rounded-xl overflow-hidden border border-white/10 shadow-2xl">
                                <LivePreview
                                    id={id}
                                    config={config}
                                    connectedInputs={connectedInputs}
                                    containerWidth={renderWidth}
                                    containerHeight={renderHeight}
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-content-tertiary">
                            <Plus className="w-8 h-8 opacity-20" />
                            <span className="text-[10px] font-medium uppercase tracking-wider opacity-40">Connect Inputs</span>
                        </div>
                    )}

                    {/* Quick Edit Overlay */}
                    <div className="absolute inset-x-0 bottom-0 p-3 translate-y-2 opacity-0 group-hover/compositor:translate-y-0 group-hover/compositor:opacity-100 transition-all duration-300 pointer-events-none">
                        <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-lg p-2 flex items-center justify-between pointer-events-auto">
                            <div className="flex flex-col">
                                <span className="text-[9px] font-bold text-white/50 px-1 uppercase tracking-tighter">
                                    {canvasW}x{canvasH}
                                </span>
                                <span className="text-[7px] text-white/30 px-1 uppercase leading-none">Composition</span>
                            </div>
                            <button
                                onClick={openEditor}
                                className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-[9px] font-bold text-white uppercase transition-colors"
                            >
                                Open Editor
                            </button>
                        </div>
                    </div>
                </div>
            </BaseNode>

            {/* Editor Modal Portal */}
            {
                isEditorOpen && createPortal(
                    <CompositorEditorModal
                        nodeId={id}
                        config={config}
                        onClose={() => setIsEditorOpen(false)}
                        onConfigChange={updateConfig}
                    />,
                    document.body
                )
            }
            {
                lightboxOpen && createPortal(
                    <ImageLightbox
                        images={[{ base64: (document.getElementById(`canvas-${id}`) as HTMLCanvasElement)?.toDataURL() || '' }]}
                        initialIndex={0}
                        onClose={() => setLightboxOpen(false)}
                    />,
                    document.body
                )
            }
        </>
    );
}

export default memo(CompositorNode);
