'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Image as ImageIcon, Sparkles, RefreshCw, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import ImageLightbox from '@/components/ui/ImageLightbox';

interface AssetItem {
    id: string;
    source_result_id: string;
    node_id: string;
    result_type: 'image' | 'video' | 'audio' | '3d';
    result_url: string;
    created_at: string;
    execution_id: string;
}

interface AssetsPanelProps {
    sessionId?: string | null;
    onClose: () => void;
}

export function AssetsPanel({ sessionId, onClose }: AssetsPanelProps) {
    const [assets, setAssets] = useState<AssetItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const supabase = React.useMemo(() => createClient(), []);

    const unpackAssets = useCallback((rows: any[]): AssetItem[] => {
        const unpacked: AssetItem[] = [];
        const seenUrls = new Set<string>();

        rows.forEach((row) => {
            const type = row?.result_type as AssetItem['result_type'];
            if (!['image', 'video', 'audio', '3d'].includes(type)) return;

            const values = Array.isArray(row?.result_data) ? row.result_data : [];
            values.forEach((item: any, index: number) => {
                if (typeof item !== 'string') return;
                if (!(item.startsWith('http') || item.startsWith('data:'))) return;

                // Only add if we haven't seen this URL in this batch
                if (!seenUrls.has(item)) {
                    seenUrls.add(item);
                    unpacked.push({
                        id: `${row.id}:${index}`,
                        source_result_id: row.id,
                        node_id: row.node_id,
                        result_type: type,
                        result_url: item,
                        created_at: row.created_at,
                        execution_id: row.execution_id,
                    });
                }
            });
        });
        return unpacked;
    }, []);

    const fetchAssets = useCallback(async () => {
        if (!sessionId) {
            setIsLoading(false);
            return;
        }

        const { data, error } = await supabase
            .from('node_results')
            .select('id, node_id, result_type, result_data, created_at, execution_id')
            .eq('session_id', sessionId)
            .eq('status', 'completed')
            .in('result_type', ['image', 'video', 'audio', '3d'])
            .order('created_at', { ascending: false });

        if (!error && data) {
            const validAssets = unpackAssets(data);
            setAssets(validAssets);
        }
        setIsLoading(false);
    }, [sessionId, supabase, unpackAssets]);

    useEffect(() => {
        fetchAssets();
    }, [fetchAssets]);

    // Real-time: new results pop in as executions finish
    useEffect(() => {
        if (!sessionId) return;

        const channel = supabase
            .channel(`assets-panel-${sessionId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'node_results',
                    filter: `session_id=eq.${sessionId}`,
                },
                (payload: any) => {
                    const row = payload.new;
                    if (row?.status === 'completed' && ['image', 'video', 'audio', '3d'].includes(row?.result_type)) {
                        const nextItems = unpackAssets([row]);
                        if (nextItems.length === 0) return;

                        setAssets((prev) => {
                            const existingUrls = new Set(prev.map((a) => a.result_url));
                            const incoming = nextItems.filter((item) => !existingUrls.has(item.result_url));
                            if (incoming.length === 0) return prev;
                            return [...incoming, ...prev];
                        });
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [sessionId, supabase, unpackAssets]);

    const handleDragStart = (e: React.DragEvent, asset: AssetItem) => {
        const payload = JSON.stringify({
            type: 'media_input',
            // initialConfig is merged over the node factory defaults.
            // media_input.config.images is an array; we seed it with the asset URL.
            initialConfig: { images: [asset.result_url] },
        });
        e.dataTransfer.setData('application/reactflow', payload);
        e.dataTransfer.effectAllowed = 'copy';
    };


    return (
        <div className="w-full h-full bg-surface-elevated/80 backdrop-blur-md border border-stroke-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-stroke-subtle flex-shrink-0">
                <div className="flex items-center gap-2">
                    <div className="w-1 h-3 bg-accent-primary rounded-full" />
                    <h3 className="font-bold text-sm text-content-primary">Session Assets</h3>
                    {assets.length > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-accent-primary/15 text-accent-primary">
                            {assets.length}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={fetchAssets}
                        className="p-1.5 hover:bg-white/10 rounded-lg transition-colors group"
                        title="Refresh assets"
                    >
                        <RefreshCw className="w-3.5 h-3.5 text-content-tertiary group-hover:text-content-primary transition-colors" />
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-white/10 rounded-lg transition-colors group"
                    >
                        <X className="w-4 h-4 text-content-tertiary group-hover:text-content-primary" />
                    </button>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 p-8">
                        <div className="w-6 h-6 border-2 border-accent-primary/30 border-t-accent-primary rounded-full animate-spin" />
                        <p className="text-xs text-content-tertiary">Loading assets…</p>
                    </div>
                ) : assets.length === 0 ? (
                    <EmptyState />
                ) : (
                    <div className="p-3">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-content-tertiary mb-3 px-1">
                            Drag onto canvas to reuse
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            <AnimatePresence initial={false}>
                                {assets.map((asset, i) => (
                                    <AssetCard
                                        key={asset.id}
                                        asset={asset}
                                        index={i}
                                        onDragStart={handleDragStart}
                                    />
                                ))}
                            </AnimatePresence>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function AssetCard({
    asset,
    index,
    onDragStart,
}: {
    asset: AssetItem;
    index: number;
    onDragStart: (e: React.DragEvent, asset: AssetItem) => void;
}) {
    const [loaded, setLoaded] = useState(false);
    const [lightboxOpen, setLightboxOpen] = useState(false);

    const mediaType = asset.result_type === 'audio' ? 'any' : (asset.result_type === '3d' ? 'any' : asset.result_type);
    const showSkeleton = !loaded && (asset.result_type === 'image' || asset.result_type === 'video');

    return (
        <>
            <motion.div
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2, delay: index * 0.03 }}
                draggable
                onDragStart={(e) => onDragStart(e as unknown as React.DragEvent, asset)}
                onClick={() => setLightboxOpen(true)}
                className="relative aspect-square rounded-xl overflow-hidden border border-stroke-subtle bg-surface-primary cursor-pointer group hover:border-accent-primary/50 transition-all duration-200 shadow-sm hover:shadow-lg"
                title="Click to preview · Drag to canvas"
            >
                {showSkeleton && (
                    <div className="absolute inset-0 bg-surface-secondary animate-pulse" />
                )}

                {asset.result_type === 'video' ? (
                    <video
                        src={asset.result_url}
                        className={`w-full h-full object-cover transition-all duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
                        onLoadedData={() => setLoaded(true)}
                        muted
                        playsInline
                    />
                ) : asset.result_type === 'audio' ? (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-black/40 text-white/80 p-2">
                        <span className="text-[9px] font-semibold uppercase tracking-wider mb-2">Audio</span>
                        <audio src={asset.result_url} controls className="w-full" onLoadedData={() => setLoaded(true)} />
                    </div>
                ) : asset.result_type === '3d' ? (
                    <div className="w-full h-full flex items-center justify-center bg-black/40 text-white/80 p-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider">3D Model</span>
                    </div>
                ) : (
                    <img
                        src={asset.result_url}
                        alt="Generated asset"
                        className={`w-full h-full object-cover transition-all duration-500 ${loaded ? 'opacity-100 blur-0' : 'opacity-0 blur-sm'}`}
                        onLoad={() => setLoaded(true)}
                    />
                )}

                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-200 flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/60 rounded-lg px-2 py-1">
                        <span className="text-[9px] font-bold text-white uppercase tracking-wider">View / Drag</span>
                    </div>
                </div>
            </motion.div>

            {lightboxOpen && (
                <ImageLightbox
                    media={asset.result_url}
                    type={mediaType as any}
                    initialIndex={0}
                    onClose={() => setLightboxOpen(false)}
                />
            )}
        </>
    );
}

function EmptyState() {
    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center h-full gap-5 p-8 text-center"
        >
            {/* Animated icon cluster */}
            <div className="relative w-16 h-16">
                <div className="absolute inset-0 rounded-2xl bg-accent-primary/5 border border-accent-primary/10" />
                <div className="absolute inset-0 flex items-center justify-center">
                    <ImageIcon className="w-7 h-7 text-content-tertiary/50" />
                </div>
                <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-surface-elevated border border-stroke-subtle flex items-center justify-center">
                    <Sparkles className="w-2.5 h-2.5 text-accent-primary/60" />
                </div>
            </div>

            <div className="space-y-2">
                <p className="text-sm font-semibold text-content-secondary">
                    Nothing here yet
                </p>
                <p className="text-xs text-content-tertiary leading-relaxed max-w-[180px]">
                    Run your workflow and every output will land here — ready to drag right back onto the canvas.
                </p>
            </div>
        </motion.div>
    );
}
