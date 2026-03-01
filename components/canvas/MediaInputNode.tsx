'use client';

import React, { memo, useCallback, useRef, useState } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import { nodeMetadata } from '@/lib/nodes/metadata';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import { NodeHeader } from './NodeHeader';
import { LayoutGrid, Square, Check, Upload, Image as ImageIcon, Play, Copy, X, ImagePlus, Plus } from 'lucide-react';

interface MediaInputNodeData {
    label: string;
    config: {
        images: string[];
    };
}

function MediaInputNode({ data, id }: NodeProps<MediaInputNodeData>) {
    const metadata = nodeMetadata['media_input'];
    const [isDragOver, setIsDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const deleteNode = useAppStore((state) => state.deleteNode);
    const triggerRunFromNode = useAppStore((state) => state.triggerRunFromNode);
    const status = useAppStore((state) => state.nodeStatuses[id] || 'idle');

    const [previewMode, setPreviewMode] = useState<'single' | 'grid'>('single');
    const [activeImageIndex, setActiveImageIndex] = useState(0);

    const images = data.config?.images || [];

    // Node color with fallback to accent
    const nodeColor = metadata?.color || 'rgb(var(--accent-primary))';

    // Use React Flow hook for direct graph manipulation
    const { setNodes, deleteElements, addNodes, getNode } = useReactFlow();

    // Update node config with new images
    const updateImages = useCallback((newImages: string[]) => {
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === id) {
                    return {
                        ...node,
                        data: {
                            ...node.data,
                            config: {
                                ...node.data.config,
                                images: newImages,
                            },
                        },
                    };
                }
                return node;
            })
        );
    }, [id, setNodes]);

    // Handle file upload
    const handleFiles = useCallback((files: FileList | null) => {
        if (!files || files.length === 0) return;

        const newImages: string[] = [...images];

        Array.from(files).forEach((file) => {
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64 = reader.result as string;
                    newImages.push(base64);
                    updateImages([...newImages]);
                };
                reader.readAsDataURL(file);
            }
        });
    }, [images, updateImages]);

    // Handle file input change
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        handleFiles(e.target.files);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    // Handle drag and drop
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        handleFiles(e.dataTransfer.files);
    };

    // Remove an image
    const removeImage = (e: React.MouseEvent, index: number) => {
        e.stopPropagation();
        e.preventDefault();
        const newImages = images.filter((_, i) => i !== index);
        updateImages(newImages);
    };

    // Delete node
    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        deleteElements({ nodes: [{ id }] });
    };

    const handleDuplicate = (e: React.MouseEvent) => {
        e.stopPropagation();
        const currentNode = getNode(id);

        if (currentNode) {
            const newNode = {
                ...JSON.parse(JSON.stringify(currentNode)),
                id: `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                position: {
                    x: currentNode.position.x + 50,
                    y: currentNode.position.y + 50,
                },
                selected: false,
                data: {
                    ...currentNode.data,
                    label: `${currentNode.data.label} (Copy)`,
                }
            };
            addNodes(newNode);
        }
    };

    const handleRunFromHere = (e: React.MouseEvent) => {
        e.stopPropagation();
        triggerRunFromNode(id);
    };

    return (
        <div
            className={cn(
                "rounded-xl shadow-lg border-2 backdrop-blur-sm relative group bg-canvas-node",
                "transition-all duration-300 hover:shadow-2xl",
                "w-[280px]",
                isDragOver && "ring-2 ring-accent-primary ring-offset-2"
            )}
            style={{
                background: `linear-gradient(135deg, ${nodeColor}20 0%, ${nodeColor}40 100%)`,
                borderColor: nodeColor,
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* Action Buttons */}
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
                    onClick={handleDuplicate}
                    className="w-6 h-6 rounded-full bg-blue-500/90 hover:bg-blue-600 backdrop-blur-sm
                               flex items-center justify-center shadow-lg hover:scale-110 transition-all duration-200"
                    title="Duplicate node"
                >
                    <Copy className="w-3 h-3 text-content-inverted" />
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

            <NodeHeader
                icon="ImagePlus"
                label="Media Input"
                color={nodeColor}
                badgeCount={images.length}
            />

            {/* Content area matching standardized preview */}
            <div className="p-1 px-1.5 pb-2">
                <div
                    className={cn(
                        "relative w-full h-[160px] rounded-lg overflow-hidden border border-white/10 bg-[#0a0a0a] shadow-inner",
                        "transition-all duration-300"
                    )}
                    style={{
                        backgroundImage: 'repeating-conic-gradient(#1a1a1a 0% 25%, #050505 0% 50%)',
                        backgroundSize: '16px 16px',
                    }}
                >
                    {images.length === 0 ? (
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className={cn(
                                "absolute inset-0 flex flex-col items-center justify-center gap-1 transition-all",
                                "text-white/20 hover:text-accent-primary hover:bg-accent-primary/5",
                                isDragOver && "text-accent-primary bg-accent-primary/10"
                            )}
                        >
                            <Upload className="w-6 h-6" />
                            <span className="text-[10px] font-bold uppercase tracking-tighter">Upload</span>
                        </button>
                    ) : (
                        <>
                            {previewMode === 'single' ? (
                                <div className="w-full h-full group/preview relative">
                                    <img
                                        src={images[activeImageIndex]}
                                        alt=""
                                        className="w-full h-full object-contain"
                                    />
                                    <button
                                        onClick={(e) => removeImage(e, activeImageIndex)}
                                        className="absolute top-2 left-2 p-1 rounded bg-black/50 text-white opacity-0 group-hover/preview:opacity-100 transition-opacity"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            ) : (
                                <div className="w-full h-full p-2 overflow-y-auto custom-scrollbar">
                                    <div className="grid grid-cols-3 gap-1.5">
                                        {images.map((img, index) => (
                                            <button
                                                key={index}
                                                onClick={() => setActiveImageIndex(index)}
                                                className={cn(
                                                    "relative aspect-square rounded overflow-hidden border transition-all",
                                                    activeImageIndex === index ? "border-accent-primary ring-2 ring-accent-primary/20" : "border-white/5"
                                                )}
                                            >
                                                <img src={img} alt="" className="w-full h-full object-cover" />
                                                {activeImageIndex === index && (
                                                    <div className="absolute inset-0 bg-accent-primary/20 flex items-center justify-center">
                                                        <Check className="w-3 h-3 text-white" />
                                                    </div>
                                                )}
                                            </button>
                                        ))}
                                        <button
                                            onClick={() => fileInputRef.current?.click()}
                                            className="aspect-square rounded border border-dashed border-white/10 flex items-center justify-center text-white/20 hover:border-white/20 hover:text-white/40"
                                        >
                                            <Plus className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Controls */}
                            <div className="absolute bottom-2 right-2 flex bg-black/60 backdrop-blur-md rounded-lg p-0.5 border border-white/10 z-20 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={() => setPreviewMode('single')}
                                    className={cn("p-1.5 rounded-md", previewMode === 'single' ? "bg-accent-primary text-white" : "text-white/40")}
                                >
                                    <Square className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    onClick={() => setPreviewMode('grid')}
                                    className={cn("p-1.5 rounded-md", previewMode === 'grid' ? "bg-accent-primary text-white" : "text-white/40")}
                                >
                                    <LayoutGrid className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleInputChange}
                className="hidden"
            />

            {/* Output Handle - Right side only */}
            <Handle
                type="source"
                position={Position.Right}
                id="output"
                className="!w-3 !h-3 !border-2 !border-surface-primary"
                style={{ background: nodeColor }}
            />
        </div>
    );
}

export default memo(MediaInputNode);
