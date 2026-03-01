import React from 'react';
import { AIGenerateImageConfig } from '../../types';

export default function AIGenerateImageProperties({ config, onUpdate }: { config: any, onUpdate: (config: any) => void }) {
    const aiConfig = config as AIGenerateImageConfig;
    const inputClass = "w-full px-3 py-2 border border-stroke-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-primary bg-surface-secondary text-content-primary";
    const labelClass = "block text-sm font-medium text-content-secondary mb-2";

    return (
        <>
            <div>
                <label className={labelClass}>Model</label>
                <select
                    value={aiConfig.model || 'gemini'}
                    onChange={(e) => onUpdate({ ...aiConfig, model: e.target.value as any })}
                    className={inputClass}
                >
                    <option value="gemini-2.5-flash-image">Gemini 2.5 Flash (Nano Banana)</option>
                    <option value="gemini-3-pro-image-preview">Gemini 3 Pro (Nano Banana Pro)</option>
                    <option value="pollinations">Pollinations.ai</option>
                    <option value="huggingface">Stable Diffusion XL (Hugging Face)</option>
                </select>
            </div>
            <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-sm text-content-secondary">
                <span className="font-semibold text-blue-400">Note:</span> Connect a <b>Text Input</b> node to the <b>Prompt</b> handle to provide the generation prompt.
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
}
