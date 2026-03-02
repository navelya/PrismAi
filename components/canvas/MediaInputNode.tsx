'use client';

import React, { memo, useCallback, useRef, useState } from 'react';
import { NodeProps, useReactFlow } from 'reactflow';
import { cn } from '@/lib/utils';
import BaseNode from './BaseNode';
import { LayoutGrid, Square, Check, Upload, Plus, X } from 'lucide-react';

interface MediaInputNodeData {
    label: string;
    config: {
        images: string[];
    };
}

function MediaInputNode({ data, id, selected }: NodeProps<MediaInputNodeData>) {
    const [isDragOver, setIsDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [previewMode, setPreviewMode] = useState<'single' | 'grid'>('single');
    const [activeImageIndex, setActiveImageIndex] = useState(0);

    const images = data.config?.images || [];

    // Use React Flow hook for direct graph manipulation
    const { setNodes } = useReactFlow();

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

    return (
        <BaseNode
            id={id}
            type="media_input"
            label={data.label}
            selected={selected}
            badgeCount={images.length}
            className={cn(isDragOver && "ring-2 ring-accent-primary ring-offset-2")}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            renderInputs={false}
        >
            <div
                className={cn(
                    "relative w-full min-h-[160px] rounded-xl overflow-hidden border-2 border-dashed bg-surface-secondary/50",
                    isDragOver ? "border-accent-primary bg-accent-primary/5" : "border-stroke-subtle hover:border-stroke-strong",
                    "transition-all duration-300"
                )}
            >
                {images.length === 0 ? (
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className={cn(
                            "absolute inset-0 flex flex-col items-center justify-center gap-2 transition-all p-4 text-center",
                            "text-content-tertiary hover:text-accent-primary hover:bg-accent-primary/5",
                            isDragOver && "text-accent-primary bg-accent-primary/10"
                        )}
                    >
                        <div className="w-10 h-10 rounded-full bg-surface-primary flex items-center justify-center shadow-sm">
                            <Upload className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-medium">Click or drag images to upload</span>
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

            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleInputChange}
                className="hidden"
            />
        </BaseNode>
    );
}

export default memo(MediaInputNode);
