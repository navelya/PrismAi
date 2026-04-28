'use client';

import Link from 'next/link';
import { Play, Sparkles, AlertCircle, RotateCcw, ArrowLeft, Workflow } from 'lucide-react';

export default function WorkflowNotFound() {
    return (
        <div className="min-h-screen bg-[#09090b] text-white font-sans flex flex-col items-center justify-center relative overflow-hidden">

            {/* Infinite Dot Grid Background */}
            <div className="absolute inset-0 opacity-20"
                style={{
                    backgroundImage: 'radial-gradient(#52525b 1px, transparent 1px)',
                    backgroundSize: '24px 24px'
                }}
            />

            {/* Content Container */}
            <div className="relative z-10 flex flex-col items-center gap-12">

                {/* The "Broken Workflow" Visual */}
                <div className="relative w-[400px] h-[160px] flex items-center justify-between">

                    {/* Node A: The Trigger (Active) */}
                    <div className="w-32 h-24 rounded-xl bg-[#18181b] border border-emerald-500/30 shadow-[0_0_30px_rgba(16,185,129,0.1)] flex flex-col p-3 relative z-10">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                                <Play className="w-3 h-3 text-emerald-500 fill-emerald-500" />
                            </div>
                            <span className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wider">Trigger</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-white/5 mb-1.5 overflow-hidden">
                            <div className="h-full w-full bg-emerald-500/20" />
                        </div>
                        <span className="text-xs text-white/60">New Request</span>

                        {/* Status Dot */}
                        <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-[#09090b] shadow-[0_0_10px_rgba(16,185,129,0.5)]" />

                        {/* Output Handle */}
                        <div className="absolute top-1/2 -right-1.5 w-3 h-3 rounded-full bg-white border-2 border-[#18181b] transform -translate-y-1/2" />
                    </div>

                    {/* The Broken Connector */}
                    <svg className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-visible">
                        <defs>
                            <linearGradient id="line-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#10b981" /> {/* Emerald */}
                                <stop offset="50%" stopColor="#ef4444" /> {/* Red */}
                                <stop offset="100%" stopColor="transparent" />
                            </linearGradient>
                            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                                <polygon points="0 0, 10 3.5, 0 7" fill="#3f3f46 opacity-30" />
                            </marker>
                        </defs>

                        {/* Left Half (Active) */}
                        <path
                            d="M 128 80 C 180 80, 180 80, 200 80"
                            fill="none"
                            stroke="url(#line-gradient)"
                            strokeWidth="2"
                            strokeLinecap="round"
                            className="drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]"
                        />

                        {/* Spark/Break Point Animation */}
                        <circle cx="200" cy="80" r="3" fill="#ef4444" className="animate-ping" />
                        <circle cx="200" cy="80" r="2" fill="#fff" />

                        {/* Right Half (Missing/Ghosted) */}
                        <path
                            d="M 210 80 C 240 80, 240 80, 272 80"
                            fill="none"
                            stroke="#52525b"
                            strokeWidth="2"
                            strokeDasharray="4 4"
                            opacity="0.3"
                        />
                    </svg>

                    {/* Node B: The Missing Node (Ghost) */}
                    <div className="w-32 h-24 rounded-xl border border-dashed border-red-500/30 bg-red-500/5 flex flex-col items-center justify-center p-3 relative z-10 opacity-80">
                        {/* Input Handle */}
                        <div className="absolute top-1/2 -left-1.5 w-3 h-3 rounded-full bg-[#27272a] border-2 border-[#09090b] transform -translate-y-1/2" />

                        <AlertCircle className="w-8 h-8 text-red-500/50 mb-2 animate-pulse" />
                        <span className="text-xs font-mono text-red-500/70">404 ERROR</span>
                    </div>
                </div>

                {/* Text Content */}
                <div className="text-center space-y-4 max-w-md">
                    <h1 className="text-4xl font-bold text-white tracking-tight">
                        Workflow Not Found
                    </h1>
                    <p className="text-content-secondary text-lg">
                        The automation chain you're looking for seems to be disconnected or deleted.
                    </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-4">
                    <Link
                        href="/chat"
                        className="group relative px-6 py-3 bg-gradient-premium text-white rounded-lg font-medium shadow-lg shadow-accent-primary/25 hover:shadow-accent-primary/40 transition-all flex items-center gap-2"
                    >
                        <Workflow className="w-4 h-4" />
                        Start New Workflow
                    </Link>

                    <Link
                        href="/"
                        className="px-6 py-3 text-content-secondary hover:text-white transition-colors flex items-center gap-2"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Home
                    </Link>
                </div>
            </div>

            {/* Decorative Pulse (The "Heartbeat" of the system stopped) */}
            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-64 h-1 bg-gradient-to-r from-transparent via-red-500/20 to-transparent blur-sm" />
        </div>
    );
}
