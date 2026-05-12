import { useState, useRef, useCallback } from 'react';
import { convertImageToWebP, ImageTooLargeError, uploadImageToStorage } from '@/lib/utils/image-processing';
import { createClient } from '@/lib/supabase/client';

const ATTACHMENT_CAP = 4;
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;

const EVICTION_TOAST_MSG = 'Removed earliest attachment — chat keeps the 4 most recent files active.';
const IMAGE_TOO_LARGE_TOAST_MSG = 'Image too large, even after compression. Try a smaller file.';
const VIDEO_TOO_LARGE_TOAST_MSG = 'Video too large — 50MB max.';
const VIDEO_UPLOAD_FAILED_TOAST_MSG = 'Video upload failed. Please try again.';

function extensionFromFile(file: File): string {
    const dotIdx = file.name.lastIndexOf('.');
    if (dotIdx > 0 && dotIdx < file.name.length - 1) {
        return file.name.slice(dotIdx + 1).toLowerCase();
    }
    if (file.type && file.type.includes('/')) {
        return file.type.split('/')[1].toLowerCase();
    }
    return 'bin';
}

export function useFileUpload() {
    // Strings here can be data URLs (images) OR https URLs (videos uploaded directly).
    const [attachedImages, setAttachedImages] = useState<string[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const [evictionToast, setEvictionToast] = useState(false);
    const [imageTooLargeToast, setImageTooLargeToast] = useState(false);
    const [videoTooLargeToast, setVideoTooLargeToast] = useState(false);
    const [videoUploadFailedToast, setVideoUploadFailedToast] = useState(false);
    // Kept for backwards compatibility with handleSend's signature. Only contains
    // image webp blobs; video entries contribute a placeholder empty Blob to keep
    // index alignment with attachedImages for removeAttachedImage.
    const attachedBlobsRef = useRef<Blob[]>([]);

    const dismissEvictionToast = useCallback(() => setEvictionToast(false), []);
    const dismissImageTooLargeToast = useCallback(() => setImageTooLargeToast(false), []);
    const dismissVideoTooLargeToast = useCallback(() => setVideoTooLargeToast(false), []);
    const dismissVideoUploadFailedToast = useCallback(() => setVideoUploadFailedToast(false), []);

    const processImage = useCallback(async (file: File): Promise<{ preview: string; blob: Blob } | null> => {
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
                console.error('Image conversion failed', e);
            }
            return null;
        }
    }, []);

    const processVideo = useCallback(async (file: File): Promise<string | null> => {
        if (file.size > VIDEO_MAX_BYTES) {
            setVideoTooLargeToast(true);
            return null;
        }
        try {
            const supabase = createClient();
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                console.error('Cannot upload video: no authenticated user');
                setVideoUploadFailedToast(true);
                return null;
            }
            const extension = extensionFromFile(file);
            const { publicUrl } = await uploadImageToStorage(file, user.id, supabase, {
                extension,
                contentType: file.type || `video/${extension}`,
            });
            return publicUrl;
        } catch (e) {
            console.error('Video upload failed', e);
            setVideoUploadFailedToast(true);
            return null;
        }
    }, []);

    const handleImageFiles = useCallback(async (files: FileList | null) => {
        if (!files || files.length === 0) return;

        const processed = await Promise.all(Array.from(files).map(async (file) => {
            if (file.type.startsWith('image/')) {
                const result = await processImage(file);
                return result ? { kind: 'image' as const, preview: result.preview, blob: result.blob } : null;
            }
            if (file.type.startsWith('video/')) {
                const url = await processVideo(file);
                return url ? { kind: 'video' as const, preview: url } : null;
            }
            return null;
        }));

        const valid = processed.filter((p): p is NonNullable<typeof p> => p !== null);
        if (valid.length === 0) return;

        // Use the blob ref as the canonical synchronous length source — it mirrors
        // attachedImages 1:1 but, unlike state, can be read without waiting on a
        // setState updater to be flushed.
        const newBlobs: Blob[] = valid.map(v => v.kind === 'image' ? v.blob : new Blob());
        const combinedBlobs = [...attachedBlobsRef.current, ...newBlobs];
        const evicted = combinedBlobs.length > ATTACHMENT_CAP;

        attachedBlobsRef.current = evicted
            ? combinedBlobs.slice(combinedBlobs.length - ATTACHMENT_CAP)
            : combinedBlobs;

        setAttachedImages(prev => {
            const combined = [...prev, ...valid.map(v => v.preview)];
            return combined.length > ATTACHMENT_CAP
                ? combined.slice(combined.length - ATTACHMENT_CAP)
                : combined;
        });

        if (evicted) setEvictionToast(true);
    }, [processImage, processVideo]);

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
        videoTooLargeToast,
        videoTooLargeToastMessage: VIDEO_TOO_LARGE_TOAST_MSG,
        dismissVideoTooLargeToast,
        videoUploadFailedToast,
        videoUploadFailedToastMessage: VIDEO_UPLOAD_FAILED_TOAST_MSG,
        dismissVideoUploadFailedToast,
    };
}
