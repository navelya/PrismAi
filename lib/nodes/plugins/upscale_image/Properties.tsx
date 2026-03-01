import React from 'react';
import { UpscaleImageConfig } from '../../types';

export default function UpscaleImageProperties({ config, onUpdate }: { config: any, onUpdate: (config: any) => void }) {
    const upscaleConfig = config as UpscaleImageConfig;
    const inputClass = "w-full px-3 py-2 border border-stroke-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-primary bg-surface-secondary text-content-primary";
    const labelClass = "block text-sm font-medium text-content-secondary mb-2";

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
}
