'use client';

import React, { useState, useRef, useCallback } from 'react';
import { ChevronDown, ChevronUp, Loader2, GripHorizontal } from 'lucide-react';
import MessageRenderer from '../chat/MessageRenderer';
import ImageLightbox from '../ui/ImageLightbox';
import { useAppStore } from '@/lib/store/app-store';

interface ResultsPanelProps {
    result: any;
    isExecuting: boolean;
    error?: string | null;
}

export default function ResultsPanel({ result, isExecuting, error }: ResultsPanelProps) {
    const [isExpanded, setIsExpanded] = useState(true);
    const [panelHeight, setPanelHeight] = useState(300); // Default height
    const [lightboxImages, setLightboxImages] = useState<{ url?: string; base64?: string }[] | null>(null);
    const [lightboxIndex, setLightboxIndex] = useState(0);
    const isDraggingRef = useRef(false);
    const startYRef = useRef(0);
    const startHeightRef = useRef(0);
    const panelRef = useRef<HTMLDivElement>(null);

    // Open lightbox handler
    const openLightbox = (images: any[], index: number) => {
        if (!isExecuting) {
            setLightboxImages(images);
            setLightboxIndex(index);
        }
    };

    // Get live streaming data from store
    const nodeOutputs = useAppStore((state) => state.nodeOutputs);
    const nodeStatuses = useAppStore((state) => state.nodeStatuses);
    const currentWorkflow = useAppStore((state) => state.currentWorkflow);

    // Get nodes in order for display
    const nodes = currentWorkflow?.nodes || [];

    // Count completed nodes
    const completedCount = Object.values(nodeStatuses).filter(s => s === 'success').length;
    const totalCount = nodes.length;

    // Drag handlers for resize
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        isDraggingRef.current = true;
        startYRef.current = e.clientY;
        startHeightRef.current = panelHeight;
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';

        const handleMouseMove = (e: MouseEvent) => {
            if (!isDraggingRef.current) return;
            const deltaY = startYRef.current - e.clientY;
            const newHeight = Math.max(100, Math.min(600, startHeightRef.current + deltaY));
            setPanelHeight(newHeight);
        };

        const handleMouseUp = () => {
            isDraggingRef.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [panelHeight]);

    if (!result && !isExecuting && !error && Object.keys(nodeOutputs).length === 0) {
        return null;
    }

    return (
        <div ref={panelRef} className="border-t border-gray-200 bg-white relative flex flex-col">
            {/* Resize handle - always interactive */}
            <div
                className="absolute -top-1 left-0 right-0 h-2 cursor-ns-resize z-30 group flex items-center justify-center"
                onMouseDown={handleMouseDown}
            >
                <div className="w-12 h-1 bg-gray-300 rounded-full group-hover:bg-purple-400 transition-colors" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200 shrink-0">
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                >
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                    <span>Results</span>
                    {isExecuting && (
                        <span className="text-xs text-purple-600 font-normal">
                            ({completedCount}/{totalCount} nodes)
                        </span>
                    )}
                </button>

                {/* Drag indicator */}
                <div className="flex items-center gap-1 text-gray-400">
                    <GripHorizontal className="w-4 h-4" />
                </div>
            </div>

            {/* Content with dynamic height */}
            {isExpanded && (
                <div
                    className="overflow-y-auto relative"
                    style={{ height: panelHeight }}
                >
                    {/* Disabled overlay during execution - but NOT over resize handle */}
                    {isExecuting && (
                        <div
                            className="absolute inset-0 bg-white/50 z-10 cursor-not-allowed"
                            style={{ pointerEvents: 'auto' }}
                        />
                    )}

                    <div className="p-4">
                        {/* Error state */}
                        {error && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                                <div className="flex items-start gap-3">
                                    <div className="flex-shrink-0 mt-0.5">
                                        <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                        </svg>
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="text-sm font-medium text-red-800">Execution Failed</h3>
                                        <p className="text-sm text-red-700 mt-1">{error}</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Live streaming node outputs */}
                        {nodes.length > 0 && (
                            <div className="space-y-3">
                                {nodes.map((node) => {
                                    const status = nodeStatuses[node.id];
                                    const output = nodeOutputs[node.id];
                                    const isRunning = status === 'running';
                                    const isSuccess = status === 'success';
                                    const isFailed = status === 'error';
                                    const isPending = status === 'pending' || !status;

                                    return (
                                        <div
                                            key={node.id}
                                            className={`rounded-lg border p-3 transition-all ${isRunning ? 'border-purple-300 bg-purple-50' :
                                                isSuccess ? 'border-green-200 bg-green-50/50' :
                                                    isFailed ? 'border-red-200 bg-red-50' :
                                                        'border-gray-200 bg-gray-50'
                                                }`}
                                        >
                                            {/* Node header */}
                                            <div className="flex items-center gap-2 mb-2">
                                                {/* Status indicator */}
                                                {isRunning && <Loader2 className="w-4 h-4 animate-spin text-purple-600" />}
                                                {isSuccess && (
                                                    <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                                    </svg>
                                                )}
                                                {isFailed && (
                                                    <svg className="w-4 h-4 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                                    </svg>
                                                )}
                                                {isPending && <div className="w-4 h-4 rounded-full border-2 border-gray-300" />}

                                                <span className={`text-sm font-medium ${isRunning ? 'text-purple-700' :
                                                    isSuccess ? 'text-green-700' :
                                                        isFailed ? 'text-red-700' :
                                                            'text-gray-500'
                                                    }`}>
                                                    {node.data?.label || node.type}
                                                </span>

                                                {/* Output count */}
                                                {output && Array.isArray(output) && (
                                                    <span className="text-xs text-gray-500">
                                                        ({output.length} items)
                                                    </span>
                                                )}
                                            </div>

                                            {/* Node output preview */}
                                            {output && (
                                                <div className={isExecuting ? 'pointer-events-none opacity-70' : ''}>
                                                    {Array.isArray(output) && output.length > 0 ? (
                                                        <div className="flex gap-1 flex-wrap max-h-20 overflow-hidden">
                                                            {output.slice(0, 6).map((item: any, idx: number) => (
                                                                <button
                                                                    key={idx}
                                                                    onClick={() => openLightbox(output, idx)}
                                                                    className="relative group cursor-pointer"
                                                                    disabled={isExecuting}
                                                                >
                                                                    {item.url || item.base64 ? (
                                                                        <>
                                                                            <img
                                                                                src={item.url || item.base64}
                                                                                alt={`Result ${idx + 1}`}
                                                                                className="w-12 h-12 object-cover rounded border border-gray-200 group-hover:border-purple-400 transition-colors"
                                                                            />
                                                                            {!isExecuting && (
                                                                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded transition-colors flex items-center justify-center">
                                                                                    <span className="text-white opacity-0 group-hover:opacity-100 text-xs font-medium">View</span>
                                                                                </div>
                                                                            )}
                                                                        </>
                                                                    ) : (
                                                                        <div className="w-12 h-12 bg-gray-100 rounded flex items-center justify-center text-xs text-gray-400">
                                                                            ?
                                                                        </div>
                                                                    )}
                                                                </button>
                                                            ))}
                                                            {output.length > 6 && (
                                                                <button
                                                                    onClick={() => openLightbox(output, 6)}
                                                                    className="w-12 h-12 bg-gray-100 rounded flex items-center justify-center text-xs text-gray-500 hover:bg-gray-200 transition-colors"
                                                                    disabled={isExecuting}
                                                                >
                                                                    +{output.length - 6}
                                                                </button>
                                                            )}
                                                        </div>
                                                    ) : typeof output === 'object' ? (
                                                        <p className="text-xs text-gray-500 truncate">
                                                            {JSON.stringify(output).slice(0, 50)}...
                                                        </p>
                                                    ) : null}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Final results (when complete) */}
                        {!isExecuting && result && !error && (
                            <div className="mt-4 pt-4 border-t border-gray-200">
                                <div className="flex items-center gap-2 text-sm text-gray-600 mb-3">
                                    <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                    </svg>
                                    <span className="font-medium text-green-800">Complete - Click images to view</span>
                                </div>
                                <MessageRenderer data={result} />
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Image Lightbox */}
            {lightboxImages && (
                <ImageLightbox
                    images={lightboxImages}
                    initialIndex={lightboxIndex}
                    onClose={() => setLightboxImages(null)}
                />
            )}
        </div>
    );
}
