import React from 'react';
import { ScrapeImagesConfig } from '../../types';

export default function ScrapeImagesProperties({ config, onUpdate }: { config: any, onUpdate: (config: any) => void }) {
    const scrapeConfig = config as ScrapeImagesConfig;
    const inputClass = "w-full px-3 py-2 border border-stroke-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-primary bg-surface-secondary text-content-primary";
    const labelClass = "block text-sm font-medium text-content-secondary mb-2";

    return (
        <>
            <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-sm text-content-secondary">
                <span className="font-semibold text-blue-400">Note:</span> Connect a <b>Text Input</b> node to the <b>Query</b> handle to set the search term.
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
}
