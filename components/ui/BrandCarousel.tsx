'use client';

import React from 'react';

// Colored provider marks. Favicons are full-color; we sit each on a small light
// tile so dark/transparent marks stay visible on the dark canvas.
const BRANDS = [
    { name: 'OpenAI', logo: 'https://www.google.com/s2/favicons?domain=openai.com&sz=128' },
    { name: 'Google Gemini', logo: 'https://www.google.com/s2/favicons?domain=gemini.google.com&sz=128' },
    { name: 'ByteDance', logo: 'https://www.google.com/s2/favicons?domain=bytedance.com&sz=128' },
    { name: 'Runway', logo: 'https://www.google.com/s2/favicons?domain=runwayml.com&sz=128' },
    { name: 'Black Forest Labs', logo: 'https://www.google.com/s2/favicons?domain=blackforestlabs.ai&sz=128' },
    { name: 'Kling', logo: 'https://www.google.com/s2/favicons?domain=klingai.com&sz=128' },
    { name: 'ElevenLabs', logo: 'https://www.google.com/s2/favicons?domain=elevenlabs.io&sz=128' },
];

export const BrandCarousel = () => {
    const blockBrands = [...BRANDS, ...BRANDS, ...BRANDS];

    const Item = ({ brand, k }: { brand: typeof BRANDS[number]; k: string }) => (
        <div key={k} className="flex items-center gap-3.5 opacity-90 hover:opacity-100 transition-opacity duration-500 cursor-default">
            {brand.logo && (
                <span className="h-9 w-9 shrink-0 grid place-items-center rounded-lg bg-white/95 shadow-sm overflow-hidden">
                    <img src={brand.logo} alt={brand.name} className="h-5 w-5 object-contain" />
                </span>
            )}
            <span className="text-xl font-black tracking-tighter text-white font-display uppercase whitespace-nowrap">{brand.name}</span>
        </div>
    );

    return (
        <div className="w-full max-w-7xl mx-auto px-8 py-12 flex flex-col items-center">
            <p className="text-xs font-medium tracking-[0.18em] uppercase text-content-tertiary mb-10 text-center">Access the best AI models</p>

            <div className="w-full relative group overflow-hidden">
                {/* Edge Fades */}
                <div className="absolute inset-y-0 left-0 w-40 bg-gradient-to-r from-surface-primary to-transparent z-10 pointer-events-none" />
                <div className="absolute inset-y-0 right-0 w-40 bg-gradient-to-l from-surface-primary to-transparent z-10 pointer-events-none" />

                {/* THE INFINITE TRACK */}
                <div className="flex animate-infinite-scroll w-max hover:[animation-play-state:paused]">
                    <div className="flex items-center gap-16 px-8">
                        {blockBrands.map((brand, idx) => <Item key={`b1-${idx}`} k={`b1-${idx}`} brand={brand} />)}
                    </div>
                    <div className="flex items-center gap-16 px-8">
                        {blockBrands.map((brand, idx) => <Item key={`b2-${idx}`} k={`b2-${idx}`} brand={brand} />)}
                    </div>
                </div>
            </div>
        </div>
    );
};
