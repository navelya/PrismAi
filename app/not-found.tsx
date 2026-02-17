'use client';

import Link from 'next/link';
import { Eye, Lock, Folder, FileImage, Layout, Type, MousePointer2, ChevronRight, Layers, Home } from 'lucide-react';

export default function NotFound() {
    return (
        <div className="min-h-screen bg-[#09090b] text-white font-sans flex flex-col items-center justify-center p-4 relative overflow-hidden selection:bg-cyan-500/30">

            {/* Ambient Background Glow (Prism Brand Identity) */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-gradient-to-b from-cyan-500/10 via-purple-500/10 to-transparent blur-[120px] pointer-events-none" />

            <div className="relative z-10 w-full max-w-4xl flex flex-col md:flex-row items-center gap-12 md:gap-20">

                {/* Visual Centerpiece: The Glitching Layers Panel */}
                <div className="w-full max-w-sm shrink-0 perspective-1000">
                    <div className="relative bg-[#18181b]/80 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden transform md:rotate-y-6 md:rotate-x-2 transition-transform duration-500 hover:rotate-0 group">

                        {/* Panel Header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/5">
                            <span className="text-xs font-semibold text-white/70 uppercase tracking-wider flex items-center gap-2">
                                <Layers className="w-3.5 h-3.5" />
                                Layers
                            </span>
                            <div className="flex gap-1.5">
                                <div className="w-2.5 h-2.5 rounded-full bg-white/20" />
                                <div className="w-2.5 h-2.5 rounded-full bg-white/20" />
                            </div>
                        </div>

                        {/* Layers List */}
                        <div className="p-2 space-y-1">
                            {/* Valid Layer 1 */}
                            <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors cursor-default group/layer">
                                <Eye className="w-4 h-4 text-white/40 group-hover/layer:text-white/80" />
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <Folder className="w-4 h-4 text-blue-400" />
                                    <span className="text-sm text-white/80 truncate">Hero Section</span>
                                </div>
                                <ChevronRight className="w-4 h-4 text-white/20" />
                            </div>

                            {/* Valid Layer 2 */}
                            <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors cursor-default group/layer">
                                <Eye className="w-4 h-4 text-white/40 group-hover/layer:text-white/80" />
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <Type className="w-4 h-4 text-purple-400" />
                                    <span className="text-sm text-white/80 truncate">H1 Headline</span>
                                </div>
                                <span className="text-[10px] text-white/30 font-mono border border-white/10 px-1 rounded">T</span>
                            </div>

                            {/* THE MISSING LAYER (404) */}
                            <div className="relative overflow-hidden">
                                <div className="absolute inset-0 bg-red-500/10 animate-pulse" />
                                <div className="flex items-center gap-3 px-3 py-3 rounded-lg border border-red-500/30 border-dashed bg-red-500/5 cursor-not-allowed">
                                    <div className="w-4 h-4 flex items-center justify-center">
                                        <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-ping" />
                                    </div>
                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                        <FileImage className="w-4 h-4 text-red-400 opacity-50" />
                                        <span className="text-sm text-red-500/80 font-mono italic truncate">
                                            ERR_LAYER_NOT_FOUND
                                        </span>
                                    </div>
                                    <Lock className="w-3 h-3 text-red-500/50" />
                                </div>
                                {/* Glitch bars overlay */}
                                <div className="absolute top-1/2 left-0 w-full h-[1px] bg-red-500/50 opacity-0 animate-glitch-bar-1" />
                                <div className="absolute top-1/3 left-0 w-full h-[2px] bg-cyan-500/50 opacity-0 animate-glitch-bar-2" />
                            </div>

                            {/* Valid Layer 3 */}
                            <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors cursor-default group/layer">
                                <Eye className="w-4 h-4 text-white/40 group-hover/layer:text-white/80" />
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <Layout className="w-4 h-4 text-emerald-400" />
                                    <span className="text-sm text-white/80 truncate">Main Content</span>
                                </div>
                                <Lock className="w-3 h-3 text-white/20" />
                            </div>

                            {/* Valid Layer 4 */}
                            <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors cursor-default group/layer">
                                <Eye className="w-4 h-4 text-white/40 group-hover/layer:text-white/80" />
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <div className="w-4 h-4 rounded bg-white/10" />
                                    <span className="text-sm text-white/80 truncate">Background</span>
                                </div>
                                <Lock className="w-3 h-3 text-white/20" />
                            </div>

                        </div>

                        {/* Floating Cursor (Mock interaction) */}
                        <div className="absolute bottom-12 right-8 pointer-events-none transform translate-y-4 opacity-0 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-700 delay-100">
                            <MousePointer2 className="w-6 h-6 text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)] fill-cyan-400/20" />
                        </div>
                    </div>

                    {/* Reflection/Shadow */}
                    <div className="absolute -bottom-8 left-4 right-4 h-4 bg-cyan-500/20 blur-xl rounded-full opacity-40 group-hover:opacity-60 transition-opacity" />
                </div>

                {/* Text Content */}
                <div className="text-center md:text-left space-y-6 max-w-md">
                    <div className="space-y-2">
                        <div className="inline-block px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-mono mb-2">
                            Error 404
                        </div>
                        <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-white">
                            Layer <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400">Not Found</span>
                        </h1>
                        <p className="text-lg text-white/60 leading-relaxed">
                            The layer you are looking for has been hidden, deleted, or perhaps never existed in this workspace.
                        </p>
                    </div>

                    <div className="flex items-center justify-center md:justify-start gap-4 pt-4">
                        <Link
                            href="/"
                            className="group relative px-6 py-3 bg-white text-black rounded-lg font-medium hover:bg-cyan-50 transition-colors flex items-center gap-2 overflow-hidden"
                        >
                            <Home className="w-4 h-4" />
                            Back to Dashboard

                            {/* Hover shine effect */}
                            <div className="absolute inset-0 w-1/4 h-full bg-white/50 skew-x-12 -translate-x-[200%] group-hover:translate-x-[400%] transition-transform duration-700 ease-in-out" />
                        </Link>
                    </div>
                </div>
            </div>

            {/* Background Grid Pattern (Inline SVG) */}
            <div className="absolute inset-0 bg-[url('/grid-pattern.svg')] bg-[length:40px_40px] opacity-[0.03] pointer-events-none" />

            {/* Custom Animations Style */}
            <style jsx global>{`
                @keyframes glitch-bar-1 {
                    0% { opacity: 0; transform: translateX(-100%); }
                    10%, 90% { opacity: 1; }
                    100% { opacity: 0; transform: translateX(100%); }
                }
                @keyframes glitch-bar-2 {
                    0% { opacity: 0; transform: translateX(100%); }
                    30%, 70% { opacity: 1; }
                    100% { opacity: 0; transform: translateX(-100%); }
                }
                .animate-glitch-bar-1 {
                    animation: glitch-bar-1 2.5s infinite linear;
                }
                .animate-glitch-bar-2 {
                    animation: glitch-bar-2 3s infinite linear reverse;
                }
                .perspective-1000 {
                    perspective: 1000px;
                }
                .rotate-y-6 {
                    transform: rotateY(6deg);
                }
            `}</style>
        </div>
    );
}
