'use client';

import React from 'react';
import Link from 'next/link';
import {
    Play,
    ChevronLeft,
    Activity,
    Zap,
    Maximize2,
    Volume2,
    Settings,
    Shield
} from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { cn } from '@/lib/utils';

export default function DemoPage() {
    return (
        <div className="relative min-h-screen w-full flex flex-col items-center bg-bg-primary font-sans mesh-gradient hud-grid selection:bg-accent-primary/30">
            {/* Background floating elements */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute top-[-10%] right-[-5%] w-[50vw] h-[50vw] bg-accent-primary/10 blur-[150px] rounded-full animate-float opacity-50" />
                <div className="absolute bottom-[-10%] left-[-5%] w-[40vw] h-[40vw] bg-accent-secondary/5 blur-[120px] rounded-full animate-float opacity-30" style={{ animationDelay: '-8s' }} />
            </div>

            <div className="relative z-10 w-full flex flex-col items-center">
                {/* ─── Navigation ─────────────────────────────────────────── */}
                <nav className="w-full max-w-7xl px-8 py-10 flex justify-between items-center animate-fade-in">
                    <Link href="/" className="group flex items-center gap-3 px-5 py-2.5 rounded-xl glassmorphism border-accent-primary/10 hover:border-accent-primary/30 transition-all">
                        <ChevronLeft className="w-4 h-4 text-accent-primary group-hover:-translate-x-1 transition-transform" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-content-secondary group-hover:text-content-primary">Terminal / Home</span>
                    </Link>

                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-500/10 border border-green-500/20">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-green-500">System: Operational</span>
                        </div>
                    </div>
                </nav>

                {/* ─── Hero Content (Reduced Padding) ────────────────────────── */}
                <header className="w-full max-w-7xl px-8 pt-8 pb-12 text-center space-y-6 animate-fade-in" style={{ animationDelay: '0.2s' }}>
                    <div className="inline-flex items-center gap-3 px-6 py-2 rounded-full glassmorphism border-accent-primary/20 mb-2">
                        <Zap className="w-4 h-4 text-accent-primary animate-pulse" />
                        <span className="text-[10px] font-black tracking-[0.3em] text-accent-primary uppercase">Experience Engine v4.0</span>
                    </div>

                    <h1 className="text-5xl md:text-7xl lg:text-8xl font-black tracking-tighter text-content-primary font-display uppercase leading-none">
                        Cinematic <span className="text-accent-primary italic">Vision</span>
                    </h1>

                    <p className="text-lg md:text-xl text-content-secondary/60 max-w-2xl mx-auto font-medium leading-relaxed">
                        Interface with the next generation of visual orchestration. High-fidelity throughput for neural workflow projection.
                    </p>
                </header>

                {/* Cinematic Video Theater Section ─────────────────────────── */}
                <section className="w-full max-w-[90rem] px-4 pb-24 animate-fade-in" style={{ animationDelay: '0.4s' }}>
                    <div className="relative group p-1.5 rounded-[2.5rem] bg-gradient-to-br from-accent-primary/30 via-accent-secondary/5 to-transparent shadow-[0_0_120px_-20px_rgba(6,182,212,0.4)]">
                        <GlassCard className="p-4 rounded-[2.2rem] overflow-hidden border-white/5 backdrop-blur-3xl" hoverIntensity="low">
                            <div className="relative aspect-video rounded-[1.8rem] overflow-hidden bg-bg-secondary/80 flex items-center justify-center border border-white/5 shadow-2xl">
                                <video
                                    className="w-full h-full object-cover rounded-[1.8rem]"
                                    src="https://wyqkbwpybqokmtlghdsr.supabase.co/storage/v1/object/public/chat-assets/demo.mp4"
                                    autoPlay
                                    loop
                                    muted
                                    playsInline
                                    controls
                                />

                                {/* Subtle HUD Overlay for Cinematic Feel */}
                                <div className="absolute inset-x-0 bottom-0 p-8 z-10 pointer-events-none flex justify-between items-end bg-gradient-to-t from-bg-primary/40 to-transparent">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-full border border-accent-primary/20 flex items-center justify-center backdrop-blur-sm">
                                            <Activity className="w-5 h-5 text-accent-primary" />
                                        </div>
                                        <div className="text-[10px] font-black uppercase tracking-[0.4em] text-accent-primary/60">PRISFOL VISION FEED</div>
                                    </div>
                                    <div className="text-[10px] font-mono text-accent-primary/30">L_ID: 0x889AF // LIVE_OPS</div>
                                </div>
                            </div>
                        </GlassCard>
                    </div>
                </section>

                {/* ─── Terminal Info Footer ─────────────────────────────────── */}
                <footer className="mt-auto w-full max-w-7xl px-12 py-16 flex flex-col md:flex-row justify-between items-center gap-8 border-t border-white/5 text-[10px] font-black tracking-[0.5em] text-content-tertiary uppercase animate-fade-in" style={{ animationDelay: '0.6s' }}>
                    <div className="flex items-center gap-6">
                        <span className="text-accent-primary/40">© 2026 PRISFOL VISION</span>
                        <div className="w-1 h-1 rounded-full bg-white/10" />
                        <span>Ready to Stream</span>
                    </div>
                    <div className="flex gap-12">
                        <Link href="/chat" className="hover:text-accent-primary transition-colors">Start Engine</Link>
                        <Link href="/nodes" className="hover:text-accent-primary transition-colors">Nodes Catalog</Link>
                    </div>
                </footer>
            </div>
        </div>
    );
}
