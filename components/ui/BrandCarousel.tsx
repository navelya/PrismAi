'use client';

import React from 'react';

const BRANDS = [
    { name: 'OpenAI', logo: 'https://cdn.simpleicons.org/openai/white' },
    { name: 'Google Gemini', logo: 'https://cdn.simpleicons.org/google/white' },
    { name: 'Runway', logo: 'https://www.google.com/s2/favicons?domain=runwayml.com&sz=128' },
    { name: 'Black Forest Labs', logo: 'https://www.google.com/s2/favicons?domain=blackforestlabs.ai&sz=128' },
    { name: 'Kling', logo: 'https://www.google.com/s2/favicons?domain=klingai.com&sz=128' },
    { name: 'ElevenLabs', logo: 'https://www.google.com/s2/favicons?domain=elevenlabs.io&sz=128' },
];

export const BrandCarousel = () => {
    // Multiply the array so each block is guaranteed to be wider than the container
    const blockBrands = [...BRANDS, ...BRANDS, ...BRANDS];

    return (
        <div className="w-full max-w-7xl mx-auto px-8 py-12 flex flex-col items-center">
            <p className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400 mb-10 text-center">ACCESS THE BEST AI MODELS</p>
            
            <div className="w-full relative group overflow-hidden">
                {/* Edge Fades */}
                <div className="absolute inset-y-0 left-0 w-40 bg-gradient-to-r from-slate-900 to-transparent z-10 pointer-events-none" />
                <div className="absolute inset-y-0 right-0 w-40 bg-gradient-to-l from-slate-900 to-transparent z-10 pointer-events-none" />

                {/* THE INFINITE TRACK */}
                <div className="flex animate-infinite-scroll w-max hover:[animation-play-state:paused]">
                    {/* Block 1 */}
                    <div className="flex items-center gap-16 px-8">
                        {blockBrands.map((brand, idx) => (
                            <div key={`b1-${idx}`} className="flex items-center gap-4 grayscale opacity-40 hover:grayscale-0 hover:opacity-100 transition-all duration-700 cursor-default">
                                {brand.logo && <img src={brand.logo} alt={brand.name} className="h-7 w-auto object-contain" />}
                                <span className="text-xl font-black tracking-tighter text-white font-display uppercase whitespace-nowrap">{brand.name}</span>
                            </div>
                        ))}
                    </div>
                    
                    {/* Block 2 (Exact Replica for Seamless Loop) */}
                    <div className="flex items-center gap-16 px-8">
                        {blockBrands.map((brand, idx) => (
                            <div key={`b2-${idx}`} className="flex items-center gap-4 grayscale opacity-40 hover:grayscale-0 hover:opacity-100 transition-all duration-700 cursor-default">
                                {brand.logo && <img src={brand.logo} alt={brand.name} className="h-7 w-auto object-contain" />}
                                <span className="text-xl font-black tracking-tighter text-white font-display uppercase whitespace-nowrap">{brand.name}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
