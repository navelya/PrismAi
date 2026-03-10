'use client';

import React from 'react';
import { ImageObject } from '@/lib/nodes/types';
import { FileText, ImageIcon, LayoutDashboard } from 'lucide-react';
import ImageLightbox from '@/components/ui/ImageLightbox';

interface MessageRendererProps {
    data: any;
    /** When true (Floating Copilot mode), suppress large image galleries. */
    isCanvasMode?: boolean;
}

export default function MessageRenderer({ data, isCanvasMode = false }: MessageRendererProps) {
    if (!data) return null;

    const actualData = data?.images || data;

    // Detect array of images
    if (Array.isArray(actualData) && actualData.length > 0) {
        const firstItem = actualData[0];
        if (firstItem && typeof firstItem === 'object' && ('url' in firstItem)) {
            // ── Canvas Mode: compact "view in canvas" tag instead of gallery ──
            if (isCanvasMode) {
                return <CanvasResultTag count={actualData.length} />;
            }
            return <ImageGallery images={actualData} />;
        }
        if (typeof firstItem === 'object') {
            return <DataTable data={actualData} />;
        }
    }

    if (typeof data === 'string') {
        return <TextRenderer text={data} />;
    }

    // Fallback: JSON display
    return (
        <div className="bg-surface-secondary rounded-lg p-4 border border-stroke-subtle">
            <pre className="text-sm text-content-secondary overflow-x-auto">
                {JSON.stringify(data, null, 2)}
            </pre>
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Canvas Mode: compact success tag (view-only hint)
// ────────────────────────────────────────────────────────────────────────────
function CanvasResultTag({ count }: { count: number }) {
    return (
        <div className="flex items-center gap-2 mt-1 px-2.5 py-1.5 bg-accent-primary/10 border border-accent-primary/20 rounded-lg w-fit max-w-full backdrop-blur-sm">
            <LayoutDashboard className="w-3.5 h-3.5 text-accent-primary flex-shrink-0" />
            <span className="text-xs font-bold text-accent-primary uppercase tracking-wider truncate">
                {count === 1 ? 'Image' : `${count} images`} added to Canvas
            </span>
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Full Chat Mode: full image gallery (unchanged)
// ────────────────────────────────────────────────────────────────────────────
const ImageGallery = React.memo(function ImageGallery({ images }: { images: ImageObject[] }) {
    const [selectedIndex, setSelectedIndex] = React.useState<number | null>(null);
    const [thumbnails, setThumbnails] = React.useState<Map<number, string>>(new Map());

    React.useEffect(() => {
        const generateThumbnails = async () => {
            const newThumbnails = new Map<number, string>();
            for (let i = 0; i < images.length; i++) {
                const img = images[i];
                if (img?.url?.startsWith('data:')) {
                    try {
                        const thumbnail = await createThumbnail(img.url, 300);
                        newThumbnails.set(i, thumbnail);
                    } catch (e) {
                        console.warn('Thumbnail generation failed', i);
                    }
                }
            }
            if (newThumbnails.size > 0) setThumbnails(newThumbnails);
        };
        generateThumbnails();
    }, [images]);

    const lightboxImages = React.useMemo(() =>
        images.map(img => ({ url: img.url })),
        [images]
    );

    return (
        <div className="space-y-3 overflow-hidden">
            <div className="flex items-center gap-2 text-sm text-content-secondary">
                <ImageIcon className="w-4 h-4" />
                <span>{images.length} images</span>
            </div>

            <div className="flex flex-row flex-wrap justify-start items-start gap-2 w-full">
                {images.map((img, idx) => {
                    const width = img.resolution?.width || 1024;
                    const height = img.resolution?.height || 1024;

                    return (
                        <div
                            key={idx}
                            className="relative cursor-pointer group rounded-lg overflow-hidden shadow-sm border border-stroke-subtle bg-surface-tertiary flex-none"
                            style={{
                                height: '180px',
                                width: 'auto',
                                flexGrow: 0,
                                maxWidth: '100%',
                            }}
                            onClick={() => setSelectedIndex(idx)}
                        >
                            <img
                                src={thumbnails.get(idx) || img.url}
                                alt={img.metadata?.title}
                                className="h-full w-auto max-w-none object-cover transition-transform duration-300 group-hover:scale-105"
                                style={{ width: 'auto', height: '100%' }}
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-200" />
                            <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                                <div className="text-[10px] text-white/90 font-medium truncate">
                                    {width} x {height}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {selectedIndex !== null && (
                <ImageLightbox
                    images={lightboxImages}
                    initialIndex={selectedIndex}
                    onClose={() => setSelectedIndex(null)}
                />
            )}
        </div>
    );
});

function createThumbnail(base64Url: string, maxWidth: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const scale = Math.min(1, maxWidth / img.width);
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/png'));
            } else reject(new Error('Canvas context error'));
        };
        img.onerror = reject;
        img.src = base64Url;
    });
}

function DataTable({ data }: { data: any[] }) {
    if (data.length === 0) return null;
    const keys = Object.keys(data[0]);

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-content-secondary">
                <FileText className="w-4 h-4" />
                <span>{data.length} rows</span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-accent-primary/10 glassmorphism">
                <table className="min-w-full divide-y divide-accent-primary/10">
                    <thead className="bg-accent-primary/5">
                        <tr>
                            {keys.map((key) => (
                                <th
                                    key={key}
                                    className="px-4 py-3 text-left text-[10px] font-black text-accent-primary uppercase tracking-widest"
                                >
                                    {key}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-accent-primary/5">
                        {data.map((row, idx) => (
                            <tr key={idx} className="hover:bg-surface-secondary/50">
                                {keys.map((key) => (
                                    <td key={key} className="px-4 py-3 text-sm text-content-primary">
                                        {typeof row[key] === 'object'
                                            ? JSON.stringify(row[key])
                                            : String(row[key])}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function TextRenderer({ text }: { text: string }) {
    return (
        <div className="prose prose-sm max-w-none dark:prose-invert">
            <p className="text-content-primary whitespace-pre-wrap">{text}</p>
        </div>
    );
}
