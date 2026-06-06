'use client';

import { useState } from 'react';
import { Maximize2 } from 'lucide-react';
import ImageLightbox from '@/components/ui/ImageLightbox';
import type { RenderableMediaItem } from '@/lib/workflow/result-format';

interface RunMediaGalleryProps {
    /** Typed media items ({url,type,resolution}). Null/empty → skeleton tiles. */
    items: RenderableMediaItem[] | null | undefined;
    isCanvasMode?: boolean;
    /**
     * Total tiles to lay out: the grid renders `max(items.length, skeletonCount)`
     * cells — arrived media fills the first cells, the remainder stay skeletons.
     * Live runs pass the expected result count (so all placeholders show up
     * front and swap in as images land); the frozen result passes 0 so exactly
     * the real items render (no trailing skeletons if a run emitted fewer).
     */
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
 *
 * Layout: a fixed 4-column grid that wraps into rows of 4. Each column keeps a
 * minimum width, so a narrow chat panel can't shrink the tiles to mush — instead
 * the row overflows and scrolls sideways. In the roomy full-screen chat the
 * columns grow to fill the wider content width.
 */
export function RunMediaGallery({ items, isCanvasMode, skeletonCount = 0 }: RunMediaGalleryProps) {
    const list = (Array.isArray(items) ? items : []).filter(
        (i) => i && typeof i.url === 'string' && i.url.length > 0,
    );

    // Total cells = arrived media, padded out to the expected count with
    // skeletons. Always show at least one cell so an in-flight run with no count
    // still renders a placeholder.
    const total = Math.max(list.length, skeletonCount, 1);

    // One lightbox over ALL media (images + videos). ImageLightbox auto-detects
    // each item's type from its URL, so 'any' lets the user page across the whole
    // result set with full controls + download.
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const lightboxMedia = list.map((i) => ({ url: i.url }));

    // Narrow (canvas) panel keeps a smaller min so ~2.5 tiles peek before the
    // sideways scroll; full-screen gives tiles more room to grow.
    const minColW = isCanvasMode ? 120 : 150;

    return (
        <div className="overflow-x-auto">
            <div
                className="grid gap-2"
                style={{ gridTemplateColumns: `repeat(4, minmax(${minColW}px, 1fr))` }}
            >
                {Array.from({ length: total }).map((_, i) => {
                    const item = list[i];
                    if (!item) {
                        return (
                            <div
                                key={`sk-${i}`}
                                className="w-full rounded-xl border border-stroke-subtle/40 bg-surface-tertiary/40 animate-pulse"
                                style={{ aspectRatio: '3 / 2' }}
                            />
                        );
                    }
                    return (
                        <MediaTile
                            key={`${item.url}-${i}`}
                            item={item}
                            onOpen={() => setLightboxIndex(i)}
                        />
                    );
                })}
            </div>

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
    onOpen,
}: {
    item: RenderableMediaItem;
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
            style={{ aspectRatio: String(aspect) }}
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
