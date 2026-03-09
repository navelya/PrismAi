'use client';

import React, { memo, useCallback, useRef, useState, useEffect } from 'react';
import { NodeProps, useReactFlow } from 'reactflow';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import BaseNode from './BaseNode';
import { LayoutGrid, Square, Check, Upload, Plus, X } from 'lucide-react';
import GlassyLoader from '@/components/ui/GlassyLoader';

interface MediaInputNodeData {
    label: string;
    config: {
        images: Array<{ url: string; path: string } | string>;
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
    const [isUploading, setIsUploading] = useState(false);
    const [isImageLoading, setIsImageLoading] = useState(false);
    const activeSessionId = useAppStore((state) => state.activeSessionId);

    // Track when images change to show loader
    useEffect(() => {
        if (images.length > 0) {
            setIsImageLoading(true);
        }
    }, [images, activeImageIndex]);

    // Update node config with new images
    const updateImages = useCallback((newImages: Array<{ url: string; path: string } | string>) => {
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
    const handleFiles = useCallback(async (files: FileList | null) => {
        if (!files || files.length === 0 || !activeSessionId) return;

        setIsUploading(true);
        try {
            const { uploadApi } = await import('@/lib/api/client');

            const uploadPromises = Array.from(files).map(async (file) => {
                if (file.type.startsWith('image/')) {
                    const result = await uploadApi.upload(file, {
                        sessionId: activeSessionId,
                        nodeId: id
                    });
                    return { url: result.publicUrl, path: result.path };
                }
                return null;
            });

            const results = await Promise.all(uploadPromises);
            const validResults = results.filter((r): r is { url: string; path: string } => r !== null);

            if (validResults.length > 0) {
                updateImages([...images, ...validResults]);
            }
        } catch (err) {
            console.error('Upload failed:', err);
        } finally {
            setIsUploading(false);
        }
    }, [activeSessionId, id, images, updateImages]);

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
    const removeImage = async (e: React.MouseEvent, index: number) => {
        e.stopPropagation();
        e.preventDefault();

        const imageToRemove = images[index];

        if (typeof imageToRemove === 'object' && 'path' in imageToRemove) {
            try {
                const { uploadApi } = await import('@/lib/api/client');
                await uploadApi.delete(imageToRemove.path);
            } catch (err) {
                console.error('Failed to delete image from storage:', err);
            }
        }

        const newImages = images.filter((_, i) => i !== index);
        updateImages(newImages);
    };

    const getImageUrl = (img: any) => {
        if (typeof img === 'string') return img;
        return img?.url;
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
                    "relative w-full min-h-[160px] rounded-xl overflow-hidden border-2 border-dashed bg-white/5",
                    isDragOver ? "border-accent-primary bg-accent-primary/10" : "border-white/10 hover:border-white/20",
                    "transition-all duration-500"
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
                                    src={getImageUrl(images[activeImageIndex])}
                                    alt=""
                                    className="w-full h-full object-contain"
                                    onLoad={() => setIsImageLoading(false)}
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
                                            <img src={getImageUrl(img)} alt="" className="w-full h-full object-cover" />
                                            {activeImageIndex === index && (
                                                <div className="absolute inset-0 bg-accent-primary/20 flex items-center justify-center">
                                                    <Check className="w-3 h-3 text-white" />
                                                </div>
                                            )}
                                            <button
                                                onClick={(e) => removeImage(e, index)}
                                                className="absolute top-1 right-1 p-0.5 rounded bg-black/50 text-white opacity-0 hover:bg-red-500 group-hover:opacity-100 transition-opacity"
                                                style={{ zIndex: 10 }}
                                            >
                                                <X className="w-2.5 h-2.5" />
                                            </button>
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
                {/* Modern Glassy Loading Effect */}
                {(isUploading || isImageLoading) && <GlassyLoader />}
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
