'use client';

import React from 'react';
import { X } from 'lucide-react';
import { NodeConfig, ScrapeImagesConfig, RemoveBackgroundConfig, FilterSortConfig, AIGenerateImageConfig, UpscaleImageConfig } from '@/lib/nodes/types';

interface PropertyPanelProps {
    nodeId: string;
    nodeType: string;
    config: NodeConfig;
    onUpdate: (config: NodeConfig) => void;
    onClose: () => void;
}

export default function PropertyPanel({ nodeId, nodeType, config, onUpdate, onClose }: PropertyPanelProps) {
    const renderForm = () => {
        switch (nodeType) {
            case 'scrape_images':
                const scrapeConfig = config as ScrapeImagesConfig;
                return (
                    <>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Search Term</label>
                            <input
                                type="text"
                                value={scrapeConfig.searchTerm}
                                onChange={(e) => onUpdate({ ...scrapeConfig, searchTerm: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                placeholder="e.g., sunset, logo, product"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Limit</label>
                            <input
                                type="number"
                                value={scrapeConfig.limit}
                                onChange={(e) => onUpdate({ ...scrapeConfig, limit: parseInt(e.target.value) || 0 })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                min="1"
                                max="100"
                            />
                        </div>

                        {/* Advanced Options */}
                        <div className="pt-2 border-t border-gray-200">
                            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Advanced Options</div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Source Websites (optional)
                                    <span className="text-xs text-gray-500 ml-1">comma-separated</span>
                                </label>
                                <input
                                    type="text"
                                    value={(scrapeConfig.sources || []).join(', ')}
                                    onChange={(e) => {
                                        const sources = e.target.value
                                            .split(',')
                                            .map(s => s.trim())
                                            .filter(s => s.length > 0);
                                        onUpdate({ ...scrapeConfig, sources: sources.length > 0 ? sources : undefined });
                                    }}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    placeholder="e.g., nike.com, pinterest.com"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Image Size</label>
                                <select
                                    value={scrapeConfig.imageSize || 'any'}
                                    onChange={(e) => onUpdate({ ...scrapeConfig, imageSize: e.target.value as any })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                >
                                    <option value="any">Any Size</option>
                                    <option value="small">Small</option>
                                    <option value="medium">Medium</option>
                                    <option value="large">Large</option>
                                    <option value="xlarge">Extra Large</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Image Type</label>
                                <select
                                    value={scrapeConfig.imageType || 'any'}
                                    onChange={(e) => onUpdate({ ...scrapeConfig, imageType: e.target.value as any })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                >
                                    <option value="any">Any Type</option>
                                    <option value="photo">Photo</option>
                                    <option value="clipart">Clipart</option>
                                    <option value="lineart">Line Art</option>
                                    <option value="face">Face</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Color Type</label>
                                <select
                                    value={scrapeConfig.colorType || 'any'}
                                    onChange={(e) => onUpdate({ ...scrapeConfig, colorType: e.target.value as any })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                >
                                    <option value="any">Any Color</option>
                                    <option value="color">Color</option>
                                    <option value="gray">Grayscale</option>
                                    <option value="mono">Monochrome</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Safe Search</label>
                                <select
                                    value={scrapeConfig.safeSearch || 'medium'}
                                    onChange={(e) => onUpdate({ ...scrapeConfig, safeSearch: e.target.value as any })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                >
                                    <option value="off">Off</option>
                                    <option value="medium">Medium</option>
                                    <option value="high">High</option>
                                </select>
                            </div>
                        </div>
                    </>
                );

            case 'remove_background':
                const bgConfig = config as RemoveBackgroundConfig;
                return (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Output Format</label>
                        <select
                            value={bgConfig.format || 'png'}
                            onChange={(e) => onUpdate({ ...bgConfig, format: e.target.value as 'png' | 'webp' })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                        >
                            <option value="png">PNG</option>
                            <option value="webp">WebP</option>
                        </select>
                    </div>
                );

            case 'filter_sort':
                const sortConfig = config as FilterSortConfig;
                return (
                    <>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Criteria</label>
                            <select
                                value={sortConfig.criteria}
                                onChange={(e) => onUpdate({ ...sortConfig, criteria: e.target.value as any })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                            >
                                <option value="resolution">Resolution</option>
                                <option value="size">Size</option>
                                <option value="format">Format</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Order</label>
                            <select
                                value={sortConfig.order}
                                onChange={(e) => onUpdate({ ...sortConfig, order: e.target.value as 'asc' | 'desc' })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                            >
                                <option value="asc">Ascending</option>
                                <option value="desc">Descending</option>
                            </select>
                        </div>
                        {sortConfig.limit !== undefined && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Limit (optional)</label>
                                <input
                                    type="number"
                                    value={sortConfig.limit || ''}
                                    onChange={(e) => onUpdate({ ...sortConfig, limit: parseInt(e.target.value) || undefined })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    placeholder="No limit"
                                />
                            </div>
                        )}
                    </>
                );

            case 'ai_generate_image':
                const aiConfig = config as AIGenerateImageConfig;
                return (
                    <>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Prompt</label>
                            <textarea
                                value={aiConfig.prompt}
                                onChange={(e) => onUpdate({ ...aiConfig, prompt: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                rows={3}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Aspect Ratio</label>
                            <select
                                value={aiConfig.aspectRatio || '1:1'}
                                onChange={(e) => onUpdate({ ...aiConfig, aspectRatio: e.target.value as any })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                            >
                                <option value="1:1">1:1 (Square)</option>
                                <option value="16:9">16:9 (Widescreen)</option>
                                <option value="4:3">4:3 (Standard)</option>
                            </select>
                        </div>
                    </>
                );

            case 'upscale_image':
                const upscaleConfig = config as UpscaleImageConfig;
                return (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Upscale Factor</label>
                        <select
                            value={upscaleConfig.scale || 4}
                            onChange={(e) => onUpdate({ ...upscaleConfig, scale: parseInt(e.target.value) as 2 | 3 | 4 | 8 })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                        >
                            <option value={2}>2x (Double Size)</option>
                            <option value={3}>3x (Triple Size)</option>
                            <option value={4}>4x (Quadruple Size)</option>
                            <option value={8}>8x (Ultra Super Resolution)</option>
                        </select>
                        <p className="text-xs text-gray-500 mt-2">
                            Higher scale = better quality but slower processing
                        </p>
                    </div>
                );

            default:
                return <p className="text-gray-500">No properties available</p>;
        }
    };

    return (
        <div className="w-80 bg-white border-l border-gray-200 p-4 space-y-4 overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-gray-200">
                <h3 className="font-semibold text-gray-900">Properties</h3>
                <button
                    onClick={onClose}
                    className="p-1 hover:bg-gray-100 rounded transition-colors"
                >
                    <X className="w-5 h-5 text-gray-500" />
                </button>
            </div>

            {/* Node Info */}
            <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500 uppercase tracking-wide">Node ID</div>
                <div className="text-sm font-mono text-gray-700 mt-1">{nodeId.substring(0, 8)}...</div>
            </div>

            {/* Form Fields */}
            <div className="space-y-4">
                {renderForm()}
            </div>
        </div>
    );
}
