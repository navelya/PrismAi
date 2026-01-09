'use client';

import Link from 'next/link';
import {
    Sparkles,
    MessageSquare,
    Layers,
    Zap,
    ArrowRight,
    Search,
    Scissors,
    Maximize2,
    Image as ImageIcon,
    Play
} from 'lucide-react';

// =============================================================================
// FEATURE CARDS
// =============================================================================

const features = [
    {
        icon: MessageSquare,
        title: 'Chat-First Interface',
        description: 'Describe what you want in natural language. Our AI understands and builds workflows automatically.',
        gradient: 'from-purple-500 to-indigo-500'
    },
    {
        icon: Layers,
        title: 'Visual Workflow Builder',
        description: 'Drag, drop, and connect nodes. See your automation take shape in a beautiful visual editor.',
        gradient: 'from-blue-500 to-cyan-500'
    },
    {
        icon: Zap,
        title: 'Powerful AI Nodes',
        description: 'Image scraping, background removal, AI generation, upscaling, and more - all in one platform.',
        gradient: 'from-amber-500 to-orange-500'
    },
];

const nodeTypes = [
    { icon: Search, name: 'Image Scraper', color: '#667eea' },
    { icon: Scissors, name: 'Remove Background', color: '#f093fb' },
    { icon: Maximize2, name: 'Upscale', color: '#ec4899' },
    { icon: ImageIcon, name: 'AI Generate', color: '#fbbf24' },
];

// =============================================================================
// MAIN HOME PAGE
// =============================================================================

export default function Home() {
    return (
        <div className="w-full h-full overflow-auto bg-gradient-to-br from-gray-50 via-purple-50/30 to-blue-50/30">
            {/* Hero Section */}
            <section className="relative px-4 sm:px-8 pt-12 sm:pt-16 pb-16 sm:pb-20 overflow-hidden">
                {/* Background decoration */}
                <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-gradient-to-br from-purple-200/40 to-blue-200/40 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
                <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-gradient-to-tr from-amber-200/30 to-pink-200/30 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

                <div className="relative max-w-5xl mx-auto text-center">
                    {/* Badge */}
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/80 backdrop-blur-sm border border-purple-100 shadow-sm mb-8">
                        <Sparkles className="w-4 h-4 text-purple-600" />
                        <span className="text-sm font-medium text-gray-700">AI-Powered Automation Platform</span>
                    </div>

                    {/* Title */}
                    <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold mb-6">
                        <span className="text-gray-900">Build Image Workflows</span>
                        <br />
                        <span className="bg-gradient-to-r from-purple-600 via-blue-600 to-cyan-600 bg-clip-text text-transparent">
                            With Natural Language
                        </span>
                    </h1>

                    {/* Subtitle */}
                    <p className="text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto mb-8 sm:mb-10 px-4">
                        Just describe what you need. PrismAI transforms your ideas into powerful
                        image processing workflows using cutting-edge AI technology.
                    </p>

                    {/* CTA Buttons */}
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12 sm:mb-16">
                        <Link
                            href="/chat"
                            className="group inline-flex items-center gap-2 px-8 py-4 rounded-xl
                                       bg-gradient-to-r from-purple-600 to-blue-600
                                       text-white font-semibold text-lg
                                       shadow-lg shadow-purple-500/30
                                       hover:shadow-xl hover:shadow-purple-500/40
                                       hover:scale-105 transition-all duration-300"
                        >
                            <MessageSquare className="w-5 h-5" />
                            Start Chatting
                            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </Link>
                        <Link
                            href="/editor"
                            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl
                                       bg-white border-2 border-gray-200
                                       text-gray-700 font-semibold text-lg
                                       hover:border-purple-300 hover:bg-purple-50
                                       hover:scale-105 transition-all duration-300"
                        >
                            <Play className="w-5 h-5" />
                            Open Editor
                        </Link>
                    </div>

                    {/* Screenshots Showcase */}
                    <div className="relative max-w-5xl mx-auto">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Screenshot 1 */}
                            <div className="group relative">
                                <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-blue-500 rounded-2xl blur-xl opacity-20 group-hover:opacity-30 transition-opacity" />
                                <div className="relative bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden">
                                    <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 border-b border-gray-700">
                                        <div className="flex gap-1.5">
                                            <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                                            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                                            <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                                        </div>
                                        <span className="text-xs text-gray-500 ml-2">Workflow Editor</span>
                                    </div>
                                    <img
                                        src="/assets/workflow-2.png"
                                        alt="PrismAI Workflow Example 1"
                                        className="w-full h-auto"
                                    />
                                </div>
                            </div>

                            {/* Screenshot 2 */}
                            <div className="group relative">
                                <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-2xl blur-xl opacity-20 group-hover:opacity-30 transition-opacity" />
                                <div className="relative bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden">
                                    <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 border-b border-gray-700">
                                        <div className="flex gap-1.5">
                                            <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                                            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                                            <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                                        </div>
                                        <span className="text-xs text-gray-500 ml-2">Chat Interface</span>
                                    </div>
                                    <img
                                        src="/assets/workflow-1.png"
                                        alt="PrismAI Workflow Example 2"
                                        className="w-full h-auto"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Caption */}
                        <p className="text-center text-gray-500 text-sm mt-6">
                            Build powerful image automation workflows with our visual editor
                        </p>
                    </div>
                </div>
            </section>

            {/* Video Demo Section */}
            <section className="px-4 sm:px-8 py-12 sm:py-20 bg-white/70">
                <div className="max-w-4xl mx-auto">
                    <div className="text-center mb-8 sm:mb-10">
                        <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4">
                            See PrismAI in Action
                        </h2>
                        <p className="text-lg text-gray-600">
                            Watch how easy it is to build and run automated workflows
                        </p>
                    </div>

                    {/* YouTube Video Embed */}
                    <div className="relative">
                        <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-blue-500 rounded-2xl blur-xl opacity-20" />
                        <div className="relative bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden">
                            {/* Browser-like header */}
                            <div className="flex items-center gap-2 px-4 py-3 bg-gray-800 border-b border-gray-700">
                                <div className="flex gap-1.5">
                                    <div className="w-3 h-3 rounded-full bg-red-500" />
                                    <div className="w-3 h-3 rounded-full bg-yellow-500" />
                                    <div className="w-3 h-3 rounded-full bg-green-500" />
                                </div>
                                <div className="flex-1 flex justify-center">
                                    <div className="px-4 py-1 rounded-md bg-gray-700 text-gray-400 text-xs">
                                        PrismAI Demo
                                    </div>
                                </div>
                            </div>

                            {/* YouTube Embed - Replace VIDEO_ID with your actual video ID */}
                            <div className="aspect-video">
                                <iframe
                                    className="w-full h-full"
                                    src="https://www.youtube.com/embed/dQw4w9WgXcQ"
                                    title="PrismAI Demo Video"
                                    frameBorder="0"
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                    allowFullScreen
                                />
                            </div>
                        </div>
                    </div>

                    <p className="text-center text-gray-500 text-sm mt-4">
                        🎬 Demo Video comming soon
                    </p>
                </div>
            </section>

            {/* Features Section */}
            <section className="px-4 sm:px-8 py-12 sm:py-20 bg-white/50">
                <div className="max-w-5xl mx-auto">
                    <div className="text-center mb-12">
                        <h2 className="text-3xl font-bold text-gray-900 mb-4">
                            Everything You Need
                        </h2>
                        <p className="text-lg text-gray-600">
                            Powerful features designed to make image automation effortless
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
                        {features.map((feature) => (
                            <div
                                key={feature.title}
                                className="group p-6 rounded-2xl bg-white border border-gray-100 
                                           hover:border-purple-200 hover:shadow-xl
                                           transition-all duration-300"
                            >
                                <div className={`
                                    w-14 h-14 rounded-xl mb-5 flex items-center justify-center
                                    bg-gradient-to-br ${feature.gradient} text-white
                                    group-hover:scale-110 transition-transform duration-300
                                `}>
                                    <feature.icon className="w-7 h-7" />
                                </div>
                                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                                    {feature.title}
                                </h3>
                                <p className="text-gray-600 leading-relaxed">
                                    {feature.description}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="px-4 sm:px-8 py-12 sm:py-20">
                <div className="max-w-3xl mx-auto text-center">
                    <div className="relative">
                        <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-blue-500 rounded-3xl blur-2xl opacity-20" />
                        <div className="relative bg-gradient-to-br from-purple-600 to-blue-600 rounded-3xl p-12 text-white">
                            <Sparkles className="w-12 h-12 mx-auto mb-6 opacity-80" />
                            <h2 className="text-3xl font-bold mb-4">
                                Ready to Automate?
                            </h2>
                            <p className="text-lg text-white/80 mb-8 max-w-xl mx-auto">
                                Start building your first workflow in seconds.
                                Just type what you want to accomplish.
                            </p>
                            <Link
                                href="/chat"
                                className="group inline-flex items-center gap-3 px-8 py-4 rounded-xl
                                           bg-white text-purple-700 font-semibold text-lg
                                           hover:bg-purple-50 hover:scale-105
                                           transition-all duration-300 shadow-lg"
                            >
                                <MessageSquare className="w-5 h-5" />
                                Start Your First Chat
                                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                            </Link>
                        </div>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="px-8 py-8 border-t border-gray-200 bg-white/50">
                <div className="max-w-5xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-blue-500 flex items-center justify-center">
                            <Sparkles className="w-4 h-4 text-white" />
                        </div>
                        <span className="font-semibold text-gray-900">PrismAI</span>
                    </div>
                    <p className="text-sm text-gray-500">
                        AI-Powered Image Automation
                    </p>
                </div>
            </footer>
        </div>
    );
}
