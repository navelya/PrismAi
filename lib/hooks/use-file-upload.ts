import { useState, useRef, useCallback } from 'react';
import { convertImageToWebP } from '@/lib/utils/image-processing';

export function useFileUpload() {
    const [attachedImages, setAttachedImages] = useState<string[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const attachedBlobsRef = useRef<Blob[]>([]);

    const handleImageFiles = useCallback(async (files: FileList | null) => {
        if (!files || files.length === 0) return;

        const promises = Array.from(files).map(async (file) => {
            if (file.type.startsWith('image/')) {
                try {
                    const webpBlob = await convertImageToWebP(file);
                    // Create preview
                    const preview = await new Promise<string>((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result as string);
                        reader.readAsDataURL(webpBlob);
                    });
                    return { blob: webpBlob, preview };
                } catch (e) {
                    console.error("Image conversion failed", e);
                    return null;
                }
            }
            return null;
        });

        const results = await Promise.all(promises);
        const validResults = results.filter((r): r is { blob: Blob, preview: string } => r !== null);

        if (validResults.length > 0) {
            attachedBlobsRef.current = [...attachedBlobsRef.current, ...validResults.map(r => r.blob)];
            setAttachedImages(prev => [...prev, ...validResults.map(r => r.preview)]);
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
        clearAttachments
    };
}
