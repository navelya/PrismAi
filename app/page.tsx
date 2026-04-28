'use client';

import React from 'react';
import Link from 'next/link';
import {
    Command,
    Cpu,
    Workflow,
    Layers,
    Shield,
    Zap,
    Globe,
    Activity,
    Terminal,
    Play,
    ArrowRight,
    ChevronRight,
    Target
} from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { BrandCarousel } from '@/components/ui/BrandCarousel';
import { useSession } from '@/lib/hooks/use-session';
import { cn } from '@/lib/utils';

// =============================================================================
// REUSABLE SUB-COMPONENTS
// =============================================================================

const PrisfolLogo = ({ className }: { className?: string }) => (
    <div className={cn("flex items-center gap-2", className)}>
        <div className="relative w-8 h-8">
            <div className="absolute inset-0 bg-accent-primary transform rotate-45 rounded-sm opacity-20 animate-pulse" />
            <div className="absolute inset-1 border-2 border-accent-primary transform rotate-45 rounded-sm shadow-[0_0_15px_rgba(6,182,212,0.5)]" />
            <div className="absolute inset-[10px] bg-accent-secondary rounded-full" />
        </div>
        <span className="text-xl font-black tracking-tighter text-content-primary font-display">Prisfol</span>
    </div>
);

const SectionHeader = ({ tag, title, description }: { tag: string, title: string, description?: string }) => (
    <div className="mb-16 space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-accent-primary/10 border border-accent-primary/20">
            <div className="w-1.5 h-1.5 rounded-full bg-accent-primary animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-accent-primary">{tag}</span>
        </div>
        <h2 className="text-4xl md:text-6xl font-black text-content-primary leading-tight uppercase font-display max-w-4xl">
            {title}
        </h2>
        {description && (
            <p className="text-xl text-content-secondary max-w-2xl leading-relaxed font-medium">
                {description}
            </p>
        )}
    </div>
);

// =============================================================================
// MAIN HOME PAGE
// =============================================================================

export default function Home() {
    const { createNewSession, isLoading } = useSession();

    return (
        <div className="relative w-full h-full overflow-y-auto overflow-x-hidden bg-bg-primary font-sans custom-scrollbar select-none mesh-gradient hud-grid">
            {/* Background elements that flow with the page */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute top-[10%] left-[5%] w-[40vw] h-[40vw] bg-accent-primary/5 blur-[120px] rounded-full animate-float" />
                <div className="absolute bottom-[10%] right-[5%] w-[35vw] h-[35vw] bg-accent-secondary/5 blur-[120px] rounded-full animate-float" style={{ animationDelay: '-5s' }} />
            </div>

            <div className="relative z-10 w-full flex flex-col items-center">
                {/* ─── Navigation (Minimal) ─────────────────────────────────── */}
                <nav className="w-full max-w-7xl px-8 py-10 flex justify-between items-center">
                    <PrisfolLogo />
                    <div className="hidden md:flex items-center gap-12">
                        <Link href="#architecture" className="text-xs font-black uppercase tracking-[0.2em] text-content-secondary hover:text-accent-primary transition-colors">Architecture</Link>
                        <Link href="#vision" className="text-xs font-black uppercase tracking-[0.2em] text-content-secondary hover:text-accent-primary transition-colors">Vision</Link>
                        <Link
                            href="/chat"
                            className="px-8 py-3 rounded-xl bg-accent-primary/5 border border-accent-primary/20 text-xs font-black uppercase tracking-[0.2em] text-accent-primary hover:bg-accent-primary hover:text-white transition-all shadow-premium"
                        >
                            Log In
                        </Link>
                    </div>
                </nav>

                {/* ─── Hero Section ─────────────────────────────────────────── */}
                <section className="min-h-[85vh] flex flex-col items-center justify-center px-6 py-20 text-center relative max-w-7xl w-full">
                    <div className="space-y-12 max-w-5xl">
                        <div className="inline-flex items-center gap-3 px-6 py-2 rounded-full glassmorphism border-accent-primary/10 mb-4 group hover:bg-accent-primary/5 transition-all cursor-default animate-fade-in">
                            <Activity className="w-4 h-4 text-accent-primary" />
                            <span className="text-[10px] font-black tracking-[0.2em] text-content-secondary uppercase">
                                <span className="text-accent-primary px-1">v2.4</span> Neural Orchestrator Node
                            </span>
                        </div>

                        <h1 className="text-6xl sm:text-8xl md:text-9xl font-black tracking-tighter text-content-primary leading-[0.85] font-display">
                            BUILD THE <br />
                            <span className="text-accent-primary text-glow italic">FUTURE</span> <br />
                            OF LOGIC.
                        </h1>

                        <p className="text-xl sm:text-2xl text-content-secondary/70 max-w-3xl mx-auto font-medium leading-relaxed px-4 capitalize">
                            Prisfol is the structural bridge between natural intent and
                            <span className="text-accent-secondary"> mission-critical</span> execution. High-performance glass pipelines for the automated age.
                        </p>

                        <div className="flex flex-col sm:flex-row items-center justify-center gap-8 pt-8">
                            <Link
                                href="/chat"
                                className="w-full sm:w-auto group flex items-center justify-center gap-4 px-12 py-7 rounded-2xl bg-accent-primary text-white font-black text-xl hover:scale-105 active:scale-95 transition-all shadow-[0_20px_50px_-10px_rgba(6,182,212,0.4)]"
                            >
                                <Command className="w-6 h-6 text-white" />
                                START ENGINE
                                <ArrowRight className="w-6 h-6 group-hover:translate-x-2 transition-transform text-white" />
                            </Link>

                            <button
                                onClick={createNewSession}
                                disabled={isLoading}
                                className="w-full sm:w-auto glassmorphism glass-shimmer flex items-center justify-center gap-4 px-12 py-7 rounded-2xl border-accent-secondary/20 text-content-primary font-black text-xl hover:bg-accent-secondary/10 hover:scale-105 active:scale-95 transition-all shadow-xl"
                            >
                                {isLoading ? (
                                    <div className="w-6 h-6 border-2 border-accent-secondary border-t-transparent animate-spin rounded-full" />
                                ) : (
                                    <Workflow className="w-6 h-6 text-accent-secondary" />
                                )}
                                FROM SCRATCH
                            </button>
                        </div>
                    </div>
                </section>

                {/* ─── Brand Carousel (Infinite Flow) ───────────────────────── */}
                <BrandCarousel />

                {/* ─── Video Showcase (Production Ready) ────────────────────── */}
                <section className="w-full max-w-7xl px-8 py-48" id="vision">
                    <SectionHeader
                        tag="Showcase"
                        title="Experience Cinematic Complexity."
                        description="Witness the raw power of neural node routing. Seamlessly process thousands of logical branches in real-time."
                    />

                    <div className="relative group rounded-[3rem] overflow-hidden glassmorphism border-accent-primary/10 shadow-premium p-6">
                        <div className="relative aspect-video rounded-[2rem] overflow-hidden bg-bg-secondary flex items-center justify-center group/vid">
                            <img
                                src="/assets/hero-viz.png"
                                alt="Dashboard Preview"
                                className="w-full h-full object-cover opacity-40 group-hover:scale-105 transition-transform duration-[4000ms]"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-bg-primary/95 via-transparent to-transparent" />

                            {/* Play Button HUD */}
                            <button className="relative z-20 w-28 h-28 rounded-full glassmorphism flex items-center justify-center border-accent-primary/40 group-hover:scale-110 active:scale-95 transition-all shadow-premium group/btn">
                                <div className="absolute inset-0 bg-accent-primary/10 rounded-full animate-ping group-hover:bg-accent-primary/20" />
                                <Play className="w-12 h-12 text-accent-primary fill-accent-primary ml-1" />
                            </button>

                            {/* HUD Overlays */}
                            <div className="absolute top-10 left-10 flex items-center gap-5">
                                <Activity className="w-8 h-8 text-accent-primary animate-pulse" />
                                <div className="space-y-1.5">
                                    <div className="h-2 w-48 bg-accent-primary/20 rounded-full overflow-hidden">
                                        <div className="h-full w-3/4 bg-accent-primary animate-[shimmer_3s_infinite]" />
                                    </div>
                                    <p className="text-[10px] font-black tracking-[0.3em] text-accent-primary/60 uppercase">System Integrity: 100%</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ─── Features Architecture (Stitched Nodes) ────────────────── */}
                <section className="w-full max-w-7xl px-8 py-48" id="architecture">
                    <SectionHeader
                        tag="Architecture"
                        title="Engineered for Structural Clarity."
                        description="Our node-first philosophy ensures that complex logic remains readable and high-performance."
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12">
                        {[
                            { icon: Cpu, name: "Neural Core", desc: "Proprietary layout engine optimized for zero-overhead graph traversal." },
                            { icon: Layers, name: "Recursive Canvas", desc: "Nest workflows within workflows for infinite vertical scalability." },
                            { icon: Shield, name: "Immutable Security", desc: "Edge-based execution with zero-trust packet inspection." },
                            { icon: Zap, name: "Quantum Edge", desc: "Global CDN delivery with sub-10ms logic propagation." },
                            { icon: Globe, name: "Global Mesh", desc: "Synchronize state across distributed creative teams in real-time." },
                            { icon: Terminal, name: "Low-Level Bridge", desc: "Raw code injection for when the visual canvas isn't enough." }
                        ].map((feat, i) => (
                            <GlassCard key={i} className="p-12 flex flex-col gap-10 group hover:border-accent-primary/30 hover:bg-accent-primary/[0.02] transition-all duration-500">
                                <div className="w-20 h-20 rounded-3xl bg-accent-primary/5 border border-accent-primary/10 flex items-center justify-center text-accent-primary group-hover:scale-110 group-hover:rotate-6 transition-all shadow-inner">
                                    <feat.icon className="w-10 h-10" />
                                </div>
                                <div className="space-y-4">
                                    <h3 className="text-3xl font-black text-content-primary font-display">{feat.name}</h3>
                                    <p className="text-content-secondary leading-relaxed font-medium capitalize prose prose-invert opacity-80">{feat.desc}</p>
                                </div>
                                <div className="flex items-center gap-3 text-accent-primary/40 group-hover:text-accent-primary transition-colors cursor-pointer pt-6">
                                    <span className="text-[10px] font-black uppercase tracking-[0.3em]">Documentation</span>
                                    <ChevronRight className="w-5 h-5" />
                                </div>
                            </GlassCard>
                        ))}
                    </div>
                </section>

                {/* ─── Call to Action (HUD Style) ───────────────────────────── */}
                <section className="w-full max-w-7xl px-8 py-64 text-center relative overflow-hidden">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[1px] bg-gradient-to-r from-transparent via-accent-primary/10 to-transparent z-0" />
                    <div className="relative z-10 space-y-16">
                        <h2 className="text-6xl md:text-9xl font-black text-content-primary leading-tight font-display tracking-tighter">
                            THE BOARD IS <br />
                            <span className="text-accent-secondary">YOURS.</span>
                        </h2>
                        <Link
                            href="/chat"
                            className="inline-flex items-center gap-5 px-20 py-10 rounded-full bg-accent-primary text-white font-black text-3xl hover:scale-110 active:scale-95 transition-all shadow-[0_0_60px_rgba(6,182,212,0.5)]"
                        >
                            <Zap className="w-8 h-8 fill-white" />
                            DEPLOY NOW
                        </Link>
                    </div>
                </section>

                {/* ─── Ultra-Minimalist Footer ──────────────────────────────── */}
                <footer className="w-full max-w-7xl px-12 py-32 border-t border-accent-primary/10">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-32 mb-32">
                        <div className="col-span-1 border-r border-accent-primary/10 pr-12">
                            <PrisfolLogo className="mb-10" />
                            <p className="text-[10px] text-content-tertiary font-black leading-relaxed uppercase tracking-[0.3em]">
                                Redefining visual engineering through structural AI orchestration.
                            </p>
                        </div>

                        <div className="space-y-8">
                            <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-accent-primary opacity-50">Engine</h4>
                            <ul className="space-y-4 text-xs font-black text-content-secondary uppercase tracking-[0.2em]">
                                <li className="hover:text-accent-primary transition-colors"><a href="#">Nodes</a></li>
                                <li className="hover:text-accent-primary transition-colors"><a href="#">Models</a></li>
                                <li className="hover:text-accent-primary transition-colors"><a href="#">Security</a></li>
                                <li className="hover:text-accent-primary transition-colors"><a href="#">Compute</a></li>
                            </ul>
                        </div>

                        <div className="space-y-8">
                            <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-accent-primary opacity-50">Connect</h4>
                            <ul className="space-y-4 text-xs font-black text-content-secondary uppercase tracking-[0.2em]">
                                <li className="hover:text-accent-primary transition-colors"><a href="#">GitHub</a></li>
                                <li className="hover:text-accent-primary transition-colors"><a href="#">Discord</a></li>
                                <li className="hover:text-accent-primary transition-colors"><a href="#">X Profile</a></li>
                                <li className="hover:text-accent-primary transition-colors"><a href="#">Support</a></li>
                            </ul>
                        </div>

                        <div className="space-y-8">
                            <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-accent-primary opacity-50">Legal</h4>
                            <ul className="space-y-4 text-xs font-black text-content-secondary uppercase tracking-[0.2em]">
                                <li className="hover:text-accent-primary transition-colors"><a href="#">Privacy</a></li>
                                <li className="hover:text-accent-primary transition-colors"><a href="#">Terms</a></li>
                                <li className="hover:text-accent-primary transition-colors"><a href="#">License</a></li>
                                <li className="hover:text-accent-primary transition-colors"><a href="#">Cookies</a></li>
                            </ul>
                        </div>
                    </div>

                    <div className="flex flex-col md:flex-row justify-between items-center pt-16 border-t border-accent-primary/5 text-[10px] font-black tracking-[0.5em] text-accent-primary/20 uppercase">
                        <div>© 2026 Prisfol LABS</div>
                        <div>Built for the high-precision age</div>
                        <div className="flex gap-8">
                            <span>Status: Nominal</span>
                            <span>Region: Edge-Global</span>
                        </div>
                    </div>
                </footer>
            </div>
        </div>
    );
}
