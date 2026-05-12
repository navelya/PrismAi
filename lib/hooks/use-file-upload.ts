import { useState, useRef, useCallback } from 'react';
import { convertImageToWebP, ImageTooLargeError } from '@/lib/utils/image-processing';

const IMAGE_CAP = 4;
const EVICTION_TOAST_MSG = 'Removed earliest photo — chat keeps the 4 most recent images active.';
const IMAGE_TOO_LARGE_TOAST_MSG = 'Image too large, even after compression. Try a smaller file.';

export function useFileUpload() {
    const [attachedImages, setAttachedImages] = useState<string[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const [evictionToast, setEvictionToast] = useState(false);
    const [imageTooLargeToast, setImageTooLargeToast] = useState(false);
    const attachedBlobsRef = useRef<Blob[]>([]);

    const dismissEvictionToast = useCallback(() => {
        setEvictionToast(false);
    }, []);

    const dismissImageTooLargeToast = useCallback(() => {
        setImageTooLargeToast(false);
    }, []);

    const handleImageFiles = useCallback(async (files: FileList | null) => {
        if (!files || files.length === 0) return;

        const promises = Array.from(files).map(async (file) => {
            if (file.type.startsWith('image/')) {
                try {
                    const webpBlob = await convertImageToWebP(file);
                    const preview = await new Promise<string>((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result as string);
                        reader.readAsDataURL(webpBlob);
                    });
                    return { blob: webpBlob, preview };
                } catch (e) {
                    if (e instanceof ImageTooLargeError) {
                        setImageTooLargeToast(true);
                    } else {
                        console.error("Image conversion failed", e);
                    }
                    return null;
                }
            }
            return null;
        });

        const results = await Promise.all(promises);
        const validResults = results.filter((r): r is { blob: Blob, preview: string } => r !== null);

        if (validResults.length === 0) return;

        let evicted = false;
        setAttachedImages(prev => {
            const combined = [...prev, ...validResults.map(r => r.preview)];
            if (combined.length > IMAGE_CAP) {
                evicted = true;
                return combined.slice(combined.length - IMAGE_CAP);
            }
            return combined;
        });

        // Keep blobs in sync with images (oldest-first eviction mirrors the state logic above)
        const combinedBlobs = [...attachedBlobsRef.current, ...validResults.map(r => r.blob)];
        if (combinedBlobs.length > IMAGE_CAP) {
            attachedBlobsRef.current = combinedBlobs.slice(combinedBlobs.length - IMAGE_CAP);
            evicted = true;
        } else {
            attachedBlobsRef.current = combinedBlobs;
        }

        if (evicted) {
            setEvictionToast(true);
        }
    }, []);

    const handleChatDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.types.includes('Files')) {
            setIsDragOver(true);
        }
    }, []);

    const handleChatDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const relatedTarget = e.relatedTarget as HTMLElement | null;
        if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
            setIsDragOver(false);
        }
    }, []);

    const handleChatDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        handleImageFiles(e.dataTransfer.files);
    }, [handleImageFiles]);

    const removeAttachedImage = useCallback((index: number) => {
        setAttachedImages(prev => prev.filter((_, i) => i !== index));
        attachedBlobsRef.current = attachedBlobsRef.current.filter((_, i) => i !== index);
    }, []);

    const clearAttachments = useCallback(() => {
        setAttachedImages([]);
        attachedBlobsRef.current = [];
    }, []);

    return {
        attachedImages,
        attachedBlobsRef,
        isDragOver,
        handleImageFiles,
        handleChatDragOver,
        handleChatDragLeave,
        handleChatDrop,
        removeAttachedImage,
        clearAttachments,
        evictionToast,
        evictionToastMessage: EVICTION_TOAST_MSG,
        dismissEvictionToast,
        imageTooLargeToast,
        imageTooLargeToastMessage: IMAGE_TOO_LARGE_TOAST_MSG,
        dismissImageTooLargeToast,
    };
}
