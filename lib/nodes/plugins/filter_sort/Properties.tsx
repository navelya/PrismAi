import React from 'react';
import { FilterSortConfig } from '../../types';

export default function FilterSortProperties({ config, onUpdate }: { config: any, onUpdate: (config: any) => void }) {
    const sortConfig = config as FilterSortConfig;
    const inputClass = "w-full px-3 py-2 border border-stroke-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-primary bg-surface-secondary text-content-primary";
    const labelClass = "block text-sm font-medium text-content-secondary mb-2";

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
}
