'use client';

import React, { memo, useCallback, useRef, useState, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { NodeProps, useStore, useUpdateNodeInternals } from 'reactflow';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import { uploadApi } from '@/lib/api/client';
import BaseNode from '@/lib/nodes/core/canvas/BaseNode';
import { LayoutGrid, Square, Check, Upload, Plus, X, Play, Music } from 'lucide-react';
import GlassyLoader from '@/components/ui/GlassyLoader';
import { detectMediaTypeFromUrl } from '@/lib/workflow/result-format';
import ImageLightbox from '@/components/ui/ImageLightbox';
import BlurryImage from '@/components/ui/BlurryImage';
import BlurryVideo from '@/components/ui/BlurryVideo';
import AudioPlayer from '@/components/ui/AudioPlayer';

interface MediaInputNodeData {
    label: string;
    config: {
        images: Array<{ url: string; path: string } | string>;
    };
}

function MediaInputNode({ data, id, selected }: NodeProps<MediaInputNodeData>) {
    const [isDragOver, setIsDragOver] = useState(false);

    const [previewMode, setPreviewMode] = useState<'single' | 'grid'>('single');
    const [activeImageIndex, setActiveImageIndex] = useState(0);
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);

    const images = data.config?.images || [];

    // Use AppStore for safe config updates instead of ReactFlow's setNodes
    const updateNodeConfig = useAppStore((state) => state.updateNodeConfig);
    const commitNodesChange = useAppStore((state) => state.onNodesChange);
    const updateNodeInternals = useUpdateNodeInternals();
    // RF-measured frame size + whether the node carries an explicit (user-resized)
    // size. `style.width` is only set once NodeResizer has run, so it's the signal
    // that the frame is pinned rather than auto-hugging its content.
    const nodeWidth = useStore((s) => s.nodeInternals.get(id)?.width);
    const nodeHeight = useStore((s) => s.nodeInternals.get(id)?.height);
    const explicitWidth = useStore((s) => s.nodeInternals.get(id)?.style?.width);
    // Aspect (w/h) of the media currently shown in single view, from its natural
    // dimensions — drives the single-view re-fit below.
    const [singleAspect, setSingleAspect] = useState<number | null>(null);
    const handleSingleMediaLoad = useCallback((dims?: { naturalWidth: number; naturalHeight: number }) => {
        if (dims && dims.naturalWidth > 0 && dims.naturalHeight > 0) {
            setSingleAspect(dims.naturalWidth / dims.naturalHeight);
        }
    }, []);

    // Re-fit the frame to the single-view media's aspect ratio.
    //
    // The node is aspect-ratio-locked resizable. Resizing while in GRID view bakes
    // in an explicit width+height whose ratio matches the grid, not the image —
    // and that pinned size persists into single view, where BaseNode makes the
    // card fill the fixed frame, so the `object-contain` image letterboxes (the
    // "black space" bug). A never-resized node has no `style.width` and auto-hugs
    // the image already, so we only act once an explicit size exists. Recompute
    // the height from the current width and the image aspect so the frame hugs
    // the image again, keeping the user's chosen width. Aspect-locked manual
    // resizes in single view then preserve this ratio, so the effect is a no-op
    // for them (guarded by the tolerance, which also prevents a commit loop).
    useEffect(() => {
        if (previewMode !== 'single') return;
        if (explicitWidth == null) return;
        if (!singleAspect || !nodeWidth || !nodeHeight) return;
        const CHROME = 14; // card border + content p-1 + dashed border, both sides
        const desiredHeight = Math.round((nodeWidth - CHROME) / singleAspect + CHROME);
        if (Math.abs(nodeHeight - desiredHeight) <= 4) return;
        commitNodesChange([
            { id, type: 'dimensions', updateStyle: true, resizing: false, dimensions: { width: nodeWidth, height: desiredHeight } } as any,
        ]);
        updateNodeInternals(id);
    }, [previewMode, explicitWidth, singleAspect, nodeWidth, nodeHeight, id, commitNodesChange, updateNodeInternals]);
    const [isUploading, setIsUploading] = useState(false);
    const activeSessionId = useAppStore((state) => state.activeSessionId);
    // View-only (collaboration viewer): no add/remove of files.
    const isViewer = useAppStore((state) => state.collabRole) === 'viewer';

    const getMediaUrl = (img: any) => {
        if (typeof img === 'string') return img;
        return img?.url;
    };

    // Update node config with new images
    const updateImages = useCallback((newImages: Array<{ url: string; path: string } | string>) => {
        updateNodeConfig(id, {
            ...data.config,
            images: newImages,
        });
    }, [id, data.config, updateNodeConfig]);

    const appendUniqueUrls = useCallback(
        (incomingUrls: string[]) => {
            if (incomingUrls.length === 0) return;

            const existingUrlSet = new Set(images.map(getMediaUrl).filter(Boolean));
            const dedupedIncoming = incomingUrls.filter((url) => !!url && !existingUrlSet.has(url));
            if (dedupedIncoming.length === 0) return;

            updateImages([...images, ...dedupedIncoming]);
            setActiveImageIndex((prev) => (images.length > 0 ? prev : 0));
        },
        [images, updateImages]
    );

    // Handle file upload
    const handleFiles = useCallback(async (files: FileList | null) => {
        if (isViewer) return;
        if (!files || files.length === 0 || !activeSessionId) return;

        // Paint the "Uploading" overlay synchronously. handleFiles runs from the
        // file input's *native* onchange (a detached input — see openFilePicker),
        // so React 18 doesn't auto-flush this state update until the async work
        // below yields, leaving the indicator blank for a beat. flushSync forces
        // the overlay to commit now so it appears the instant a file is picked.
        flushSync(() => setIsUploading(true));
        try {
            const uploadPromises = Array.from(files).map(async (file) => {
                if (file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/')) {
                    const result = await uploadApi.upload(file, {
                        sessionId: activeSessionId,
                        nodeId: id,
                        track: true,
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

    // Open the native file picker.
    //
    // We build the <input> imperatively instead of clicking a hidden one
    // rendered inside this node. The node lives in a ReactFlow canvas and
    // re-renders constantly (hover, selection, live-collab cursors, the
    // _isUploading flag, the resize effects). A React-tree-managed hidden file
    // input nested inside such a node opens the OS picker fine but unreliably
    // delivers its `change` event in Chromium — the selection silently never
    // reaches `handleFiles`, so the picker "does nothing" while drag-drop (a
    // separate EditorCanvas path) keeps working. A detached input is immune to
    // node re-renders and event delegation, so `change` always fires.
    const openFilePicker = useCallback(() => {
        if (isViewer) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,video/*,audio/*';
        input.multiple = true;
        input.onchange = () => {
            handleFiles(input.files);
        };
        input.click();
    }, [isViewer, handleFiles]);

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
        if (isViewer) return;

        // Support dragging from AssetsPanel directly onto an existing media_input node.
        const rawData = e.dataTransfer.getData('application/reactflow');
        if (rawData) {
            try {
                const payload = JSON.parse(rawData);
                const dropped = Array.isArray(payload?.initialConfig?.images)
                    ? payload.initialConfig.images
                    : [];

                const droppedUrls = dropped
                    .map((item: any) => (typeof item === 'string' ? item : item?.url))
                    .filter((url: any) => typeof url === 'string' && (url.startsWith('http') || url.startsWith('data:')));

                if (droppedUrls.length > 0) {
                    appendUniqueUrls(droppedUrls);
                    return;
                }
            } catch {
                // Not a structured canvas payload; fall through to file-drop handling.
            }
        }

        handleFiles(e.dataTransfer.files);
    };

    // Remove an image
    const removeImage = async (e: React.MouseEvent, index: number) => {
        e.stopPropagation();
        e.preventDefault();
        if (isViewer) return;

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

    const isVideo = (url: string) => {
        return detectMediaTypeFromUrl(url) === 'video';
    };

    const isAudio = (url: string) => {
        return detectMediaTypeFromUrl(url) === 'audio';
    };

    // An audio-only node renders the compact, fixed-size transport-strip layout
    // (matching the ai_generator audio preview) instead of the resizable image
    // frame. Mixed media (audio + images) falls back to the framed single/grid
    // views, which render audio items as a player/icon tile.
    const allAudio = images.length > 0 && images.every((img) => isAudio(getMediaUrl(img)));

    return (
        <BaseNode
            id={id}
            type="media_input"
            label={data.label}
            selected={selected}
            nodeData={data}
            isNew={(data as any).isNew}
            className={cn(isDragOver && "ring-2 ring-accent-primary ring-offset-2")}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            renderInputs={false}
            hideStatus={true}
            resizable={!allAudio}
            minWidth={allAudio ? undefined : 240}
            width=""
            style={{ width: allAudio ? 300 : 360 }}
        >
            {allAudio ? (
                <div
                    className={cn(
                        "relative w-full flex flex-col gap-1.5 rounded-xl border-2 border-dashed p-1.5 bg-white/5 group/audio",
                        isDragOver ? "border-accent-primary bg-accent-primary/10" : "border-white/10 hover:border-white/20",
                        "transition-all duration-500"
                    )}
                >
                    {images.map((img, index) => (
                        <div
                            key={index}
                            className="relative flex items-center h-[56px] px-2 rounded-xl border border-white/10 bg-white/5 shadow-inner"
                        >
                            <AudioPlayer src={getMediaUrl(img)} />
                            {!isViewer && (
                                <button
                                    type="button"
                                    onClick={(e) => removeImage(e, index)}
                                    onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                                    className="absolute top-1 right-1 p-0.5 rounded bg-black/50 text-white opacity-0 hover:bg-red-500 group-hover/audio:opacity-100 transition-opacity z-10"
                                >
                                    <X className="w-2.5 h-2.5" />
                                </button>
                            )}
                        </div>
                    ))}
                    {!isViewer && (
                        <button
                            type="button"
                            onClick={openFilePicker}
                            className="flex items-center justify-center gap-1.5 h-9 rounded-xl border border-dashed border-white/10 text-white/30 hover:border-white/20 hover:text-white/50 transition-colors text-xs font-medium"
                        >
                            <Plus className="w-3.5 h-3.5" /> Add audio
                        </button>
                    )}
                    {(isUploading || (data.config as any)?._isUploading === true) && <GlassyLoader label="Uploading" />}
                </div>
            ) : (
            <div
                className={cn(
                    "relative w-full h-full min-h-[160px] rounded-xl overflow-hidden border-2 border-dashed bg-white/5",
                    isDragOver ? "border-accent-primary bg-accent-primary/10" : "border-white/10 hover:border-white/20",
                    "transition-all duration-500"
                )}
            >
                {images.length === 0 ? (
                    <button
                        type="button"
                        disabled={isViewer}
                        onClick={openFilePicker}
                        className={cn(
                            "absolute inset-0 flex flex-col items-center justify-center gap-2 transition-all p-4 text-center",
                            "text-content-tertiary hover:text-accent-primary hover:bg-accent-primary/5",
                            isDragOver && "text-accent-primary bg-accent-primary/10",
                            isViewer && "pointer-events-none opacity-60"
                        )}
                    >
                        <div className="w-10 h-10 rounded-full bg-surface-primary flex items-center justify-center shadow-sm">
                            <Upload className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-medium">Click or drag media to upload</span>
                    </button>
                ) : (
                    <>
                        {previewMode === 'single' ? (
                            <div
                                className={cn("w-full h-full group/preview relative", !isAudio(getMediaUrl(images[activeImageIndex])) && "cursor-zoom-in")}
                                onMouseEnter={() => videoRef.current?.play()}
                                onMouseLeave={() => {
                                    if (videoRef.current) {
                                        videoRef.current.pause();
                                        videoRef.current.currentTime = 0;
                                    }
                                }}
                                onClick={() => { if (!isAudio(getMediaUrl(images[activeImageIndex]))) setLightboxOpen(true); }}
                            >
                                {isAudio(getMediaUrl(images[activeImageIndex])) ? (
                                    <div className="w-full h-full min-h-[160px] flex items-center px-3" onClick={(e) => e.stopPropagation()}>
                                        <AudioPlayer src={getMediaUrl(images[activeImageIndex])} />
                                    </div>
                                ) : isVideo(getMediaUrl(images[activeImageIndex])) ? (
                                    <>
                                        <BlurryVideo
                                            ref={videoRef}
                                            src={getMediaUrl(images[activeImageIndex])}
                                            className="w-full h-full object-contain max-w-none max-h-none"
                                            controls={false}
                                            muted
                                            loop
                                            playsInline
                                            onLoadedMetadata={(e: any) => handleSingleMediaLoad({ naturalWidth: e.currentTarget.videoWidth, naturalHeight: e.currentTarget.videoHeight })}
                                        />
                                        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/preview:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                            <Play className="w-10 h-10 text-white fill-current" />
                                        </div>
                                    </>
                                ) : (
                                    <BlurryImage
                                        src={getMediaUrl(images[activeImageIndex])}
                                        alt=""
                                        className="w-full h-full max-w-none max-h-none"
                                        onLoad={handleSingleMediaLoad}
                                    />
                                )}
                                {!isViewer && (
                                    <button
                                        type="button"
                                        onClick={(e) => removeImage(e, activeImageIndex)}
                                        onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                                        className="absolute top-2 left-2 p-1 rounded bg-black/50 text-white opacity-0 group-hover/preview:opacity-100 transition-opacity"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="w-full h-full p-2 overflow-y-auto custom-scrollbar">
                                <div className="grid grid-cols-3 gap-1.5">
                                    {images.map((img, index) => {
                                        const url = getMediaUrl(img);
                                        const isVid = isVideo(url);
                                        const isAud = isAudio(url);
                                        return (
                                            <button
                                                key={index}
                                                type="button"
                                                onClick={() => setActiveImageIndex(index)}
                                                className={cn(
                                                    "relative aspect-square rounded overflow-hidden border transition-all",
                                                    activeImageIndex === index ? "border-accent-primary ring-2 ring-accent-primary/20" : "border-white/5"
                                                )}
                                            >
                                                {isAud ? (
                                                    <div className="w-full h-full flex items-center justify-center bg-white/5 text-content-tertiary">
                                                        <Music className="w-5 h-5" />
                                                    </div>
                                                ) : isVid ? (
                                                    <BlurryVideo
                                                        src={url}
                                                        className="w-full h-full object-cover max-w-none max-h-none"
                                                        muted
                                                        playsInline
                                                    />
                                                ) : (
                                                    <BlurryImage
                                                        src={url}
                                                        alt=""
                                                        className="w-full h-full object-cover max-w-none max-h-none"
                                                    />
                                                )}
                                                {activeImageIndex === index && (
                                                    <div className="absolute inset-0 bg-accent-primary/20 flex items-center justify-center">
                                                        <Check className="w-3 h-3 text-white" />
                                                    </div>
                                                )}
                                                {!isViewer && (
                                                    <button
                                                        type="button"
                                                        onClick={(e) => removeImage(e, index)}
                                                        onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                                                        className="absolute top-1 right-1 p-0.5 rounded bg-black/50 text-white opacity-0 hover:bg-red-500 group-hover:opacity-100 transition-opacity"
                                                        style={{ zIndex: 10 }}
                                                    >
                                                        <X className="w-2.5 h-2.5" />
                                                    </button>
                                                )}
                                            </button>
                                        );
                                    })}
                                    {!isViewer && (
                                        <button
                                            type="button"
                                            onClick={openFilePicker}
                                            className="aspect-square rounded border border-dashed border-white/10 flex items-center justify-center text-white/20 hover:border-white/20 hover:text-white/40"
                                        >
                                            <Plus className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Controls */}
                        <div className="absolute bottom-2 right-2 flex bg-black/60 backdrop-blur-md rounded-lg p-0.5 border border-white/10 z-20 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                                type="button"
                                onClick={() => setPreviewMode('single')}
                                className={cn("p-1.5 rounded-md", previewMode === 'single' ? "bg-accent-primary text-white" : "text-white/40")}
                            >
                                <Square className="w-3.5 h-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setPreviewMode('grid')}
                                className={cn("p-1.5 rounded-md", previewMode === 'grid' ? "bg-accent-primary text-white" : "text-white/40")}
                            >
                                <LayoutGrid className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </>
                )}
                {/* Modern Glassy Loading Effect */}
                {(isUploading || (data.config as any)?._isUploading === true) && <GlassyLoader label="Uploading" />}
            </div>
            )}

            {/* Image Lightbox — images/video only; audio uses its own player */}
            {lightboxOpen && !allAudio && images.length > 0 && (
                <ImageLightbox
                    media={images.map(getMediaUrl)}
                    type="any"
                    initialIndex={activeImageIndex}
                    onClose={() => setLightboxOpen(false)}
                />
            )}
        </BaseNode>
    );
}

export default memo(MediaInputNode);

import { NodeClientDef } from '../../core/types';
import { mediaInputSharedDef } from './definition';

export const mediaInputClientDef: NodeClientDef = {
    ...mediaInputSharedDef,
    component: memo((props: any) => <MediaInputNode {...props} type="media_input" />),
};
