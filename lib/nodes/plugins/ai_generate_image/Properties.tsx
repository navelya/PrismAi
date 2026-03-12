import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { AIGenerateImageConfig } from '../../types';

export default function AIGenerateImageProperties({ config, onUpdate }: { config: any, onUpdate: (config: any) => void }) {
    const aiConfig = config as AIGenerateImageConfig;

    const aspectRatios = [
        { id: '1:1', display_name: '1:1 (Square)' },
        { id: '16:9', display_name: '16:9 (Widescreen)' },
        { id: '4:3', display_name: '4:3 (Standard)' },
    ];

    const models = [
        { id: 'gemini-2.5-flash-image', display_name: 'Gemini 2.5 Flash (Nano Banana)' },
        { id: 'gemini-3-pro-image-preview', display_name: 'Gemini 3 Pro (Nano Banana Pro)' },
        { id: 'pollinations', display_name: 'Pollinations.ai' },
        { id: 'huggingface', display_name: 'Stable Diffusion XL (Hugging Face)' },
    ];

    return (
        <div className="space-y-5">
            <Select
                label="Model"
                value={aiConfig.model || 'gemini'}
                options={models}
                onChange={(e) => onUpdate({ ...aiConfig, model: e.target.value })}
            />

            <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-[10px] text-content-secondary leading-relaxed font-medium">
                <span className="font-bold text-blue-400 uppercase tracking-wider block mb-1">Architecture Note</span>
                Connect a <b className="text-content-primary">Text Input</b> node to the <b className="text-content-primary">Prompt</b> handle to provide the generation prompt.
            </div>

            <Select
                label="Aspect Ratio"
                value={aiConfig.aspectRatio || '1:1'}
                options={aspectRatios}
                onChange={(e) => onUpdate({ ...aiConfig, aspectRatio: e.target.value })}
            />
        </div>
    );
}
