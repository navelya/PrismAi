'use client';

import React, { useEffect, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import {
    X,
    ChevronLeft,
    ChevronRight,
    Image as ImageIcon,
    Film,
    Music,
    Box,
    FileText,
    Sparkles,
    ExternalLink,
} from 'lucide-react';
import type { RunDetail, RunResultItem } from '@/lib/billing/run-details';

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
    image: ImageIcon,
    video: Film,
    audio: Music,
    '3d': Box,
};

interface LightboxState {
    item: RunResultItem;
    index: number;
}

/**
 * Horizontal strip of "which model ran + what it produced" chips for a single
 * workflow run. Each chip shows the provider logo, the model name, and small
 * result thumbnails; hovering a thumbnail enlarges it, clicking opens the full
 * result in a lightbox. Reused by the user-facing usage history and the admin
 * per-user tokens tab so both stay in sync.
 */
export function RunResultStrip({ detail }: { detail: RunDetail | undefined }) {
    const [lightbox, setLightbox] = useState<LightboxState | null>(null);

    if (!detail || detail.items.length === 0) return null;

    return (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
            {detail.items.map((item) => (
                <ModelResultChip
                    key={item.nodeId}
                    item={item}
                    onOpen={(index) => setLightbox({ item, index })}
                />
            ))}
            <ResultLightbox state={lightbox} onClose={() => setLightbox(null)} />
        </div>
    );
}

function ModelResultChip({ item, onOpen }: { item: RunResultItem; onOpen: (index: number) => void }) {
    const TypeIcon = (item.resultType && TYPE_ICON[item.resultType]) || FileText;
    const previews = item.urls.slice(0, 3);
    const extra = item.urls.length - previews.length;

    return (
        <div className="flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 pl-1.5 pr-1 py-1 max-w-full">
            {/* Provider logo */}
            <span className="w-4 h-4 rounded-[4px] overflow-hidden bg-white/10 flex items-center justify-center shrink-0">
                {item.providerLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.providerLogo} alt={item.providerName ?? ''} className="w-full h-full object-contain" />
                ) : (
                    <Sparkles className="w-2.5 h-2.5 text-content-tertiary" />
                )}
            </span>

            {/* Model name */}
            <span
                className="text-[11px] font-semibold text-content-secondary truncate max-w-[150px]"
                title={item.providerName ? `${item.modelName} · ${item.providerName}` : item.modelName}
            >
                {item.modelName}
            </span>

            {/* Result thumbnails */}
            {previews.length > 0 ? (
                <div className="flex items-center gap-1 shrink-0">
                    {previews.map((url, i) => (
                        <button
                            key={i}
                            type="button"
                            onClick={() => onOpen(i)}
                            className="group relative w-8 h-8 rounded-md overflow-hidden border border-white/10 hover:border-accent-primary/60 hover:scale-110 transition-transform"
                            title="Click to view full result"
                        >
                            <ThumbMedia url={url} resultType={item.resultType} TypeIcon={TypeIcon} />
                        </button>
                    ))}
                    {extra > 0 && (
                        <button
                            type="button"
                            onClick={() => onOpen(previews.length)}
                            className="w-8 h-8 rounded-md border border-white/10 bg-white/5 text-[10px] font-bold text-content-tertiary hover:text-content-secondary hover:border-white/20 transition-colors shrink-0"
                            title="View all results"
                        >
                            +{extra}
                        </button>
                    )}
                </div>
            ) : (
                <span className="px-1 text-content-tertiary shrink-0" title={item.status}>
                    <TypeIcon className="w-3.5 h-3.5" />
                </span>
            )}
        </div>
    );
}

function ThumbMedia({
    url,
    resultType,
    TypeIcon,
}: {
    url: string;
    resultType: string | null;
    TypeIcon: React.ComponentType<{ className?: string }>;
}) {
    if (resultType === 'image') {
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={url} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />;
    }
    if (resultType === 'video') {
        return (
            <video
                src={url}
                className="absolute inset-0 w-full h-full object-cover"
                muted
                preload="metadata"
                playsInline
            />
        );
    }
    return (
        <span className="absolute inset-0 flex items-center justify-center text-content-tertiary">
            <TypeIcon className="w-3.5 h-3.5" />
        </span>
    );
}

function ResultLightbox({ state, onClose }: { state: LightboxState | null; onClose: () => void }) {
    const [index, setIndex] = useState(0);

    useEffect(() => {
        if (state) setIndex(state.index);
    }, [state]);

    const open = !!state;
    const urls = state?.item.urls ?? [];
    const url = urls[index];
    const resultType = state?.item.resultType ?? null;
    const total = urls.length;

    const go = (delta: number) => setIndex((i) => (total === 0 ? 0 : (i + delta + total) % total));

    return (
        <RadixDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
            <RadixDialog.Portal>
                {/* z above the shared Modal scale (tops out at z-[120]) so the
                    lightbox opens ABOVE the Account window, which hosts the
                    usage history this strip lives in. */}
                <RadixDialog.Overlay className="fixed inset-0 z-[130] bg-black/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
                <RadixDialog.Content className="fixed inset-0 z-[131] flex items-center justify-center p-4 sm:p-10 focus:outline-none">
                    <RadixDialog.Title className="sr-only">{state?.item.modelName ?? 'Result'}</RadixDialog.Title>
                    <RadixDialog.Description className="sr-only">Full workflow run result preview.</RadixDialog.Description>

                    {/* Header: model + provider */}
                    {state && (
                        <div className="absolute top-4 left-4 right-16 flex items-center gap-2">
                            <span className="w-5 h-5 rounded-[4px] overflow-hidden bg-white/10 flex items-center justify-center shrink-0">
                                {state.item.providerLogo ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={state.item.providerLogo} alt="" className="w-full h-full object-contain" />
                                ) : (
                                    <Sparkles className="w-3 h-3 text-white/70" />
                                )}
                            </span>
                            <span className="text-sm font-bold text-white truncate">{state.item.modelName}</span>
                            {state.item.providerName && (
                                <span className="text-xs text-white/50 truncate">· {state.item.providerName}</span>
                            )}
                            {total > 1 && (
                                <span className="ml-auto text-xs font-mono text-white/60 tabular-nums shrink-0">
                                    {index + 1} / {total}
                                </span>
                            )}
                        </div>
                    )}

                    <RadixDialog.Close asChild>
                        <button
                            className="absolute top-3 right-3 p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors z-10"
                            aria-label="Close"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </RadixDialog.Close>

                    {total > 1 && (
                        <>
                            <button
                                onClick={() => go(-1)}
                                className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                                aria-label="Previous"
                            >
                                <ChevronLeft className="w-7 h-7" />
                            </button>
                            <button
                                onClick={() => go(1)}
                                className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                                aria-label="Next"
                            >
                                <ChevronRight className="w-7 h-7" />
                            </button>
                        </>
                    )}

                    {url && <FullMedia url={url} resultType={resultType} />}
                </RadixDialog.Content>
            </RadixDialog.Portal>
        </RadixDialog.Root>
    );
}

function FullMedia({ url, resultType }: { url: string; resultType: string | null }) {
    if (resultType === 'image') {
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={url} alt="" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />;
    }
    if (resultType === 'video') {
        return (
            <video
                src={url}
                className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                controls
                autoPlay
                playsInline
            />
        );
    }
    if (resultType === 'audio') {
        return (
            <div className="bg-surface-elevated border border-white/10 rounded-2xl p-6 w-full max-w-md">
                <audio src={url} className="w-full" controls autoPlay />
            </div>
        );
    }
    return (
        <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-3 bg-white/10 text-white rounded-xl text-sm font-semibold hover:bg-white/15 transition-colors"
        >
            <ExternalLink className="w-4 h-4" /> Open result
        </a>
    );
}
