'use client';

import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Canvas, FabricImage, Rect } from 'fabric';
import {
    X, Eye, EyeOff, Lock, Unlock, Trash2, Layers2, ChevronUp, ChevronDown,
    RotateCcw, FlipHorizontal, FlipVertical, ChevronLeft, ChevronRight, Plus, Crop,
    Monitor, Smartphone, Square, ZoomIn, ZoomOut, Maximize2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import { CompositorConfig, CompositorLayer, LayerTransform, ImageObject } from '@/lib/nodes/types';

const LAYER_COLORS = [
    '#22c55e', '#f59e0b', '#3b82f6', '#ec4889',
    '#8b5cf6', '#06b6d4', '#f97316', '#84cc16',
];

const DEFAULT_TRANSFORM: LayerTransform = {
    x: 100,
    y: 100,
    width: 300,
    height: 200,
    rotation: 0,
    opacity: 1,
    flipX: false,
    flipY: false,
};

const IMAGES_PER_PAGE = 6;

// Canvas size presets
const CANVAS_PRESETS = [
    { label: 'Full HD', width: 1920, height: 1080, icon: Monitor },
    { label: 'HD', width: 1280, height: 720, icon: Monitor },
    { label: 'SVGA', width: 800, height: 600, icon: Smartphone },
    { label: 'Square', width: 1080, height: 1080, icon: Square },
];

// Fixed Fabric canvas size for the editor viewport
const FABRIC_WIDTH = 800;

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
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fabricRef = useRef<Canvas | null>(null);
    const [selectedLayerIndex, setSelectedLayerIndex] = useState<number | null>(null);
    const [localLayers, setLocalLayers] = useState<CompositorLayer[]>(config.layers);
    const [localCanvasWidth, setLocalCanvasWidth] = useState(config.canvasWidth || 1920);
    const [localCanvasHeight, setLocalCanvasHeight] = useState(config.canvasHeight || 1080);
    const [imagePageIndex, setImagePageIndex] = useState(0);
    const [canvasReady, setCanvasReady] = useState(false);
    const [showCanvasPresets, setShowCanvasPresets] = useState(false);
    const isLoadingRef = useRef(false);

    // Infinite Stage: pan/zoom state
    const [stageZoom, setStageZoom] = useState(1);
    const [stagePan, setStagePan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [spaceHeld, setSpaceHeld] = useState(false);
    const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
    const stageContainerRef = useRef<HTMLDivElement>(null);

    // Fixed scale: Fabric pixels → canvas-absolute pixels
    // This NEVER changes based on layer positions, only on canvas dimensions.
    const scale = FABRIC_WIDTH / localCanvasWidth;
    const fabricHeight = Math.round(localCanvasHeight * scale);
    const scaleRef = useRef(scale);
    scaleRef.current = scale;

    // Get connected inputs
    const currentWorkflow = useAppStore((state) => state.currentWorkflow);
    const nodeOutputs = useAppStore((state) => state.nodeOutputs);

    const connectedInputs = useMemo(() => {
        if (!currentWorkflow) return {};
        const edges = currentWorkflow.edges.filter(e => e.target === nodeId);
        const inputs: Record<string, ImageObject[]> = {};

        edges.forEach(edge => {
            const handleId = (edge as any).targetHandle || 'default';
            const sourceOutput = nodeOutputs[edge.source];
            if (sourceOutput) {
                inputs[handleId] = Array.isArray(sourceOutput) ? sourceOutput : [sourceOutput];
            }
        });

        return inputs;
    }, [currentWorkflow, nodeId, nodeOutputs]);

    // Full canvas load function — uses fixed scale (no bounding box)
    const loadLayersToCanvas = useCallback(async (layers: CompositorLayer[]) => {
        const canvas = fabricRef.current;
        if (!canvas || isLoadingRef.current) return;

        isLoadingRef.current = true;
        const prevSelected = selectedLayerIndex;
        const s = scaleRef.current;

        canvas.clear();
        canvas.backgroundColor = '#1a1a1a';

        // Resize Fabric canvas to match aspect ratio
        const fh = Math.round(localCanvasHeight * s);
        canvas.setDimensions({ width: FABRIC_WIDTH, height: fh });

        for (let i = 0; i < layers.length; i++) {
            const layer = layers[i];
            if (!layer.visible) continue;

            const sourceImages = connectedInputs[layer.sourceHandleId];

            if (!sourceImages || sourceImages.length === 0) {
                // Placeholder rectangle for unconnected layers
                const rect = new Rect({
                    left: layer.transform.x * s,
                    top: layer.transform.y * s,
                    width: layer.transform.width * s,
                    height: layer.transform.height * s,
                    fill: LAYER_COLORS[i % LAYER_COLORS.length] + '40',
                    stroke: LAYER_COLORS[i % LAYER_COLORS.length],
                    strokeWidth: 2,
                    strokeDashArray: [5, 5],
                    angle: layer.transform.rotation,
                    opacity: layer.transform.opacity,
                    selectable: !layer.locked,
                    hasControls: !layer.locked,
                });
                (rect as any).layerIndex = i;
                canvas.add(rect);
                continue;
            }

            const imageData = sourceImages[layer.selectedIndex] || sourceImages[0];
            if (!imageData?.url) continue;

            try {
                const img = await FabricImage.fromURL(imageData.url, { crossOrigin: 'anonymous' });
                if (!img) continue;

                // Scale: canvas-absolute → Fabric pixels
                const imgScaleX = (layer.transform.width * s) / (img.width || 1);
                const imgScaleY = (layer.transform.height * s) / (img.height || 1);

                img.set({
                    left: layer.transform.x * s,
                    top: layer.transform.y * s,
                    scaleX: imgScaleX,
                    scaleY: imgScaleY,
                    flipX: layer.transform.flipX,
                    flipY: layer.transform.flipY,
                    angle: layer.transform.rotation,
                    opacity: layer.transform.opacity,
                    selectable: !layer.locked,
                    hasControls: !layer.locked,
                    originX: 'left',
                    originY: 'top',
                });

                (img as any).layerIndex = i;
                canvas.add(img);
            } catch (error) {
                console.error('Failed to load image for layer', i, error);
            }
        }

        canvas.renderAll();

        // Restore selection
        if (prevSelected !== null) {
            const obj = canvas.getObjects().find((o) => (o as any).layerIndex === prevSelected);
            if (obj) {
                canvas.setActiveObject(obj);
                canvas.renderAll();
            }
        }

        isLoadingRef.current = false;
    }, [connectedInputs, selectedLayerIndex, localCanvasHeight]);

    // Initialize canvas once
    useEffect(() => {
        if (!canvasRef.current || fabricRef.current) return;

        const fh = Math.round(localCanvasHeight * scale);

        const canvas = new Canvas(canvasRef.current, {
            width: FABRIC_WIDTH,
            height: fh,
            backgroundColor: '#1a1a1a',
            selection: true,
            preserveObjectStacking: true,
        });

        fabricRef.current = canvas;

        // Handle selection events
        canvas.on('selection:created', (e) => {
            const obj = e.selected?.[0];
            if (obj) {
                const idx = (obj as any).layerIndex;
                if (idx !== undefined) {
                    setSelectedLayerIndex(idx);
                    setImagePageIndex(0);
                }
            }
        });

        canvas.on('selection:updated', (e) => {
            const obj = e.selected?.[0];
            if (obj) {
                const idx = (obj as any).layerIndex;
                if (idx !== undefined) {
                    setSelectedLayerIndex(idx);
                    setImagePageIndex(0);
                }
            }
        });

        canvas.on('selection:cleared', () => {
            setSelectedLayerIndex(null);
        });

        // Update local layer state on object modification
        // Convert Fabric coords → canvas-absolute coords using fixed scale
        // Sync layer transforms on any object change (move, resize, rotate)
        const syncObjectToState = (obj: any) => {
            if (!obj) return;

            const idx = obj.layerIndex;
            if (idx === undefined) return;

            const s = scaleRef.current;

            setLocalLayers(prev => {
                const newLayers = [...prev];
                if (newLayers[idx]) {
                    const width = (obj.width || 100) * Math.abs(obj.scaleX || 1) / s;
                    const height = (obj.height || 100) * Math.abs(obj.scaleY || 1) / s;
                    const x = (obj.left || 0) / s;
                    const y = (obj.top || 0) / s;

                    newLayers[idx] = {
                        ...newLayers[idx],
                        transform: {
                            ...newLayers[idx].transform,
                            x,
                            y,
                            width,
                            height,
                            rotation: obj.angle || 0,
                        },
                    };
                }
                return newLayers;
            });
        };

        canvas.on('object:modified', (e) => {
            syncObjectToState(e.target);
        });

        // Also sync during scaling for live property panel updates
        canvas.on('object:scaling', (e) => {
            syncObjectToState(e.target);
        });

        // Mark canvas as ready
        setCanvasReady(true);

        return () => {
            canvas.dispose();
            fabricRef.current = null;
        };
    }, []);

    // Reload canvas when structure changes or connectedInputs change or canvas becomes ready
    const structureKey = localLayers.map(l => `${l.id}-${l.visible}-${l.locked}`).join('|');
    const inputsKey = JSON.stringify(Object.keys(connectedInputs));

    useEffect(() => {
        if (!fabricRef.current || !canvasReady) return;
        loadLayersToCanvas(localLayers);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [structureKey, inputsKey, canvasReady, localCanvasWidth, localCanvasHeight]);

    // Save to config on Done
    const handleDone = useCallback(() => {
        onConfigChange({
            layers: localLayers,
            canvasWidth: localCanvasWidth,
            canvasHeight: localCanvasHeight,
        });
        onClose();
    }, [localLayers, localCanvasWidth, localCanvasHeight, onConfigChange, onClose]);

    // Canvas size change
    const changeCanvasSize = useCallback((width: number, height: number) => {
        setLocalCanvasWidth(width);
        setLocalCanvasHeight(height);
        setShowCanvasPresets(false);
    }, []);

    // ============ INFINITE STAGE: PAN / ZOOM ============

    // Fit canvas to viewport
    const fitToView = useCallback(() => {
        const container = stageContainerRef.current;
        if (!container) return;
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const padding = 40;
        const zoomX = (cw - padding * 2) / FABRIC_WIDTH;
        const zoomY = (ch - padding * 2) / fabricHeight;
        const zoom = Math.min(zoomX, zoomY, 1); // don't exceed 1x
        const panX = (cw - FABRIC_WIDTH * zoom) / 2;
        const panY = (ch - fabricHeight * zoom) / 2;
        setStageZoom(zoom);
        setStagePan({ x: panX, y: panY });
    }, [fabricHeight]);

    // Auto-fit when canvas becomes ready or canvas size changes
    useEffect(() => {
        if (canvasReady) fitToView();
    }, [canvasReady, fitToView]);

    // Scroll-to-zoom toward cursor
    const handleStageWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        const container = stageContainerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
        const newZoom = Math.min(Math.max(stageZoom * zoomFactor, 0.1), 5);

        // Adjust pan so the point under the cursor stays fixed
        const scale = newZoom / stageZoom;
        const newPanX = mouseX - scale * (mouseX - stagePan.x);
        const newPanY = mouseY - scale * (mouseY - stagePan.y);

        setStageZoom(newZoom);
        setStagePan({ x: newPanX, y: newPanY });
    }, [stageZoom, stagePan]);

    // Spacebar panning
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.code === 'Space' && !e.repeat) {
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

    const handleStageMouseDown = useCallback((e: React.MouseEvent) => {
        if (spaceHeld || e.button === 1) { // space+click or middle-click
            e.preventDefault();
            setIsPanning(true);
            panStartRef.current = { x: e.clientX, y: e.clientY, panX: stagePan.x, panY: stagePan.y };
        }
    }, [spaceHeld, stagePan]);

    const handleStageMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isPanning) return;
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        setStagePan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy });
    }, [isPanning]);

    const handleStageMouseUp = useCallback(() => {
        setIsPanning(false);
    }, []);

    // Disable Fabric interaction while panning
    useEffect(() => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        canvas.selection = !spaceHeld;
        canvas.forEachObject(obj => { obj.evented = !spaceHeld; });
    }, [spaceHeld]);

    // ============ LAYER OPERATIONS ============

    const addLayer = useCallback(() => {
        const newLayerIndex = localLayers.length;
        const newLayer: CompositorLayer = {
            id: `layer_${Date.now()}`,
            name: `Layer ${newLayerIndex + 1}`,
            sourceHandleId: `layer_${newLayerIndex}`,
            selectedIndex: 0,
            transform: { ...DEFAULT_TRANSFORM, x: 50 + newLayerIndex * 50, y: 50 + newLayerIndex * 50 },
            visible: true,
            locked: false,
        };
        setLocalLayers(prev => [...prev, newLayer]);
    }, [localLayers.length]);

    const removeLayer = useCallback((index: number) => {
        setLocalLayers(prev => prev.filter((_, i) => i !== index));
        setSelectedLayerIndex(null);
    }, []);

    const toggleVisibility = useCallback((index: number) => {
        setLocalLayers(prev => {
            const newLayers = [...prev];
            newLayers[index] = { ...newLayers[index], visible: !newLayers[index].visible };
            return newLayers;
        });
    }, []);

    const toggleLock = useCallback((index: number) => {
        setLocalLayers(prev => {
            const newLayers = [...prev];
            newLayers[index] = { ...newLayers[index], locked: !newLayers[index].locked };
            return newLayers;
        });
    }, []);

    const moveLayerUp = useCallback((index: number) => {
        if (index <= 0) return;
        setLocalLayers(prev => {
            const newLayers = [...prev];
            [newLayers[index - 1], newLayers[index]] = [newLayers[index], newLayers[index - 1]];
            return newLayers;
        });
    }, []);

    const moveLayerDown = useCallback((index: number) => {
        setLocalLayers(prev => {
            if (index >= prev.length - 1) return prev;
            const newLayers = [...prev];
            [newLayers[index], newLayers[index + 1]] = [newLayers[index + 1], newLayers[index]];
            return newLayers;
        });
    }, []);

    // Update selected image index
    const updateSelectedIndex = useCallback(async (layerIndex: number, newIdx: number) => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        const layer = localLayers[layerIndex];
        if (!layer) return;

        const sourceImages = connectedInputs[layer.sourceHandleId] || [];
        if (sourceImages.length === 0) return;

        const maxIndex = Math.max(0, sourceImages.length - 1);
        const clampedIdx = Math.max(0, Math.min(newIdx, maxIndex));
        const newImage = sourceImages[clampedIdx];
        if (!newImage?.url) return;

        const oldObj = canvas.getObjects().find((o) => (o as any).layerIndex === layerIndex);
        if (!oldObj) return;

        try {
            const img = await FabricImage.fromURL(newImage.url, { crossOrigin: 'anonymous' });
            if (!img) return;

            const s = scaleRef.current;
            const imgScaleX = (layer.transform.width * s) / (img.width || 1);
            const imgScaleY = (layer.transform.height * s) / (img.height || 1);

            img.set({
                left: layer.transform.x * s,
                top: layer.transform.y * s,
                scaleX: imgScaleX,
                scaleY: imgScaleY,
                flipX: layer.transform.flipX,
                flipY: layer.transform.flipY,
                angle: layer.transform.rotation,
                opacity: layer.transform.opacity,
                selectable: !layer.locked,
                hasControls: !layer.locked,
                originX: 'left',
                originY: 'top',
            });

            (img as any).layerIndex = layerIndex;

            const objIndex = canvas.getObjects().indexOf(oldObj);
            const wasSelected = canvas.getActiveObject() === oldObj;
            canvas.remove(oldObj);
            canvas.insertAt(objIndex, img);

            if (wasSelected) {
                canvas.setActiveObject(img);
            }

            canvas.renderAll();

            setLocalLayers(prev => {
                const newLayers = [...prev];
                newLayers[layerIndex] = {
                    ...newLayers[layerIndex],
                    selectedIndex: clampedIdx,
                };
                return newLayers;
            });
        } catch (error) {
            console.error('Failed to swap image', error);
        }
    }, [connectedInputs, localLayers]);

    // Update transform with LIVE canvas update
    const updateTransform = useCallback((layerIndex: number, updates: Partial<LayerTransform>) => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        const obj = canvas.getObjects().find((o) => (o as any).layerIndex === layerIndex);
        if (!obj) return;

        const s = scaleRef.current;
        const layer = localLayers[layerIndex];
        if (!layer) return;

        // Apply position updates LIVE on canvas (canvas-absolute → Fabric)
        if (updates.x !== undefined) obj.set('left', updates.x * s);
        if (updates.y !== undefined) obj.set('top', updates.y * s);
        if (updates.rotation !== undefined) obj.set('angle', updates.rotation);
        if (updates.opacity !== undefined) obj.set('opacity', updates.opacity);

        if (updates.width !== undefined || updates.height !== undefined || updates.flipX !== undefined || updates.flipY !== undefined) {
            const newWidth = updates.width ?? layer.transform.width;
            const newHeight = updates.height ?? layer.transform.height;
            const newFlipX = updates.flipX ?? layer.transform.flipX;
            const newFlipY = updates.flipY ?? layer.transform.flipY;

            const baseScaleX = (newWidth * s) / (obj.width || 1);
            const baseScaleY = (newHeight * s) / (obj.height || 1);

            obj.set('scaleX', newFlipX ? -baseScaleX : baseScaleX);
            obj.set('scaleY', newFlipY ? -baseScaleY : baseScaleY);
        }

        canvas.renderAll();

        setLocalLayers(prev => {
            const newLayers = [...prev];
            newLayers[layerIndex] = {
                ...newLayers[layerIndex],
                transform: { ...newLayers[layerIndex].transform, ...updates },
            };
            return newLayers;
        });
    }, [localLayers]);

    // Toggle flip
    const toggleFlip = useCallback((layerIndex: number, axis: 'flipX' | 'flipY') => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        const obj = canvas.getObjects().find((o) => (o as any).layerIndex === layerIndex);
        if (!obj) return;

        setLocalLayers(prev => {
            const layer = prev[layerIndex];
            if (!layer) return prev;

            const newFlipX = axis === 'flipX' ? !layer.transform.flipX : layer.transform.flipX;
            const newFlipY = axis === 'flipY' ? !layer.transform.flipY : layer.transform.flipY;

            obj.set('flipX', newFlipX);
            obj.set('flipY', newFlipY);
            canvas.renderAll();

            const newLayers = [...prev];
            newLayers[layerIndex] = {
                ...layer,
                transform: { ...layer.transform, flipX: newFlipX, flipY: newFlipY },
            };
            return newLayers;
        });
    }, []);

    const resetTransform = useCallback((layerIndex: number) => {
        updateTransform(layerIndex, DEFAULT_TRANSFORM);
    }, [updateTransform]);

    const selectOnCanvas = useCallback((index: number) => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        const obj = canvas.getObjects().find((o) => (o as any).layerIndex === index);
        if (obj) {
            canvas.setActiveObject(obj);
            canvas.renderAll();
        }
        setSelectedLayerIndex(index);
        setImagePageIndex(0);
    }, []);

    const selectedLayer = selectedLayerIndex !== null ? localLayers[selectedLayerIndex] : null;
    const selectedSourceImages = selectedLayer ? connectedInputs[selectedLayer.sourceHandleId] || [] : [];

    const totalPages = Math.ceil(selectedSourceImages.length / IMAGES_PER_PAGE);
    const showPagination = selectedSourceImages.length > IMAGES_PER_PAGE;
    const visibleImages = selectedSourceImages.slice(
        imagePageIndex * IMAGES_PER_PAGE,
        (imagePageIndex + 1) * IMAGES_PER_PAGE
    );

    return (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
            <div className="bg-surface-primary rounded-xl shadow-2xl w-[90vw] h-[85vh] max-w-6xl flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-stroke-subtle">
                    <div className="flex items-center gap-2">
                        <Layers2 className="w-5 h-5 text-accent-primary" />
                        <span className="font-semibold text-content-primary">Compositor Editor</span>

                        {/* Canvas size selector */}
                        <div className="relative ml-2">
                            <button
                                onClick={() => setShowCanvasPresets(!showCanvasPresets)}
                                className="text-xs text-content-tertiary hover:text-content-secondary px-2 py-1 rounded border border-stroke-subtle hover:border-stroke-default transition-colors"
                            >
                                {localCanvasWidth} × {localCanvasHeight}
                            </button>

                            {showCanvasPresets && (
                                <div className="absolute top-full left-0 mt-1 bg-surface-elevated border border-stroke-subtle rounded-lg shadow-xl z-10 py-1 min-w-[180px]">
                                    {CANVAS_PRESETS.map((preset) => {
                                        const Icon = preset.icon;
                                        const isActive = localCanvasWidth === preset.width && localCanvasHeight === preset.height;
                                        return (
                                            <button
                                                key={preset.label}
                                                onClick={() => changeCanvasSize(preset.width, preset.height)}
                                                className={cn(
                                                    "w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-surface-tertiary",
                                                    isActive && "text-accent-primary font-medium"
                                                )}
                                            >
                                                <Icon className="w-3.5 h-3.5" />
                                                <span>{preset.label}</span>
                                                <span className="ml-auto text-content-tertiary">{preset.width}×{preset.height}</span>
                                            </button>
                                        );
                                    })}
                                    <div className="border-t border-stroke-subtle mt-1 pt-1 px-3 py-1.5">
                                        <div className="text-[10px] text-content-tertiary mb-1">Custom</div>
                                        <div className="flex items-center gap-1">
                                            <input
                                                type="number"
                                                value={localCanvasWidth}
                                                onChange={(e) => setLocalCanvasWidth(Math.max(100, Number(e.target.value)))}
                                                className="w-16 px-1.5 py-0.5 text-xs bg-surface-tertiary border border-stroke-subtle rounded"
                                                min={100}
                                            />
                                            <span className="text-xs text-content-tertiary">×</span>
                                            <input
                                                type="number"
                                                value={localCanvasHeight}
                                                onChange={(e) => setLocalCanvasHeight(Math.max(100, Number(e.target.value)))}
                                                className="w-16 px-1.5 py-0.5 text-xs bg-surface-tertiary border border-stroke-subtle rounded"
                                                min={100}
                                            />
                                            <button
                                                onClick={() => setShowCanvasPresets(false)}
                                                className="px-2 py-0.5 text-xs bg-accent-primary text-content-inverted rounded"
                                            >
                                                Set
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-tertiary">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Main Content */}
                <div className="flex-1 flex overflow-hidden">
                    {/* Left Panel - Layers */}
                    <div className="w-52 border-r border-stroke-subtle flex flex-col">
                        <div className="p-2 border-b border-stroke-subtle flex items-center justify-between">
                            <span className="text-xs font-medium text-content-secondary">Layers</span>
                            <button onClick={addLayer} className="p-1 rounded hover:bg-surface-tertiary">
                                <Plus className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-2 space-y-1">
                            {localLayers.map((layer, index) => (
                                <div
                                    key={layer.id}
                                    onClick={() => selectOnCanvas(index)}
                                    className={cn(
                                        "p-2 rounded-lg border cursor-pointer",
                                        selectedLayerIndex === index
                                            ? "bg-accent-primary/10 border-accent-primary"
                                            : "bg-surface-secondary border-stroke-subtle hover:border-stroke-default"
                                    )}
                                >
                                    <div className="flex items-center gap-2">
                                        <div
                                            className="w-2.5 h-2.5 rounded-sm"
                                            style={{ backgroundColor: LAYER_COLORS[index % LAYER_COLORS.length] }}
                                        />
                                        <span className="flex-1 text-xs font-medium truncate">{layer.name}</span>
                                        <button onClick={(e) => { e.stopPropagation(); toggleVisibility(index); }} className="p-0.5">
                                            {layer.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 opacity-50" />}
                                        </button>
                                        <button onClick={(e) => { e.stopPropagation(); toggleLock(index); }} className="p-0.5">
                                            {layer.locked ? <Lock className="w-3 h-3 text-amber-500" /> : <Unlock className="w-3 h-3 opacity-50" />}
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-1 mt-1">
                                        <button onClick={(e) => { e.stopPropagation(); moveLayerUp(index); }} disabled={index === 0} className="p-0.5 disabled:opacity-30">
                                            <ChevronUp className="w-3 h-3" />
                                        </button>
                                        <button onClick={(e) => { e.stopPropagation(); moveLayerDown(index); }} disabled={index === localLayers.length - 1} className="p-0.5 disabled:opacity-30">
                                            <ChevronDown className="w-3 h-3" />
                                        </button>
                                        <div className="flex-1" />
                                        <button onClick={(e) => { e.stopPropagation(); removeLayer(index); }} className="p-0.5 hover:text-accent-error">
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {localLayers.length === 0 && (
                                <div className="text-center py-6 text-xs text-content-tertiary">
                                    No layers. Click + to add.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Center - Infinite Stage */}
                    <div
                        ref={stageContainerRef}
                        className="flex-1 relative bg-neutral-900 select-none"
                        style={{ overflow: 'hidden', cursor: spaceHeld ? (isPanning ? 'grabbing' : 'grab') : 'default' }}
                        onWheel={handleStageWheel}
                        onMouseDown={(e) => {
                            handleStageMouseDown(e);
                            // Click on dark background = deselect (only if not panning)
                            if (!spaceHeld && e.target === e.currentTarget) {
                                fabricRef.current?.discardActiveObject();
                                fabricRef.current?.renderAll();
                                setSelectedLayerIndex(null);
                            }
                        }}
                        onMouseMove={handleStageMouseMove}
                        onMouseUp={handleStageMouseUp}
                        onMouseLeave={handleStageMouseUp}
                    >
                        {/* Transform wrapper — applies pan & zoom */}
                        <div
                            style={{
                                transform: `translate(${stagePan.x}px, ${stagePan.y}px) scale(${stageZoom})`,
                                transformOrigin: '0 0',
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                pointerEvents: spaceHeld ? 'none' : 'auto',
                            }}
                        >
                            {/* Checkerboard background behind canvas to show transparency */}
                            <div
                                className="shadow-2xl border border-white/10 rounded-lg"
                                style={{
                                    width: FABRIC_WIDTH,
                                    height: fabricHeight,
                                    backgroundImage: `
                                        linear-gradient(45deg, #2a2a2a 25%, transparent 25%),
                                        linear-gradient(-45deg, #2a2a2a 25%, transparent 25%),
                                        linear-gradient(45deg, transparent 75%, #2a2a2a 75%),
                                        linear-gradient(-45deg, transparent 75%, #2a2a2a 75%)
                                    `,
                                    backgroundSize: '20px 20px',
                                    backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
                                    backgroundColor: '#222',
                                }}
                                onMouseDown={(e) => {
                                    if (!spaceHeld && e.target === e.currentTarget) {
                                        fabricRef.current?.discardActiveObject();
                                        fabricRef.current?.renderAll();
                                        setSelectedLayerIndex(null);
                                    }
                                }}
                            >
                                <canvas ref={canvasRef} />
                            </div>
                        </div>

                        {/* Zoom Controls — floating top-right */}
                        <div className="absolute top-3 right-3 flex items-center gap-1 bg-surface-primary/80 backdrop-blur-sm rounded-lg border border-stroke-subtle px-1 py-0.5 z-10">
                            <button
                                onClick={() => {
                                    const newZoom = Math.max(stageZoom * 0.8, 0.1);
                                    // Zoom toward center
                                    const container = stageContainerRef.current;
                                    if (container) {
                                        const cx = container.clientWidth / 2;
                                        const cy = container.clientHeight / 2;
                                        const s = newZoom / stageZoom;
                                        setStagePan({ x: cx - s * (cx - stagePan.x), y: cy - s * (cy - stagePan.y) });
                                    }
                                    setStageZoom(newZoom);
                                }}
                                className="p-1 rounded hover:bg-surface-tertiary transition-colors"
                                title="Zoom out"
                            >
                                <ZoomOut className="w-3.5 h-3.5 text-content-secondary" />
                            </button>
                            <span className="text-[10px] font-medium text-content-secondary min-w-[36px] text-center">
                                {Math.round(stageZoom * 100)}%
                            </span>
                            <button
                                onClick={() => {
                                    const newZoom = Math.min(stageZoom * 1.25, 5);
                                    const container = stageContainerRef.current;
                                    if (container) {
                                        const cx = container.clientWidth / 2;
                                        const cy = container.clientHeight / 2;
                                        const s = newZoom / stageZoom;
                                        setStagePan({ x: cx - s * (cx - stagePan.x), y: cy - s * (cy - stagePan.y) });
                                    }
                                    setStageZoom(newZoom);
                                }}
                                className="p-1 rounded hover:bg-surface-tertiary transition-colors"
                                title="Zoom in"
                            >
                                <ZoomIn className="w-3.5 h-3.5 text-content-secondary" />
                            </button>
                            <div className="w-px h-4 bg-stroke-subtle mx-0.5" />
                            <button
                                onClick={fitToView}
                                className="p-1 rounded hover:bg-surface-tertiary transition-colors"
                                title="Fit to view"
                            >
                                <Maximize2 className="w-3.5 h-3.5 text-content-secondary" />
                            </button>
                        </div>
                    </div>

                    {/* Right Panel - Properties */}
                    <div className="w-60 border-l border-stroke-subtle flex flex-col">
                        <div className="p-2 border-b border-stroke-subtle">
                            <span className="text-xs font-medium text-content-secondary">Properties</span>
                        </div>

                        {selectedLayer ? (
                            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                                {/* Image Selector with Pagination */}
                                {selectedSourceImages.length > 1 && (
                                    <div className="space-y-1">
                                        <label className="text-xs text-content-secondary">
                                            Source ({selectedLayer.selectedIndex + 1}/{selectedSourceImages.length})
                                        </label>

                                        <div className="space-y-1">
                                            <div className="grid grid-cols-3 gap-1">
                                                {visibleImages.map((img, idx) => {
                                                    const actualIdx = imagePageIndex * IMAGES_PER_PAGE + idx;
                                                    return (
                                                        <button
                                                            key={actualIdx}
                                                            onClick={() => updateSelectedIndex(selectedLayerIndex!, actualIdx)}
                                                            className={cn(
                                                                "aspect-square rounded border overflow-hidden",
                                                                selectedLayer.selectedIndex === actualIdx
                                                                    ? "border-accent-primary border-2"
                                                                    : "border-stroke-subtle hover:border-stroke-default"
                                                            )}
                                                        >
                                                            <img src={img.url} alt="" className="w-full h-full object-cover" />
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            {showPagination && (
                                                <div className="flex items-center justify-between pt-1">
                                                    <button
                                                        onClick={() => setImagePageIndex(p => Math.max(0, p - 1))}
                                                        disabled={imagePageIndex === 0}
                                                        className="p-1 rounded hover:bg-surface-tertiary disabled:opacity-30"
                                                    >
                                                        <ChevronLeft className="w-4 h-4" />
                                                    </button>
                                                    <span className="text-[10px] text-content-tertiary">
                                                        {imagePageIndex + 1} / {totalPages}
                                                    </span>
                                                    <button
                                                        onClick={() => setImagePageIndex(p => Math.min(totalPages - 1, p + 1))}
                                                        disabled={imagePageIndex >= totalPages - 1}
                                                        className="p-1 rounded hover:bg-surface-tertiary disabled:opacity-30"
                                                    >
                                                        <ChevronRight className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <label className="text-xs text-content-secondary">Position & Size</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="text-[10px] text-content-tertiary">X</label>
                                            <input type="number" value={Math.round(selectedLayer.transform.x)} onChange={(e) => updateTransform(selectedLayerIndex!, { x: Number(e.target.value) })} className="w-full px-2 py-1 text-xs bg-surface-tertiary border border-stroke-subtle rounded" />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-content-tertiary">Y</label>
                                            <input type="number" value={Math.round(selectedLayer.transform.y)} onChange={(e) => updateTransform(selectedLayerIndex!, { y: Number(e.target.value) })} className="w-full px-2 py-1 text-xs bg-surface-tertiary border border-stroke-subtle rounded" />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-content-tertiary">W</label>
                                            <input type="number" value={Math.round(selectedLayer.transform.width)} onChange={(e) => updateTransform(selectedLayerIndex!, { width: Number(e.target.value) })} className="w-full px-2 py-1 text-xs bg-surface-tertiary border border-stroke-subtle rounded" />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-content-tertiary">H</label>
                                            <input type="number" value={Math.round(selectedLayer.transform.height)} onChange={(e) => updateTransform(selectedLayerIndex!, { height: Number(e.target.value) })} className="w-full px-2 py-1 text-xs bg-surface-tertiary border border-stroke-subtle rounded" />
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-xs text-content-secondary">Opacity: {Math.round(selectedLayer.transform.opacity * 100)}%</label>
                                    <input type="range" min="0" max="1" step="0.05" value={selectedLayer.transform.opacity} onChange={(e) => updateTransform(selectedLayerIndex!, { opacity: Number(e.target.value) })} className="w-full" />
                                </div>

                                <div className="flex gap-1">
                                    <button onClick={() => toggleFlip(selectedLayerIndex!, 'flipX')} className={cn("flex-1 p-1.5 rounded border text-xs", selectedLayer.transform.flipX ? "bg-accent-primary/10 border-accent-primary" : "border-stroke-subtle")}>
                                        <FlipHorizontal className="w-3.5 h-3.5 mx-auto" />
                                    </button>
                                    <button onClick={() => toggleFlip(selectedLayerIndex!, 'flipY')} className={cn("flex-1 p-1.5 rounded border text-xs", selectedLayer.transform.flipY ? "bg-accent-primary/10 border-accent-primary" : "border-stroke-subtle")}>
                                        <FlipVertical className="w-3.5 h-3.5 mx-auto" />
                                    </button>
                                    <button onClick={() => resetTransform(selectedLayerIndex!)} className="flex-1 p-1.5 rounded border border-stroke-subtle" title="Reset Transform">
                                        <RotateCcw className="w-3.5 h-3.5 mx-auto" />
                                    </button>
                                </div>

                                <div className="pt-2 border-t border-stroke-subtle">
                                    <button disabled className="w-full py-2 rounded border border-stroke-subtle text-xs text-content-tertiary flex items-center justify-center gap-1.5 opacity-50">
                                        <Crop className="w-3.5 h-3.5" />
                                        Crop (coming soon)
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex items-center justify-center text-xs text-content-tertiary p-4">
                                Select a layer
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-stroke-subtle">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg border border-stroke-subtle hover:bg-surface-tertiary">
                        Cancel
                    </button>
                    <button onClick={handleDone} className="px-4 py-2 rounded-lg bg-accent-primary text-content-inverted font-medium hover:bg-accent-primary/90">
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}
