import React from 'react';
import { RemoveBackgroundConfig } from '../../types';

export default function RemoveBackgroundProperties({ config, onUpdate }: { config: any, onUpdate: (config: any) => void }) {
    const bgConfig = config as RemoveBackgroundConfig;
    const inputClass = "w-full px-3 py-2 border border-stroke-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-primary bg-surface-secondary text-content-primary";
    const labelClass = "block text-sm font-medium text-content-secondary mb-2";

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
}
