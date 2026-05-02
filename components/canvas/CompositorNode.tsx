'use client';

import React, { memo, useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { NodeProps, useReactFlow } from 'reactflow';
import { Plus, Edit3 } from 'lucide-react';
import { Stage, Layer, Image as KonvaImage, Group, Text as KonvaText } from 'react-konva';
import useImage from 'use-image';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import { useShallow } from 'zustand/react/shallow';
import BaseNode from './BaseNode';
import { CompositorConfig, CompositorLayer, LayerTransform, ImageObject, calculateInitialTransform } from '@/lib/nodes/types';
import CompositorEditorModal from '@/components/compositor/CompositorEditorModal';
import ImageLightbox from '@/components/ui/ImageLightbox';
import { toLegacyRenderableOutput } from '@/lib/workflow/result-format';

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

// 1. Memoized Preview Image WITH CACHE-BUSTING CORS FIX
const PreviewImage = memo(({ transform, imageUrl }: { transform: LayerTransform, imageUrl: string }) => {
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
            x={transform.x}
            y={transform.y}
            width={transform.width}
            height={transform.height}
            rotation={transform.rotation}
            opacity={transform.opacity}
            scaleX={transform.flipX ? -1 : 1}
            scaleY={transform.flipY ? -1 : 1}
            offsetX={transform.flipX ? transform.width : 0}
            offsetY={transform.flipY ? transform.height : 0}
            listening={false}
        />
    );
});

// 2. Memoized Preview Text
const PreviewText = memo(({ transform, text }: { transform: LayerTransform, text: string }) => {
    return (
        <KonvaText
            text={text}
            x={transform.x}
            y={transform.y}
            width={transform.width}
            height={transform.height}
            rotation={transform.rotation}
            opacity={transform.opacity}
            scaleX={transform.flipX ? -1 : 1}
            scaleY={transform.flipY ? -1 : 1}
            offsetX={transform.flipX ? transform.width : 0}
            offsetY={transform.flipY ? transform.height : 0}
            fontSize={48}
            fill="#ffffff"
            fontStyle="bold"
            align="center"
            verticalAlign="middle"
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

// 3. Dynamic Auto-Scaling Live Preview
function LivePreview({
    config,
    activeLayers,
    stageRef,
    isDraggingGlobal
}: {
    config: CompositorConfig;
    activeLayers: Array<{ transform: LayerTransform, data: any, id: string, visible: boolean }>;
    stageRef: React.RefObject<any>;
    isDraggingGlobal: boolean;
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
            {/* Optimization: Hide Konva stage during global drags to improve performance */}
            {!isDraggingGlobal && scale > 0 && (
                <Stage
                    ref={stageRef}
                    width={size.width}
                    height={size.height}
                >
                    <Layer>
                        <Group scaleX={scale} scaleY={scale}>
                            {activeLayers.map((layer) => {
                                if (!layer.visible || !layer.data) return null;
                                const data = layer.data;

                                if (data.url) {
                                    return (
                                        <PreviewImage
                                            key={layer.id}
                                            transform={layer.transform}
                                            imageUrl={data.url}
                                        />
                                    );
                                }

                                if (typeof data === 'string') {
                                    return (
                                        <PreviewText
                                            key={layer.id}
                                            transform={layer.transform}
                                            text={data}
                                        />
                                    );
                                }

                                return null;
                            })}
                        </Group>
                    </Layer>
                </Stage>
            )}
            
            {/* Low-Fi Placeholder during dragging */}
            {isDraggingGlobal && (
                <div className="flex flex-col items-center justify-center gap-2 opacity-20 scale-75">
                   <Plus className="w-12 h-12" />
                </div>
            )}
        </div>
    );
}

function CompositorNode({ data, id, selected }: NodeProps<CompositorNodeData>) {
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const stageRef = useRef<any>(null);

    const isDraggingGlobal = useAppStore((state) => state.isDragging);
    const updateNodeConfig = useAppStore((state) => state.updateNodeConfig);
    
    // Performance: Ultra-selective subscriptions
    const layerEdges = useAppStore(useShallow((state) => 
        state.currentWorkflow?.edges?.filter(e => e.target === id && (e.targetHandle === 'layers' || !e.targetHandle)) || []
    ));

    const nodeOutputs = useAppStore(useShallow((state) => {
        const outputs: Record<string, any> = {};
        layerEdges.forEach(e => {
            if (state.nodeOutputs[e.source]) {
                outputs[e.source] = state.nodeOutputs[e.source];
            }
        });
        return outputs;
    }));

    const config: CompositorConfig = useMemo(() => ({
        ...defaultConfig,
        ...data.config,
        layers: data.config?.layers || defaultConfig.layers,
    }), [data.config]);

    // Derived layers: merge saved layers with current edges
    const activeLayers = useMemo(() => {
        const savedLayers = config.layers || [];
        const canvasW = config.canvasWidth || 1920;
        const canvasH = config.canvasHeight || 1080;
        
        return layerEdges.map((edge) => {
            const sourceOutput = nodeOutputs[edge.source];
            let displayData = null;
            if (sourceOutput) {
                const normalized = toLegacyRenderableOutput(sourceOutput);
                displayData = Array.isArray(normalized) ? normalized[0] : normalized;
            }

            const savedLayer = savedLayers.find(l => l.sourceHandleId === edge.id);
            
            // Default transform logic: center if new, otherwise use saved
            let transform = savedLayer?.transform;
            if (!transform) {
                // If it's an image and we have resolution, use it to center
                if (displayData?.resolution) {
                    transform = calculateInitialTransform(
                        displayData.resolution.width,
                        displayData.resolution.height,
                        canvasW,
                        canvasH
                    );
                } else {
                    // Fallback to simple center - NOT marked as auto-centered to allow editor to re-center
                    transform = {
                        x: (canvasW - 400) / 2,
                        y: (canvasH - 300) / 2,
                        width: 400,
                        height: 300,
                        rotation: 0,
                        opacity: 1,
                        flipX: false,
                        flipY: false,
                        isAutoCentered: false,
                        crop: null,
                    };
                }
            }
            
            return {
                id: edge.id,
                visible: savedLayer ? savedLayer.visible : true,
                transform,
                data: displayData,
            };
        });
    }, [layerEdges, nodeOutputs, config.layers, config.canvasWidth, config.canvasHeight]);

    // DIRECT STORE UPDATE (Much more stable than React Flow update)
    const updateConfig = useCallback((newConfig: Partial<CompositorConfig>) => {
        updateNodeConfig(id, newConfig);
    }, [id, updateNodeConfig]);

    const openEditor = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsEditorOpen(true);
    };

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
                badgeCount={activeLayers.length}
                width={320}
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
                    {activeLayers.length > 0 ? (
                        <div className="w-full p-1">
                            <LivePreview
                                config={config}
                                activeLayers={activeLayers}
                                stageRef={stageRef}
                                isDraggingGlobal={isDraggingGlobal}
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
