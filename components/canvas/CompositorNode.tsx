'use client';

import React, { memo, useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { NodeProps, useReactFlow, useEdges } from 'reactflow';
import { Plus, Edit3 } from 'lucide-react';
import { Stage, Layer, Image as KonvaImage, Group } from 'react-konva';
import useImage from 'use-image';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import BaseNode from './BaseNode';
import { CompositorConfig, CompositorLayer, LayerTransform, ImageObject } from '@/lib/nodes/types';
import CompositorEditorModal from '@/components/compositor/CompositorEditorModal';
import ImageLightbox from '@/components/ui/ImageLightbox';

// Layer colors for visual distinction
const LAYER_COLORS = [
    '#06b6d4', // Cyan
    '#14b8a6', // Teal
    '#10b981', // Emerald
    '#0ea5e9', // Sky
    '#34d399', // Light Emerald
    '#22d3ee', // Light Cyan
    '#2dd4bf', // Light Teal
    '#67e8f9', // Very Light Cyan
];

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
        }
    ],
    outputFormat: 'png',
    outputQuality: 1.0,
};

interface CompositorNodeData {
    label: string;
    config: CompositorConfig;
}

// 1. Memoized Preview Image WITH CACHE-BUSTING CORS FIX
const PreviewImage = memo(({ layer, imageUrl }: { layer: CompositorLayer, imageUrl: string }) => {
    const safeUrl = useMemo(() => {
        if (!imageUrl) return '';
        if (imageUrl.startsWith('data:')) return imageUrl;
        return imageUrl + (imageUrl.includes('?') ? '&' : '?') + 'notaint=1';
    }, [imageUrl]);

    const [img] = useImage(safeUrl, 'anonymous');

    if (!img) return null;

    return (
        <KonvaImage
            image={img}
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
            listening={false}
        />
    );
});

// Professional CSS Checkerboard to indicate transparent areas
const checkerboardStyle = {
    backgroundImage: 'repeating-linear-gradient(45deg, rgb(var(--checker-1)) 25%, transparent 25%, transparent 75%, rgb(var(--checker-1)) 75%, rgb(var(--checker-1))), repeating-linear-gradient(45deg, rgb(var(--checker-1)) 25%, transparent 25%, transparent 75%, rgb(var(--checker-1)) 75%, rgb(var(--checker-1)))',
    backgroundPosition: '0 0, 8px 8px',
    backgroundSize: '16px 16px',
    backgroundColor: 'rgb(var(--checker-2))'
};

// 2. Dynamic Auto-Scaling Live Preview WITH TRANSPARENCY FIX
function LivePreview({
    config,
    connectedInputs,
    stageRef
}: {
    config: CompositorConfig;
    connectedInputs: Record<string, ImageObject[]>;
    stageRef: React.RefObject<any>;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    const canvasWidth = config.canvasWidth || 1920;
    const canvasHeight = config.canvasHeight || 1080;

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver((entries) => {
            const rect = entries[0].contentRect;
            setSize({ width: rect.width, height: rect.height });
        });

        observer.observe(container);
        return () => observer.disconnect();
    }, []);

    const scale = size.width > 0 ? size.width / canvasWidth : 0;

    return (
        <div
            ref={containerRef}
            className="w-full relative overflow-hidden flex items-center justify-center rounded-xl border border-stroke-subtle shadow-2xl"
            style={{
                ...checkerboardStyle,
                aspectRatio: `${canvasWidth} / ${canvasHeight}`
            }}
        >
            {scale > 0 && (
                <Stage
                    ref={stageRef}
                    width={size.width}
                    height={size.height}
                >
                    <Layer>
                        <Group scaleX={scale} scaleY={scale}>
                            {/* THE FIX: The background <Rect> was completely removed to guarantee strict transparency */}
                            {config.layers.map((layer) => {
                                if (!layer.visible) return null;

                                const sourceImages = connectedInputs[layer.sourceHandleId];
                                const imageData = sourceImages?.[layer.selectedIndex] || sourceImages?.[0];
                                if (!imageData?.url) return null;

                                return (
                                    <PreviewImage
                                        key={layer.id}
                                        layer={layer}
                                        imageUrl={imageData.url}
                                    />
                                );
                            })}
                        </Group>
                    </Layer>
                </Stage>
            )}
        </div>
    );
}

function CompositorNode({ data, id, selected }: NodeProps<CompositorNodeData>) {
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const stageRef = useRef<any>(null);

    const currentWorkflow = useAppStore((state) => state.currentWorkflow);
    const nodeOutputs = useAppStore((state) => state.nodeOutputs);

    const config: CompositorConfig = useMemo(() => ({
        ...defaultConfig,
        ...data.config,
        layers: data.config?.layers || defaultConfig.layers,
    }), [data.config]);

    const edges = useEdges();
    const connectedEdges = useMemo(() => edges.filter(e => e.target === id), [edges, id]);

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

    const handleCount = Math.max(1, maxConnectedIndex + 2);

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

    const { setNodes } = useReactFlow();

    useEffect(() => {
        const currentLayers = data.config?.layers || defaultConfig.layers;
        if (currentLayers.length !== handleCount) {
            let newLayers = [...currentLayers];

            if (newLayers.length < handleCount) {
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

    const openEditor = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsEditorOpen(true);
    };

    const inputHandles = useMemo(() => {
        const handles = [];
        for (let i = 0; i < handleCount; i++) {
            handles.push({
                id: `layer_${i}`,
                label: `L${i + 1}`,
                color: LAYER_COLORS[i % LAYER_COLORS.length],
                is_array: true,
            });
        }
        return handles;
    }, [handleCount]);

    const canvasW = config.canvasWidth || 1920;
    const canvasH = config.canvasHeight || 1080;

    const openLightbox = (e: React.MouseEvent) => {
        e.stopPropagation();
        setLightboxOpen(true);
    };

    return (
        <>
            <BaseNode
                id={id}
                type="compositor"
                label={data.label}
                selected={selected}
                isNew={(data as any).isNew}
                badgeCount={config.layers.length}
                width={320}
                customInputs={inputHandles}
                hideStatus={true}
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
                    className="relative w-full group/compositor transition-all duration-500 cursor-zoom-in flex flex-col"
                    style={{ minHeight: '160px' }}
                >
                    {hasConnectedInputs ? (
                        <div className="w-full p-1">
                            <LivePreview
                                config={config}
                                connectedInputs={connectedInputs}
                                stageRef={stageRef}
                            />
                        </div>
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-content-tertiary border border-stroke-subtle rounded-xl bg-surface-secondary/50 m-1">
                            <Plus className="w-8 h-8 opacity-20" />
                            <span className="text-[10px] font-medium uppercase tracking-wider opacity-40">Connect Inputs</span>
                        </div>
                    )}

                    {/* Quick Edit Overlay */}
                    <div className="absolute inset-x-0 bottom-0 p-3 translate-y-2 opacity-0 group-hover/compositor:translate-y-0 group-hover/compositor:opacity-100 transition-all duration-300 pointer-events-none">
                        <div className="bg-surface-primary/80 backdrop-blur-xl border border-stroke-subtle rounded-lg p-2 flex items-center justify-between pointer-events-auto">
                            <div className="flex flex-col">
                                <span className="text-[9px] font-bold text-content-tertiary px-1 uppercase tracking-tighter">
                                    {canvasW}x{canvasH}
                                </span>
                                <span className="text-[7px] text-content-tertiary/70 px-1 uppercase leading-none">Composition</span>
                            </div>
                            <button
                                onClick={openEditor}
                                className="px-2 py-1 rounded-md bg-accent-primary/10 hover:bg-accent-primary/20 text-[9px] font-bold text-accent-primary uppercase transition-colors"
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
            {/* Image Lightbox */}
            {lightboxOpen && (
                <ImageLightbox
                    media={[{
                        base64: stageRef.current ? stageRef.current.toDataURL({
                            pixelRatio: 1 / stageRef.current.scaleX()
                        }) : ''
                    }]}
                    type="image"
                    initialIndex={0}
                    onClose={() => setLightboxOpen(false)}
                />
            )}
        </>
    );
}

export default memo(CompositorNode);