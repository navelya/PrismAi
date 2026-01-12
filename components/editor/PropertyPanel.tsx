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
    const inputClass = "w-full px-3 py-2 border border-stroke-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-primary bg-surface-secondary text-content-primary";
    const labelClass = "block text-sm font-medium text-content-secondary mb-2";

    const renderForm = () => {
        switch (nodeType) {
            case 'scrape_images':
                const scrapeConfig = config as ScrapeImagesConfig;
                return (
                    <>
                        <div>
                            <label className={labelClass}>Search Term</label>
                            <input
                                type="text"
                                value={scrapeConfig.searchTerm}
                                onChange={(e) => onUpdate({ ...scrapeConfig, searchTerm: e.target.value })}
                                className={inputClass}
                                placeholder="e.g., sunset, logo, product"
                            />
                        </div>
                        <div>
                            <label className={labelClass}>Limit</label>
                            <input
                                type="number"
                                value={scrapeConfig.limit}
                                onChange={(e) => onUpdate({ ...scrapeConfig, limit: parseInt(e.target.value) || 0 })}
                                className={inputClass}
                                min="1"
                                max="100"
                            />
                        </div>

                        {/* Advanced Options */}
                        <div className="pt-2 border-t border-stroke-subtle">
                            <div className="text-xs font-semibold text-content-tertiary uppercase tracking-wide mb-3">Advanced Options</div>

                            <div>
                                <label className={labelClass}>
                                    Source Websites (optional)
                                    <span className="text-xs text-content-tertiary ml-1">comma-separated</span>
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
                                    className={inputClass}
                                    placeholder="e.g., nike.com, pinterest.com"
                                />
                            </div>

                            <div>
                                <label className={labelClass}>Image Size</label>
                                <select
                                    value={scrapeConfig.imageSize || 'any'}
                                    onChange={(e) => onUpdate({ ...scrapeConfig, imageSize: e.target.value as any })}
                                    className={inputClass}
                                >
                                    <option value="any">Any Size</option>
                                    <option value="small">Small</option>
                                    <option value="medium">Medium</option>
                                    <option value="large">Large</option>
                                    <option value="xlarge">Extra Large</option>
                                </select>
                            </div>

                            <div>
                                <label className={labelClass}>Image Type</label>
                                <select
                                    value={scrapeConfig.imageType || 'any'}
                                    onChange={(e) => onUpdate({ ...scrapeConfig, imageType: e.target.value as any })}
                                    className={inputClass}
                                >
                                    <option value="any">Any Type</option>
                                    <option value="photo">Photo</option>
                                    <option value="clipart">Clipart</option>
                                    <option value="lineart">Line Art</option>
                                    <option value="face">Face</option>
                                </select>
                            </div>

                            <div>
                                <label className={labelClass}>Color Type</label>
                                <select
                                    value={scrapeConfig.colorType || 'any'}
                                    onChange={(e) => onUpdate({ ...scrapeConfig, colorType: e.target.value as any })}
                                    className={inputClass}
                                >
                                    <option value="any">Any Color</option>
                                    <option value="color">Color</option>
                                    <option value="gray">Grayscale</option>
                                    <option value="mono">Monochrome</option>
                                </select>
                            </div>

                            <div>
                                <label className={labelClass}>Safe Search</label>
                                <select
                                    value={scrapeConfig.safeSearch || 'medium'}
                                    onChange={(e) => onUpdate({ ...scrapeConfig, safeSearch: e.target.value as any })}
                                    className={inputClass}
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
                        <label className={labelClass}>Output Format</label>
                        <select
                            value={bgConfig.format || 'png'}
                            onChange={(e) => onUpdate({ ...bgConfig, format: e.target.value as 'png' | 'webp' })}
                            className={inputClass}
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
                            <label className={labelClass}>Criteria</label>
                            <select
                                value={sortConfig.criteria}
                                onChange={(e) => onUpdate({ ...sortConfig, criteria: e.target.value as any })}
                                className={inputClass}
                            >
                                <option value="resolution">Resolution</option>
                                <option value="size">Size</option>
                                <option value="format">Format</option>
                            </select>
                        </div>
                        <div>
                            <label className={labelClass}>Order</label>
                            <select
                                value={sortConfig.order}
                                onChange={(e) => onUpdate({ ...sortConfig, order: e.target.value as 'asc' | 'desc' })}
                                className={inputClass}
                            >
                                <option value="asc">Ascending</option>
                                <option value="desc">Descending</option>
                            </select>
                        </div>
                        {sortConfig.limit !== undefined && (
                            <div>
                                <label className={labelClass}>Limit (optional)</label>
                                <input
                                    type="number"
                                    value={sortConfig.limit || ''}
                                    onChange={(e) => onUpdate({ ...sortConfig, limit: parseInt(e.target.value) || undefined })}
                                    className={inputClass}
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
                            <label className={labelClass}>Prompt</label>
                            <textarea
                                value={aiConfig.prompt}
                                onChange={(e) => onUpdate({ ...aiConfig, prompt: e.target.value })}
                                className={inputClass}
                                rows={3}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>Aspect Ratio</label>
                            <select
                                value={aiConfig.aspectRatio || '1:1'}
                                onChange={(e) => onUpdate({ ...aiConfig, aspectRatio: e.target.value as any })}
                                className={inputClass}
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
                        <label className={labelClass}>Upscale Factor</label>
                        <select
                            value={upscaleConfig.scale || 4}
                            onChange={(e) => onUpdate({ ...upscaleConfig, scale: parseInt(e.target.value) as 2 | 3 | 4 | 8 })}
                            className={inputClass}
                        >
                            <option value={2}>2x (Double Size)</option>
                            <option value={3}>3x (Triple Size)</option>
                            <option value={4}>4x (Quadruple Size)</option>
                            <option value={8}>8x (Ultra Super Resolution)</option>
                        </select>
                        <p className="text-xs text-content-tertiary mt-2">
                            Higher scale = better quality but slower processing
                        </p>
                    </div>
                );

            default:
                return <p className="text-content-secondary">No properties available</p>;
        }
    };

    return (
        <div className="w-80 bg-surface-primary border-l border-stroke-subtle p-4 space-y-4 overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-stroke-subtle">
                <h3 className="font-semibold text-content-primary">Properties</h3>
                <button
                    onClick={onClose}
                    className="p-1 hover:bg-surface-secondary rounded transition-colors"
                >
                    <X className="w-5 h-5 text-content-secondary" />
                </button>
            </div>

            {/* Node Info */}
            <div className="bg-surface-secondary rounded-lg p-3">
                <div className="text-xs text-content-tertiary uppercase tracking-wide">Node ID</div>
                <div className="text-sm font-mono text-content-primary mt-1">{nodeId.substring(0, 8)}...</div>
            </div>

            {/* Form Fields */}
            <div className="space-y-4">
                {renderForm()}
            </div>
        </div>
    );
}
