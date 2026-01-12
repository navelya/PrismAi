'use client';

import React, { memo, useCallback, useRef, useState } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { nodeMetadata } from '@/lib/nodes/registry';
import { ImagePlus, X, Upload, Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';

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
    const status = useAppStore((state) => state.nodeStatuses[id] || 'idle');

    const images = data.config?.images || [];

    // Node color with fallback to accent
    const nodeColor = metadata?.color || 'rgb(var(--accent-primary))';

    // Update node config with new images - use getState to avoid stale closure
    const updateImages = useCallback((newImages: string[]) => {
        const { currentWorkflow, setCurrentWorkflow } = useAppStore.getState();
        if (!currentWorkflow) return;

        const updatedNodes = currentWorkflow.nodes.map((node) => {
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
        });

        setCurrentWorkflow({
            ...currentWorkflow,
            nodes: updatedNodes,
        });
    }, [id]);

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
        deleteNode(id);
    };

    return (
        <div
            className={cn(
                "rounded-xl shadow-lg border-2 backdrop-blur-sm relative group bg-canvas-node",
                "transition-all duration-300 hover:shadow-2xl",
                "w-[160px]",
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
            {/* Delete Button */}
            <div className="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 z-10">
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
                    <ImagePlus className="w-3.5 h-3.5" style={{ color: nodeColor }} />
                </div>
                <span className="text-xs font-semibold text-canvas-text truncate">Media Input</span>
                {images.length > 0 && (
                    <span className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent-primary text-content-inverted">
                        {images.length}
                    </span>
                )}
            </div>

            {/* Content */}
            <div className="p-2">
                {/* Upload area / Preview grid */}
                {images.length === 0 ? (
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className={cn(
                            "w-full h-16 rounded-lg border-2 border-dashed transition-all",
                            "flex flex-col items-center justify-center gap-1",
                            "text-content-tertiary hover:text-accent-primary hover:border-accent-primary",
                            isDragOver ? "border-accent-primary bg-accent-primary/10" : "border-stroke-default"
                        )}
                    >
                        <Upload className="w-4 h-4" />
                        <span className="text-[10px]">Click or drop</span>
                    </button>
                ) : (
                    <div className="space-y-1.5">
                        {/* Thumbnail grid */}
                        <div className="grid grid-cols-3 gap-1">
                            {images.slice(0, 6).map((img, index) => (
                                <div
                                    key={index}
                                    className="relative aspect-square rounded overflow-hidden bg-surface-tertiary group/thumb"
                                >
                                    <img
                                        src={img}
                                        alt={`Upload ${index + 1}`}
                                        className="w-full h-full object-cover"
                                    />
                                    <button
                                        onClick={(e) => removeImage(e, index)}
                                        className="absolute inset-0 bg-black/50 opacity-0 group-hover/thumb:opacity-100 
                                                   flex items-center justify-center transition-opacity"
                                    >
                                        <X className="w-3 h-3 text-content-inverted" />
                                    </button>
                                </div>
                            ))}
                            {images.length > 6 && (
                                <div className="aspect-square rounded bg-surface-tertiary flex items-center justify-center">
                                    <span className="text-[10px] font-medium text-content-secondary">+{images.length - 6}</span>
                                </div>
                            )}
                        </div>

                        {/* Add more button */}
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full py-1 rounded text-[10px] font-medium text-accent-primary 
                                       bg-accent-primary/10 hover:bg-accent-primary/20 transition-colors"
                        >
                            + Add more
                        </button>
                    </div>
                )}
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
