'use client';

import React, { memo, useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import { nodeMetadata } from '@/lib/nodes/metadata';
import { Layers2, Plus, X, Edit3, Eye, EyeOff, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import { CompositorConfig, CompositorLayer, LayerTransform, ImageObject } from '@/lib/nodes/types';
import CompositorEditorModal from '@/components/compositor/CompositorEditorModal';

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
    layers: [],
    outputFormat: 'png',
    outputQuality: 1.0,
};

interface CompositorNodeData {
    label: string;
    config: CompositorConfig;
}

// Live preview component using canvas-absolute coordinates (matching editor)
function LivePreview({
    config,
    connectedInputs,
    containerWidth,
    containerHeight,
}: {
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

        // Clear canvas
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

    return <canvas ref={canvasRef} className="w-full h-full" />;
}

function CompositorNode({ data, id }: NodeProps<CompositorNodeData>) {
    const metadata = nodeMetadata['compositor'];
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const previewRef = useRef<HTMLDivElement>(null);

    const deleteNode = useAppStore((state) => state.deleteNode);
    const triggerRunFromNode = useAppStore((state) => state.triggerRunFromNode);
    const currentWorkflow = useAppStore((state) => state.currentWorkflow);
    const nodeOutputs = useAppStore((state) => state.nodeOutputs);

    // Get config with defaults
    const config: CompositorConfig = useMemo(() => ({
        ...defaultConfig,
        ...data.config,
        layers: data.config?.layers || [],
    }), [data.config]);

    // Get connected inputs for live preview
    const connectedInputs = useMemo(() => {
        if (!currentWorkflow) return {};
        const edges = currentWorkflow.edges.filter(e => e.target === id);
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

    const nodeColor = metadata?.color || '#8b5cf6';

    // Dynamic constraint configuration for the live preview
    const canvasW = config.canvasWidth || 1920;
    const canvasH = config.canvasHeight || 1080;
    const MAX_PREVIEW_H = 300;

    // Use a reasonable internal buffer resolution for the preview canvas
    const PREVIEW_RENDER_SIZE = 512;
    const renderScale = Math.min(PREVIEW_RENDER_SIZE / canvasW, PREVIEW_RENDER_SIZE / canvasH);
    const renderWidth = Math.max(1, Math.floor(canvasW * renderScale));
    const renderHeight = Math.max(1, Math.floor(canvasH * renderScale));

    // Use React Flow hook for direct graph manipulation
    const { setNodes, deleteElements } = useReactFlow();

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

    // Delete node
    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        deleteElements({ nodes: [{ id }] });
    };

    const openEditor = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsEditorOpen(true);
    };

    const handleRunFromHere = (e: React.MouseEvent) => {
        e.stopPropagation();
        triggerRunFromNode(id);
    };

    // Input handles derived from layers
    const inputHandles = useMemo(() =>
        config.layers.map((layer, index) => ({
            id: layer.sourceHandleId,
            label: `L${index + 1}`,
            color: LAYER_COLORS[index % LAYER_COLORS.length],
        })),
        [config.layers]
    );

    return (
        <div
            className={cn(
                "rounded-xl shadow-lg border-2 backdrop-blur-sm relative group bg-canvas-node",
                "transition-all duration-300 hover:shadow-2xl",
                "min-w-[260px]"
            )}
            style={{
                width: 280,
                background: `linear-gradient(135deg, ${nodeColor}15 0%, ${nodeColor}30 100%)`,
                borderColor: nodeColor,
            }}
        >
            {/* Node Action Buttons - appear on hover */}
            <div className="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 z-10">
                <button
                    onClick={handleRunFromHere}
                    className="w-6 h-6 rounded-full bg-emerald-500/90 hover:bg-emerald-600 backdrop-blur-sm
                               flex items-center justify-center shadow-lg hover:scale-110 transition-all duration-200"
                    title="Run from here"
                >
                    <Play className="w-3 h-3 text-content-inverted fill-current" />
                </button>
                <button
                    onClick={openEditor}
                    className="w-6 h-6 rounded-full bg-accent-primary/90 hover:bg-accent-primary backdrop-blur-sm
                               flex items-center justify-center shadow-lg hover:scale-110 transition-all duration-200"
                    title="Edit compositor"
                >
                    <Edit3 className="w-3 h-3 text-content-inverted" />
                </button>
                <button
                    onClick={handleDelete}
                    className="w-6 h-6 rounded-full bg-accent-error/90 hover:bg-accent-error backdrop-blur-sm
                               flex items-center justify-center shadow-lg hover:scale-110 transition-all duration-200"
                    title="Delete node"
                >
                    <X className="w-3.5 h-3.5 text-content-inverted" />
                </button>
            </div>

            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-stroke-subtle/20">
                <div
                    className="w-6 h-6 rounded-md flex items-center justify-center"
                    style={{ backgroundColor: `${nodeColor}40` }}
                >
                    <Layers2 className="w-3.5 h-3.5" style={{ color: nodeColor }} />
                </div>
                <span className="text-xs font-semibold text-canvas-text truncate">Compositor</span>
                {config.layers.length > 0 && (
                    <span className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent-primary text-content-inverted">
                        {config.layers.length}
                    </span>
                )}
            </div>

            {/* Dynamic Input Handles */}
            {inputHandles.map((handle, index) => {
                const totalHandles = inputHandles.length;
                const spacing = 28;
                const totalHeight = (totalHandles - 1) * spacing;
                const offset = (index * spacing) - (totalHeight / 2);

                return (
                    <React.Fragment key={handle.id}>
                        <Handle
                            type="target"
                            position={Position.Left}
                            id={handle.id}
                            className="!w-2.5 !h-2.5 !border-2 !border-surface-primary hover:!brightness-110 transition-colors"
                            style={{
                                background: handle.color,
                                left: -5,
                                top: `calc(50% + ${offset}px + 24px)`,
                            }}
                        />
                        <div
                            className="absolute text-[8px] font-bold pointer-events-none select-none"
                            style={{
                                left: 8,
                                top: `calc(50% + ${offset}px + 20px)`,
                                color: handle.color,
                            }}
                        >
                            {handle.label}
                        </div>
                    </React.Fragment>
                );
            })}

            {/* Content */}
            <div className="p-2">
                {config.layers.length === 0 ? (
                    <button
                        onClick={addLayer}
                        className={cn(
                            "w-full h-20 rounded-lg border-2 border-dashed transition-all",
                            "flex flex-col items-center justify-center gap-1",
                            "text-content-tertiary hover:text-accent-primary hover:border-accent-primary",
                            "border-stroke-default"
                        )}
                    >
                        <Plus className="w-5 h-5" />
                        <span className="text-[10px]">Add Layer</span>
                    </button>
                ) : (
                    <div className="space-y-1">
                        {/* Live Preview Container Wrapper */}
                        <div
                            className="w-full flex items-center justify-center p-2 pt-0"
                        >
                            <div
                                ref={previewRef}
                                className="relative flex-shrink-0 rounded-lg border border-stroke-subtle overflow-hidden shadow-[0_4px_12px_rgba(0,0,0,0.5)] bg-[#1a1a1a]"
                                style={{
                                    width: '100%',
                                    maxWidth: `calc(${MAX_PREVIEW_H}px * (${canvasW} / ${canvasH}))`,
                                    maxHeight: `${MAX_PREVIEW_H}px`,
                                    aspectRatio: `${canvasW} / ${canvasH}`,
                                    backgroundImage: 'repeating-conic-gradient(#262626 0% 25%, #1a1a1a 0% 50%)',
                                    backgroundSize: '16px 16px',
                                    backgroundPosition: '0 0',
                                }}
                            >
                                {hasConnectedInputs ? (
                                    <LivePreview
                                        config={config}
                                        connectedInputs={connectedInputs}
                                        containerWidth={renderWidth}
                                        containerHeight={renderHeight}
                                    />
                                ) : (
                                    <div className="absolute inset-0 flex items-center justify-center text-xs text-content-tertiary">
                                        <div className="bg-surface-primary/80 px-2 py-1 rounded backdrop-blur-sm shadow-sm font-medium">
                                            Connect inputs
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Layer list */}
                        <div className="flex flex-wrap gap-1">
                            {config.layers.slice(0, 4).map((layer, index) => (
                                <div
                                    key={layer.id}
                                    className="px-1.5 py-0.5 rounded text-[9px] font-medium flex items-center gap-1"
                                    style={{
                                        backgroundColor: `${LAYER_COLORS[index % LAYER_COLORS.length]}20`,
                                        color: LAYER_COLORS[index % LAYER_COLORS.length],
                                    }}
                                >
                                    {layer.visible ? <Eye className="w-2 h-2" /> : <EyeOff className="w-2 h-2 opacity-50" />}
                                    L{index + 1}
                                </div>
                            ))}
                            {config.layers.length > 4 && (
                                <div className="px-1.5 py-0.5 rounded text-[9px] font-medium text-content-secondary bg-surface-tertiary">
                                    +{config.layers.length - 4}
                                </div>
                            )}
                        </div>

                        {/* Add Layer Button */}
                        <button
                            onClick={addLayer}
                            className="w-full py-1 rounded text-[10px] font-medium text-accent-primary 
                                       bg-accent-primary/10 hover:bg-accent-primary/20 transition-colors"
                        >
                            + Add Layer
                        </button>
                    </div>
                )}
            </div>

            {/* Output Handle */}
            <Handle
                type="source"
                position={Position.Right}
                id="output"
                className="!w-3 !h-3 !border-2 !border-surface-primary hover:!brightness-110 transition-colors"
                style={{ background: nodeColor, right: -6 }}
            />

            {/* Editor Modal Portal */}
            {isEditorOpen && createPortal(
                <CompositorEditorModal
                    nodeId={id}
                    config={config}
                    onClose={() => setIsEditorOpen(false)}
                    onConfigChange={updateConfig}
                />,
                document.body
            )}
        </div>
    );
}

export default memo(CompositorNode);
