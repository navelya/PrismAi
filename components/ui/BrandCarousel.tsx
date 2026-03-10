'use client';

import React from 'react';

const BRANDS = [
    { name: 'OpenAI', logo: 'OpenAI' },
    { name: 'Anthropic', logo: 'Anthropic' },
    { name: 'Google Gemini', logo: 'Google' },
    { name: 'Meta Llama', logo: 'Meta' },
    { name: 'Mistral AI', logo: 'Mistral' },
    { name: 'Stability AI', logo: 'Stability' },
];

export const BrandCarousel = () => {
    return (
        <div className="w-full overflow-hidden bg-bg-primary/50 py-12 border-y border-white/5 relative group">
            {/* Blurring Edges */}
            <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-bg-primary to-transparent z-10 pointer-events-none" />
            <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-bg-primary to-transparent z-10 pointer-events-none" />

            <div className="flex animate-infinite-scroll whitespace-nowrap gap-16 items-center">
                {[...BRANDS, ...BRANDS].map((brand, idx) => (
                    <div
                        key={idx}
                        className="flex items-center gap-3 grayscale opacity-30 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-700 cursor-default"
                    >
                        <div className="w-8 h-8 rounded-lg bg-accent-primary/10 border border-accent-primary/20 flex items-center justify-center font-black text-xs text-accent-primary">
                            {brand.logo[0]}
                        </div>
                        <span className="text-xl font-black tracking-tighter text-content-primary">
                            {brand.name.toUpperCase()}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};
