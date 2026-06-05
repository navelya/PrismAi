'use client';

import { useState } from 'react';
import { Maximize2 } from 'lucide-react';
import ImageLightbox from '@/components/ui/ImageLightbox';
import type { RenderableMediaItem } from '@/lib/workflow/result-format';

interface RunMediaGalleryProps {
    /** Typed media items ({url,type,resolution}). Null/empty → skeleton tiles. */
    items: RenderableMediaItem[] | null | undefined;
    isCanvasMode?: boolean;
    /** How many skeleton tiles to show while nothing has arrived yet. */
    skeletonCount?: number;
}

/**
 * Renders chat-run media (images AND videos). Each tile reserves the media's
 * real aspect ratio and a real skeleton fills that footprint until the file has
 * ACTUALLY loaded — no broken <img>/alt-text flash, and no layout jump when the
 * media swaps in. Used for both the live (in-flight) state and the frozen
 * result so loading and final views are identical. The loaded media fills the
 * tile width (object-cover at the true ratio = no letterbox, no crop).
 *
 * Inline videos play as a clean, muted, controls-less preview; clicking any tile
 * (image or video) opens the shared lightbox — full controls, navigation across
 * all results, and a download button.
 */
export function RunMediaGallery({ items, isCanvasMode, skeletonCount = 1 }: RunMediaGalleryProps) {
    const list = (Array.isArray(items) ? items : []).filter(
        (i) => i && typeof i.url === 'string' && i.url.length > 0,
    );
    const showSkeleton = list.length === 0;
    const count = showSkeleton ? Math.max(1, skeletonCount) : list.length;

    // One lightbox over ALL media (images + videos). ImageLightbox auto-detects
    // each item's type from its URL, so 'any' lets the user page across the whole
    // result set with full controls + download.
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const lightboxMedia = list.map((i) => ({ url: i.url }));

    const maxW = isCanvasMode ? 300 : 460;

    return (
        <div className="flex flex-col gap-2">
            {showSkeleton
                ? Array.from({ length: count }).map((_, i) => (
                    <div
                        key={i}
                        className="w-full rounded-xl border border-stroke-subtle/40 bg-surface-tertiary/40 animate-pulse"
                        style={{ maxWidth: maxW, aspectRatio: '3 / 2' }}
                    />
                ))
                : list.map((item, i) => (
                    <MediaTile
                        key={`${item.url}-${i}`}
                        item={item}
                        maxW={maxW}
                        onOpen={() => setLightboxIndex(i)}
                    />
                ))}

            {lightboxIndex !== null && lightboxIndex >= 0 && (
                <ImageLightbox
                    media={lightboxMedia}
                    type="any"
                    initialIndex={lightboxIndex}
                    onClose={() => setLightboxIndex(null)}
                />
            )}
        </div>
    );
}

function MediaTile({
    item,
    maxW,
    onOpen,
}: {
    item: RenderableMediaItem;
    maxW: number;
    onOpen?: () => void;
}) {
    const [loaded, setLoaded] = useState(false);
    const [errored, setErrored] = useState(false);
    // Natural size measured on load — overrides metadata so the footprint is
    // always exact even when the source carried no resolution.
    const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
    const isVideo = item.type === 'video';

    const metaW = item.resolution?.width;
    const metaH = item.resolution?.height;
    const aspect = natural
        ? natural.w / natural.h
        : metaW && metaH
            ? metaW / metaH
            : 3 / 2; // sensible default before we know the real ratio

    const clickable = !!onOpen && loaded;

    return (
        <div
            className={`group relative w-full overflow-hidden rounded-xl border border-stroke-subtle/60 bg-surface-tertiary/40 ${clickable ? 'cursor-pointer' : ''}`}
            style={{ maxWidth: maxW, aspectRatio: String(aspect) }}
            onClick={clickable ? onOpen : undefined}
        >
            {/* Skeleton fills the reserved footprint until the media's own load
                event fires. Stays if the media errors, so no broken tag shows. */}
            {(!loaded || errored) && (
                <div className="absolute inset-0 animate-pulse bg-surface-tertiary/60" />
            )}

            {!errored && (isVideo ? (
                <video
                    src={item.url}
                    onLoadedData={(e) => {
                        const v = e.currentTarget;
                        if (v.videoWidth && v.videoHeight) setNatural({ w: v.videoWidth, h: v.videoHeight });
                        setLoaded(true);
                    }}
                    onError={() => setErrored(true)}
                    className={`h-full w-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
                    muted
                    loop
                    autoPlay
                    playsInline
                />
            ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={item.url}
                    alt=""
                    onLoad={(e) => {
                        const img = e.currentTarget;
                        if (img.naturalWidth && img.naturalHeight) setNatural({ w: img.naturalWidth, h: img.naturalHeight });
                        setLoaded(true);
                    }}
                    onError={() => setErrored(true)}
                    className={`h-full w-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
                />
            ))}

            {/* Expand affordance — signals the tile opens the full lightbox. */}
            {clickable && (
                <div className="pointer-events-none absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-lg bg-black/45 text-white opacity-0 backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100">
                    <Maximize2 className="h-3.5 w-3.5" />
                </div>
            )}
        </div>
    );
}
