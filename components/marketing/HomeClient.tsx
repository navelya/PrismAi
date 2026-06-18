'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
    motion, useScroll, useTransform, AnimatePresence, useMotionValue, useSpring,
    useInView, MotionValue, animate, useAnimationFrame,
} from 'framer-motion';
import {
    ArrowRight, Play, Workflow, Image as ImageIcon, Wand2, Layers3, Eraser,
    Maximize2, Film, Zap, Cpu, Globe2, Shield, Network, Scissors, MessageSquare,
    Send, Plus, Minus, AudioLines, Type, Box, Check, Sparkles,
    CreditCard, Info, Users, LifeBuoy, RefreshCw, Coins, LayoutTemplate,
    Palette, Save, GitBranch, Mail, Building2,
} from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { BrandCarousel } from '@/components/ui/BrandCarousel';
import { Modal } from '@/components/ui/Modal';
import { useSession } from '@/lib/hooks/use-session';
import { cn } from '@/lib/utils';
import { appUrl } from '@/lib/domains';
import { MarketingHeader } from './MarketingHeader';
import { MarketingFooter } from './MarketingFooter';
import { EYEBROW, H1, H2, H3, LEAD, GLASS_CARD, GLASS_CARD_ACCENT } from './typography';
import type { PlanDisplay, CreditPack } from '@/lib/billing/plans-config';
import type { MarketingModel } from '@/app/api/marketing/models/route';
import type { MarketingTemplate } from '@/app/api/marketing/templates/route';

// =============================================================================
// SHARED SECTION HEADER
// =============================================================================

function SectionHeader({ tag, title, description, center = false }: { tag: string; title: string; description?: string; center?: boolean }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
            whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className={cn('mb-10 md:mb-14 space-y-4', center && 'text-center flex flex-col items-center')}
        >
            <span className={EYEBROW}>
                <span className="h-1 w-1 rounded-full bg-accent-primary" />
                {tag}
            </span>
            <h2 className={H2}>{title}</h2>
            {description && <p className={cn(LEAD, center && 'max-w-2xl')}>{description}</p>}
        </motion.div>
    );
}

// =============================================================================
// HERO CHAT INPUT
// =============================================================================

const HERO_PROMPTS = [
    'A cinematic portrait, 35mm film, golden-hour light…',
    'Turn this product photo into a neon studio hero shot…',
    'Generate an isometric dashboard in a mint & slate palette…',
    'Remove the background and drop the subject on marble…',
    'An editorial fashion shoot on a brutalist concrete set…',
    'Ghibli-style landscape with hand-painted clouds…',
    'Restore and upscale this old photo to crisp 4K…',
];

const HERO_CHIPS: { label: string; prompt: string }[] = [
    { label: 'Product hero shot', prompt: 'Create a clean product hero shot on a seamless studio backdrop with soft rim lighting.' },
    { label: 'Cinematic portrait', prompt: 'A cinematic portrait, 35mm film, shallow depth of field, warm golden-hour light.' },
    { label: 'Remove background', prompt: 'Remove the background from my image and place the subject on a polished marble surface.' },
    { label: 'Restore old photo', prompt: 'Restore and upscale this old photo to crisp 4K with natural, true-to-life color.' },
];

function useTypewriter(
    phrases: string[],
    { typeSpeed = 42, deleteSpeed = 22, holdTime = 1700, active = true }: { typeSpeed?: number; deleteSpeed?: number; holdTime?: number; active?: boolean } = {}
) {
    const [text, setText] = useState('');
    const [phraseIdx, setPhraseIdx] = useState(0);
    const phaseRef = useRef<'typing' | 'holding' | 'deleting'>('typing');

    useEffect(() => {
        if (!active) { setText(''); phaseRef.current = 'typing'; }
    }, [active]);

    useEffect(() => {
        if (!active) return;
        const current = phrases[phraseIdx % phrases.length];
        let timer: ReturnType<typeof setTimeout>;
        if (phaseRef.current === 'typing') {
            if (text.length < current.length) {
                timer = setTimeout(() => setText(current.slice(0, text.length + 1)), typeSpeed);
            } else {
                phaseRef.current = 'holding';
                timer = setTimeout(() => { phaseRef.current = 'deleting'; setText(current.slice(0, current.length - 1)); }, holdTime);
            }
        } else if (phaseRef.current === 'deleting') {
            if (text.length > 0) {
                timer = setTimeout(() => setText(current.slice(0, text.length - 1)), deleteSpeed);
            } else {
                phaseRef.current = 'typing';
                setPhraseIdx((i) => (i + 1) % phrases.length);
            }
        }
        return () => clearTimeout(timer);
    }, [text, phraseIdx, active, phrases, typeSpeed, deleteSpeed, holdTime]);

    return text;
}

function HeroChatInput() {
    const router = useRouter();
    const [value, setValue] = useState('');
    const [focused, setFocused] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const placeholder = useTypewriter(HERO_PROMPTS, { active: value.length === 0 && !focused });

    const submit = (text?: string) => {
        const t = (text ?? value).trim();
        if (!t || leaving) { if (!t) textareaRef.current?.focus(); return; }
        setLeaving(true);
        const dest = appUrl(`/?prompt=${encodeURIComponent(t)}`);
        if (dest.startsWith('http')) { window.location.href = dest; return; }
        try { sessionStorage.setItem('prismai:pendingPrompt', t); } catch { /* ignore */ }
        router.push('/chat');
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    };

    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
    }, [value]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
            className="relative w-full max-w-2xl mx-auto"
        >
            <div className={cn(
                'relative rounded-[1.9rem] border bg-surface-secondary/70 backdrop-blur-xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] transition-colors duration-500 overflow-hidden',
                focused ? 'border-accent-primary/50' : 'border-stroke-subtle/70'
            )}>
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent-primary/60 to-transparent" />
                <div className="relative flex items-end gap-2.5 p-3 md:p-4">
                    <div className="relative flex-1 min-w-0 py-2.5 pl-2">
                        <textarea
                            ref={textareaRef}
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onFocus={() => setFocused(true)}
                            onBlur={() => setFocused(false)}
                            rows={1}
                            aria-label="Describe what you want to create"
                            className="relative z-10 w-full resize-none bg-transparent text-content-primary text-base md:text-lg font-medium leading-relaxed outline-none placeholder:text-transparent max-h-[220px]"
                        />
                        {value.length === 0 && (
                            <div className="pointer-events-none absolute inset-0 z-0 flex items-start pl-2 text-base md:text-lg font-medium text-content-tertiary leading-relaxed">
                                <span className="whitespace-pre-wrap">{placeholder}</span>
                                <span className="ml-0.5 mt-[0.15em] inline-block w-[2px] h-[1.15em] bg-accent-primary animate-pulse" />
                            </div>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={() => submit()}
                        disabled={leaving}
                        aria-label="Start building"
                        className={cn(
                            'group shrink-0 flex items-center justify-center w-11 h-11 md:w-12 md:h-12 rounded-2xl transition-all duration-300 shadow-lg',
                            value.trim() ? 'bg-accent-primary text-surface-primary hover:scale-105' : 'bg-surface-tertiary text-content-primary hover:bg-interactive-active'
                        )}
                    >
                        {leaving
                            ? <div className="w-5 h-5 border-2 border-current border-t-transparent animate-spin rounded-full" />
                            : <ArrowRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />}
                    </button>
                </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-2 px-2">
                {HERO_CHIPS.map((chip) => (
                    <button
                        key={chip.label}
                        type="button"
                        onClick={() => submit(chip.prompt)}
                        disabled={leaving}
                        className="inline-flex items-center px-3.5 py-2 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-content-secondary hover:text-content-primary hover:border-accent-primary/40 hover:bg-white/10 transition-all"
                    >
                        {chip.label}
                    </button>
                ))}
            </div>
        </motion.div>
    );
}

// =============================================================================
// MAGNETIC BUTTON
// =============================================================================

function MagneticButton({ children, className, onClick, href, disabled }: { children: React.ReactNode; className?: string; onClick?: () => void; href?: string; disabled?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    const x = useMotionValue(0);
    const y = useMotionValue(0);
    const xs = useSpring(x, { stiffness: 220, damping: 20 });
    const ys = useSpring(y, { stiffness: 220, damping: 20 });

    const handleMove = (e: React.MouseEvent) => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        x.set((e.clientX - (rect.left + rect.width / 2)) * 0.18);
        y.set((e.clientY - (rect.top + rect.height / 2)) * 0.18);
    };
    const handleLeave = () => { x.set(0); y.set(0); };

    const inner = (
        <motion.div ref={ref} style={{ x: xs, y: ys }} onMouseMove={handleMove} onMouseLeave={handleLeave} className={cn('inline-block', disabled && 'opacity-60 pointer-events-none')}>
            {children}
        </motion.div>
    );
    if (href) return <Link href={href} className={className} onClick={onClick}>{inner}</Link>;
    return <button onClick={onClick} disabled={disabled} className={className}>{inner}</button>;
}

// =============================================================================
// LIVE BADGE
// =============================================================================

function LiveBadge() {
    return (
        <div className="inline-flex items-center gap-1.5 text-xs font-medium text-content-tertiary">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-success animate-pulse" />
            Live
        </div>
    );
}

// =============================================================================
// CAPABILITIES
// =============================================================================

const CAPABILITIES: { icon: any; title: string; desc: string; image: string; span?: string; accent?: boolean }[] = [
    { icon: Wand2, title: 'Generate', desc: 'Text-to-image, text-to-video. Every flagship model, ready to chain.', image: 'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&q=80&w=900', span: 'md:col-span-2', accent: true },
    { icon: Layers3, title: 'Compose', desc: 'Stack, mask, blend. Multi-input pipelines without leaving the canvas.', image: 'https://images.unsplash.com/photo-1635776062127-d379bfcba9f8?auto=format&fit=crop&q=80&w=900' },
    { icon: Eraser, title: 'Edit', desc: 'Inpaint, extend, retouch. Surgical control on any source asset.', image: 'https://images.unsplash.com/photo-1547891654-e66ed7ebb968?auto=format&fit=crop&q=80&w=900' },
    { icon: Maximize2, title: 'Upscale', desc: 'Sub-pixel detail recovery. Print-ready output from any source.', image: 'https://images.unsplash.com/photo-1614624532983-4ce03382d63d?auto=format&fit=crop&q=80&w=900' },
    { icon: Scissors, title: 'Remove background', desc: 'One click. Studio-clean cutouts with sub-pixel edges.', image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&q=80&w=900', span: 'md:col-start-3 md:row-start-2 md:row-span-2' },
    { icon: Film, title: 'Animate', desc: 'Bring stills to motion. Frame interpolation, looping, video extension.', image: 'https://images.unsplash.com/photo-1633957897986-70e83293f3ff?auto=format&fit=crop&q=80&w=900', span: 'md:col-span-2', accent: true },
];

function CapabilityCard({ icon: Icon, title, desc, image, span, accent }: typeof CAPABILITIES[number]) {
    const ref = useRef<HTMLDivElement>(null);
    const [tilt, setTilt] = useState({ rx: 0, ry: 0 });
    const handleMove = (e: React.MouseEvent) => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setTilt({ rx: ((e.clientY - r.top) / r.height - 0.5) * -6, ry: ((e.clientX - r.left) / r.width - 0.5) * 6 });
    };
    return (
        <motion.div
            ref={ref}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            onMouseMove={handleMove}
            onMouseLeave={() => setTilt({ rx: 0, ry: 0 })}
            style={{ transform: `perspective(1200px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)` }}
            className={cn(accent ? GLASS_CARD_ACCENT : GLASS_CARD, 'p-8 flex flex-col gap-6', span)}
        >
            {image && (
                <div className="absolute inset-0 -z-0 opacity-[0.12] group-hover:opacity-[0.2] transition-opacity duration-700">
                    <img src={image} alt="" className="w-full h-full object-cover" />
                </div>
            )}
            <div className={cn('absolute -top-24 -right-24 w-64 h-64 rounded-full blur-3xl transition-opacity duration-700', accent ? 'bg-accent-primary/20 opacity-70' : 'bg-accent-secondary/15 opacity-0 group-hover:opacity-100')} />
            <div className="relative z-10 flex items-center justify-between">
                <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center border', accent ? 'bg-accent-primary/15 border-accent-primary/30 text-accent-primary' : 'bg-surface-tertiary border-stroke-subtle text-accent-primary')}>
                    <Icon className="w-5 h-5" />
                </div>
                <LiveBadge />
            </div>
            <div className="relative z-10 mt-auto">
                <h3 className={cn(H3, 'mb-2')}>{title}</h3>
                <p className="text-sm text-content-secondary leading-relaxed max-w-xs">{desc}</p>
            </div>
            <div className="relative z-10 flex items-center gap-2 text-xs font-semibold text-content-tertiary group-hover:text-accent-primary transition-colors">
                Explore <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
            </div>
        </motion.div>
    );
}

// =============================================================================
// LIVE GALLERY MARQUEE
// =============================================================================

const GALLERY_IMAGES = [
    'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&q=80&w=600',
    'https://images.unsplash.com/photo-1547891654-e66ed7ebb968?auto=format&fit=crop&q=80&w=600',
    'https://images.unsplash.com/photo-1635776062127-d379bfcba9f8?auto=format&fit=crop&q=80&w=600',
    'https://images.unsplash.com/photo-1633957897986-70e83293f3ff?auto=format&fit=crop&q=80&w=600',
    'https://images.unsplash.com/photo-1614624532983-4ce03382d63d?auto=format&fit=crop&q=80&w=600',
    'https://images.unsplash.com/photo-1620421680010-0766ff230392?auto=format&fit=crop&q=80&w=600',
    'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=600',
    'https://images.unsplash.com/photo-1604871000636-074fa5117945?auto=format&fit=crop&q=80&w=600',
    'https://images.unsplash.com/photo-1635322966219-b75ed372eb01?auto=format&fit=crop&q=80&w=600',
    'https://images.unsplash.com/photo-1626544827763-d516dce335e2?auto=format&fit=crop&q=80&w=600',
    'https://images.unsplash.com/photo-1518895949257-7621c3c786d7?auto=format&fit=crop&q=80&w=600',
    'https://images.unsplash.com/photo-1505839673365-e3971f8d9184?auto=format&fit=crop&q=80&w=600',
];

function GalleryColumn({ images, direction = 'up', duration = 60, className }: { images: string[]; direction?: 'up' | 'down'; duration?: number; className?: string }) {
    const trackRef = useRef<HTMLDivElement>(null);
    const y = useMotionValue(0);
    const halfHeightRef = useRef(0);
    const initRef = useRef(false);

    useEffect(() => {
        const measure = () => {
            const track = trackRef.current;
            if (!track) return;
            const children = track.children;
            if (children.length <= images.length) return;
            const half = (children[images.length] as HTMLElement).offsetTop;
            if (half <= 0) return;
            halfHeightRef.current = half;
            if (!initRef.current) { y.set(direction === 'down' ? -half : 0); initRef.current = true; }
        };
        measure();
        const ro = new ResizeObserver(measure);
        if (trackRef.current) ro.observe(trackRef.current);
        const imgs = trackRef.current?.querySelectorAll('img') ?? [];
        imgs.forEach((img) => img.addEventListener('load', measure));
        return () => { ro.disconnect(); imgs.forEach((img) => img.removeEventListener('load', measure)); };
    }, [direction, images.length, y]);

    useAnimationFrame((_, delta) => {
        const half = halfHeightRef.current;
        if (half === 0) return;
        const speed = half / (duration * 1000);
        let next = y.get() + (direction === 'up' ? -delta * speed : delta * speed);
        while (next <= -half) next += half;
        while (next > 0) next -= half;
        y.set(next);
    });

    return (
        <div className={cn('relative h-[640px] overflow-hidden', className)}>
            <motion.div ref={trackRef} className="flex flex-col gap-4 will-change-transform" style={{ y }}>
                {[...images, ...images].map((src, i) => (
                    <div key={i} className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl group/img">
                        <img src={src} loading="lazy" draggable={false} className="w-full h-auto object-cover transition-transform duration-700 group-hover/img:scale-105" alt="" />
                    </div>
                ))}
            </motion.div>
        </div>
    );
}

// =============================================================================
// PROMPT ROTATOR
// =============================================================================

const PROMPT_ROTATOR = [
    'photoreal product on neon studio backdrop',
    'cinematic portrait, 35mm, golden hour',
    'isometric vector dashboard, mint and slate',
    'editorial fashion shot, brutalist set',
    'ghibli-style scene with hand-painted clouds',
];

function PromptRotator({ size = 'md' }: { size?: 'sm' | 'md' }) {
    const [idx, setIdx] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setIdx((i) => (i + 1) % PROMPT_ROTATOR.length), 2400);
        return () => clearInterval(t);
    }, []);
    return (
        <div className={cn('relative overflow-hidden', size === 'sm' ? 'h-5' : 'h-7')}>
            <AnimatePresence mode="wait">
                <motion.span
                    key={idx}
                    initial={{ y: 24, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -24, opacity: 0 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className={cn('absolute inset-0 flex items-center justify-center text-accent-primary font-mono tracking-tight whitespace-nowrap', size === 'sm' ? 'text-xs' : 'text-sm md:text-base')}
                >
                    "{PROMPT_ROTATOR[idx]}"
                </motion.span>
            </AnimatePresence>
        </div>
    );
}

// =============================================================================
// CHAT-FIRST SHOWCASE (dark, no mac chrome)
// =============================================================================

const SHOWCASE_RESULTS = [
    { src: 'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&q=80&w=600', tag: 'minimal' },
    { src: 'https://images.unsplash.com/photo-1635776062127-d379bfcba9f8?auto=format&fit=crop&q=80&w=600', tag: 'dramatic' },
    { src: 'https://images.unsplash.com/photo-1547891654-e66ed7ebb968?auto=format&fit=crop&q=80&w=600', tag: 'neon' },
    { src: 'https://images.unsplash.com/photo-1614624532983-4ce03382d63d?auto=format&fit=crop&q=80&w=600', tag: 'editorial' },
];
const SHOWCASE_SOURCE = 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&q=80&w=400';

function ShowcaseChatPanel() {
    return (
        <div className={cn(GLASS_CARD, 'h-full w-full flex flex-col')}>
            <div className="flex items-center gap-2 px-5 py-3 border-b border-stroke-subtle/60 shrink-0">
                <MessageSquare className="w-3.5 h-3.5 text-accent-primary" />
                <span className="text-sm font-semibold text-content-secondary">Prisfol Chat</span>
                <div className="ml-auto"><LiveBadge /></div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
                <motion.div initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }} className="flex justify-end">
                    <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-tr-sm bg-accent-primary/15 text-content-primary text-sm leading-relaxed">
                        Make 4 hero shots of my watch on different studio backdrops — minimal, dramatic, neon, editorial.
                    </div>
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.35 }} className="flex justify-start">
                    <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-tl-sm bg-surface-tertiary text-content-secondary text-sm leading-relaxed">
                        On it — taking your watch and generating it across 4 studio backdrops: minimal, dramatic, neon, editorial.
                    </div>
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.7 }} className="flex justify-start">
                    <div className="w-full max-w-[94%] space-y-2">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-accent-primary">
                            <span className="w-1.5 h-1.5 rounded-full bg-accent-primary" /> 4 frames ready
                        </div>
                        <div className="flex gap-2">
                            {SHOWCASE_RESULTS.map((o, i) => (
                                <motion.div key={o.tag} initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.9 + i * 0.12 }} className="relative flex-1 min-w-0 aspect-square rounded-xl overflow-hidden border border-stroke-subtle group">
                                    <img src={o.src} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" alt={o.tag} />
                                    <div className="absolute bottom-1 inset-x-1 px-1 py-0.5 rounded-md bg-surface-primary/80 backdrop-blur text-[10px] font-medium text-content-secondary text-center truncate">{o.tag}</div>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                </motion.div>
            </div>
            <div className="px-5 py-4 border-t border-stroke-subtle/60 flex items-center gap-3 shrink-0">
                <div className="flex-1 min-w-0"><PromptRotator size="sm" /></div>
                <button className="shrink-0 w-8 h-8 rounded-xl bg-accent-primary text-surface-primary flex items-center justify-center hover:brightness-110 transition-all">
                    <Send className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
}

function ShowcaseWorkflowNode({ style, label, icon: Icon, accent, children }: { style: React.CSSProperties; label: string; icon: any; accent?: boolean; children: React.ReactNode }) {
    return (
        <div className="absolute" style={style}>
            <div className={cn('w-full h-full rounded-xl border bg-surface-tertiary shadow-lg flex flex-col overflow-hidden', accent ? 'border-accent-primary/40' : 'border-stroke-subtle')}>
                <div className={cn('flex items-center gap-1 px-1.5 py-1 border-b shrink-0', accent ? 'bg-accent-primary/10 border-accent-primary/20' : 'bg-surface-secondary border-stroke-subtle')}>
                    <Icon className={cn('w-2.5 h-2.5', accent ? 'text-accent-primary' : 'text-content-tertiary')} />
                    <span className="text-[10px] font-medium text-content-tertiary truncate">{label}</span>
                </div>
                <div className="flex-1 min-h-0">{children}</div>
            </div>
        </div>
    );
}

function ShowcaseWorkflow() {
    const wires = ['M31 28 C 36 28, 35 50, 40 50', 'M31 72 C 36 72, 35 50, 40 50', 'M66 50 L 74 50'];
    return (
        <div className={cn(GLASS_CARD, 'relative h-full w-full')}>
            <div className="absolute top-0 inset-x-0 z-20 flex items-center gap-2 px-4 py-2.5 border-b border-stroke-subtle/60 bg-surface-secondary/40 backdrop-blur">
                <Network className="w-3.5 h-3.5 text-accent-primary" />
                <span className="text-sm font-semibold text-content-secondary">Workflow · 4 nodes</span>
                <div className="ml-auto"><LiveBadge /></div>
            </div>
            <div className="absolute inset-0 opacity-100" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(56,189,248,0.10) 1px, transparent 0)', backgroundSize: '18px 18px' }} />
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                {wires.map((d, i) => (
                    <g key={i}>
                        <path d={d} stroke="rgba(56,189,248,0.25)" strokeWidth="0.5" fill="none" />
                        <motion.path d={d} stroke="rgb(56,189,248)" strokeWidth="0.5" fill="none" strokeDasharray="2 4" animate={{ strokeDashoffset: [0, -6] }} transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }} />
                    </g>
                ))}
            </svg>
            <ShowcaseWorkflowNode style={{ left: '4%', top: '14%', width: '27%', height: '28%' }} label="Source · watch" icon={ImageIcon}>
                <img src={SHOWCASE_SOURCE} className="w-full h-full object-cover" alt="watch source" />
            </ShowcaseWorkflowNode>
            <ShowcaseWorkflowNode style={{ left: '4%', top: '58%', width: '27%', height: '28%' }} label="Backdrops ×4" icon={Layers3}>
                <div className="grid grid-cols-2 grid-rows-2 gap-0.5 w-full h-full p-0.5">
                    <div className="rounded-sm bg-gradient-to-br from-slate-200 to-slate-100" />
                    <div className="rounded-sm bg-gradient-to-br from-slate-900 to-slate-600" />
                    <div className="rounded-sm bg-gradient-to-br from-fuchsia-400 to-cyan-400" />
                    <div className="rounded-sm bg-gradient-to-br from-amber-200 to-rose-300" />
                </div>
            </ShowcaseWorkflowNode>
            <ShowcaseWorkflowNode style={{ left: '40%', top: '33%', width: '26%', height: '34%' }} label="Image generation" icon={Wand2} accent>
                <div className="w-full h-full flex flex-col items-center justify-center gap-1.5">
                    <Wand2 className="w-6 h-6 text-accent-primary/70" />
                    <span className="text-[10px] font-medium text-content-tertiary">diffusion</span>
                </div>
            </ShowcaseWorkflowNode>
            <ShowcaseWorkflowNode style={{ left: '74%', top: '14%', width: '22%', height: '72%' }} label="Output ×4" icon={Play} accent>
                <div className="grid grid-cols-1 grid-rows-4 gap-0.5 w-full h-full p-0.5">
                    {SHOWCASE_RESULTS.map((o) => (
                        <div key={o.tag} className="relative rounded-sm overflow-hidden min-h-0">
                            <img src={o.src} className="w-full h-full object-cover" alt={o.tag} />
                        </div>
                    ))}
                </div>
            </ShowcaseWorkflowNode>
        </div>
    );
}

function ChatFirstShowcase() {
    return (
        <div className="hidden md:grid md:grid-cols-[1.1fr_1fr] gap-6 md:h-[520px]">
            <ShowcaseChatPanel />
            <ShowcaseWorkflow />
        </div>
    );
}

// =============================================================================
// AI MODELS SECTION (real data, colored by kind)
// =============================================================================

const KIND_STYLE: Record<string, { label: string; icon: any; chip: string; rail: string; glow: string }> = {
    image: { label: 'Image', icon: ImageIcon, chip: 'text-sky-300 border-sky-400/30 bg-sky-400/10', rail: 'bg-sky-400/70', glow: 'hover:shadow-[0_0_40px_-8px_rgba(56,189,248,0.3)]' },
    video: { label: 'Video', icon: Film, chip: 'text-indigo-300 border-indigo-400/30 bg-indigo-400/10', rail: 'bg-indigo-400/70', glow: 'hover:shadow-[0_0_40px_-8px_rgba(129,140,248,0.3)]' },
    audio: { label: 'Audio', icon: AudioLines, chip: 'text-teal-300 border-teal-400/30 bg-teal-400/10', rail: 'bg-teal-400/70', glow: 'hover:shadow-[0_0_40px_-8px_rgba(45,212,191,0.3)]' },
    text: { label: 'Text', icon: Type, chip: 'text-violet-300 border-violet-400/30 bg-violet-400/10', rail: 'bg-violet-400/70', glow: 'hover:shadow-[0_0_40px_-8px_rgba(167,139,250,0.3)]' },
    other: { label: 'Other', icon: Box, chip: 'text-cyan-300 border-cyan-400/30 bg-cyan-400/10', rail: 'bg-cyan-400/70', glow: 'hover:shadow-[0_0_40px_-8px_rgba(34,211,238,0.3)]' },
};
const kindStyle = (kind: string) => KIND_STYLE[kind] ?? KIND_STYLE.other;
const KIND_ORDER = ['image', 'video', 'audio', 'text', 'other'];

function ModelCard({ m }: { m: MarketingModel }) {
    const ks = kindStyle(m.kind);
    const Icon = ks.icon;
    return (
        <div className={cn(GLASS_CARD, ks.glow, 'p-5 flex flex-col gap-4')}>
            <div className={cn('absolute inset-x-0 top-0 h-0.5', ks.rail)} />
            <div className="flex items-center justify-between gap-2">
                {m.provider_logo
                    ? <img src={m.provider_logo} alt={m.provider ?? ''} className="h-5 w-auto max-w-[90px] object-contain opacity-80" />
                    : <span className="text-xs font-medium text-content-tertiary truncate">{m.provider ?? 'Prisfol'}</span>}
                <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium', ks.chip)}>
                    <Icon className="w-3 h-3" /> {ks.label}
                </span>
            </div>
            <h3 className="font-sans font-semibold text-content-primary text-base leading-snug normal-case">{m.display_name}</h3>
        </div>
    );
}

function ModelsSection() {
    const [models, setModels] = useState<MarketingModel[] | null>(null);
    const [active, setActive] = useState<string>('all');

    useEffect(() => {
        let cancelled = false;
        fetch('/api/marketing/models')
            .then((r) => r.json())
            .then((d) => { if (!cancelled) setModels(d.models ?? []); })
            .catch(() => { if (!cancelled) setModels([]); });
        return () => { cancelled = true; };
    }, []);

    const kinds = useMemo(() => {
        if (!models) return [];
        const present = new Set(models.map((m) => (KIND_STYLE[m.kind] ? m.kind : 'other')));
        return KIND_ORDER.filter((k) => present.has(k));
    }, [models]);

    const visible = useMemo(() => {
        if (!models) return [];
        const list = active === 'all' ? models : models.filter((m) => (KIND_STYLE[m.kind] ? m.kind : 'other') === active);
        return list;
    }, [models, active]);

    if (models && models.length === 0) return null; // soft-fail: hide if nothing

    return (
        <section className="relative w-full max-w-7xl mx-auto px-6 md:px-8 py-20 md:py-28" id="models">
            <SectionHeader tag="Models" title="Every frontier model, one canvas." description="Image, video, audio and language models — all live as drag-and-drop nodes you can chain together." center />

            {/* Filter pills */}
            {kinds.length > 0 && (
                <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
                    {['all', ...kinds].map((k) => {
                        const isActive = active === k;
                        const label = k === 'all' ? 'All' : kindStyle(k).label;
                        return (
                            <button
                                key={k}
                                onClick={() => setActive(k)}
                                className={cn(
                                    'relative px-4 py-2 rounded-full text-sm font-medium transition-colors',
                                    isActive ? 'text-content-primary' : 'text-content-tertiary hover:text-content-secondary'
                                )}
                            >
                                {isActive && <motion.span layoutId="modelPill" className="absolute inset-0 rounded-full bg-surface-elevated border border-stroke-subtle" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                                <span className="relative z-10">{label}</span>
                            </button>
                        );
                    })}
                </div>
            )}

            {!models ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="h-28 rounded-3xl border border-stroke-subtle/40 bg-surface-secondary/40 animate-pulse" />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {visible.map((m, i) => <ModelCard key={`${m.display_name}-${i}`} m={m} />)}
                </div>
            )}
        </section>
    );
}

// =============================================================================
// USE CASES SECTION (templates by category, swapping carousel)
// =============================================================================

function CategoryCarousel({ items }: { items: MarketingTemplate[] }) {
    const trackRef = useRef<HTMLDivElement>(null);
    const x = useMotionValue(0);
    const halfWidthRef = useRef(0);
    const isDraggingRef = useRef(false);

    useEffect(() => {
        const measure = () => { if (trackRef.current) halfWidthRef.current = trackRef.current.scrollWidth / 2; };
        measure();
        const ro = new ResizeObserver(measure);
        if (trackRef.current) ro.observe(trackRef.current);
        window.addEventListener('resize', measure);
        return () => { window.removeEventListener('resize', measure); ro.disconnect(); };
    }, [items]);

    useAnimationFrame((_, delta) => {
        if (isDraggingRef.current) return;
        const half = halfWidthRef.current;
        if (half === 0) return;
        let next = x.get() - delta * (half / 80000);
        while (next <= -half) next += half;
        while (next > 0) next -= half;
        x.set(next);
    });

    const wrapX = () => {
        const half = halfWidthRef.current;
        if (half === 0) return;
        let cur = x.get();
        while (cur <= -half) cur += half;
        while (cur > 0) cur -= half;
        x.set(cur);
    };

    // Duplicate so the marquee loops; if too few items the duplication still works.
    const loop = items.length > 0 ? [...items, ...items] : [];

    return (
        <div className="relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-24 md:w-40 z-10 bg-gradient-to-r from-surface-primary to-transparent pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-24 md:w-40 z-10 bg-gradient-to-l from-surface-primary to-transparent pointer-events-none" />
            <motion.div
                ref={trackRef}
                className="flex gap-6 items-center w-max select-none"
                style={{ x }}
                drag="x"
                dragMomentum={false}
                onDragStart={() => { isDraggingRef.current = true; }}
                onDrag={wrapX}
                onDragEnd={() => { wrapX(); isDraggingRef.current = false; }}
            >
                {loop.map((t, i) => (
                    <Link
                        key={`${t.id}-${i}`}
                        href={appUrl('/templates')}
                        className="relative shrink-0 w-[78vw] md:w-[40vw] lg:w-[32vw] aspect-[5/3] rounded-3xl overflow-hidden border border-stroke-subtle/70 group"
                    >
                        {t.thumbnail_url
                            ? <img src={t.thumbnail_url} draggable={false} className="absolute inset-0 w-full h-full object-cover pointer-events-none transition-transform duration-1000 group-hover:scale-[1.04]" alt={t.name} loading="lazy" />
                            : <div className="absolute inset-0 bg-surface-tertiary" />}
                        <div className="absolute inset-0 bg-gradient-to-t from-surface-primary via-surface-primary/40 to-transparent pointer-events-none" />
                        <div className="absolute bottom-5 left-5 right-5 pointer-events-none">
                            {t.category && <div className="text-xs font-semibold tracking-wide text-accent-primary mb-2">{t.category}</div>}
                            <h3 className="font-sans normal-case font-semibold text-xl md:text-2xl text-white leading-snug">{t.name}</h3>
                            {t.description && <p className="mt-2 text-sm text-white/70 max-w-sm leading-relaxed line-clamp-2">{t.description}</p>}
                        </div>
                    </Link>
                ))}
            </motion.div>
        </div>
    );
}

function UseCasesSection() {
    const [templates, setTemplates] = useState<MarketingTemplate[] | null>(null);
    const [active, setActive] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch('/api/marketing/templates')
            .then((r) => r.json())
            .then((d) => { if (!cancelled) setTemplates(d.templates ?? []); })
            .catch(() => { if (!cancelled) setTemplates([]); });
        return () => { cancelled = true; };
    }, []);

    const categories = useMemo(() => {
        if (!templates) return [];
        const seen = new Set<string>();
        const out: string[] = [];
        for (const t of templates) {
            if (t.category && !seen.has(t.category)) { seen.add(t.category); out.push(t.category); }
        }
        return out;
    }, [templates]);

    useEffect(() => {
        if (active === null && categories.length > 0) setActive(categories[0]);
    }, [categories, active]);

    if (templates && templates.length === 0) return null; // soft-fail

    const visible = templates && active ? templates.filter((t) => t.category === active) : [];

    return (
        <section className="relative w-full py-20 md:py-28" id="use-cases">
            <div className="max-w-7xl mx-auto px-6 md:px-8">
                <SectionHeader tag="Use cases" title="Built for what you actually ship." description="Open a real workflow on the canvas, swap in your assets, and render. Pick a category to explore." center />
            </div>

            {/* Category selector */}
            {categories.length > 0 && (
                <div className="max-w-7xl mx-auto px-6 md:px-8 mb-10">
                    <div className="flex gap-2 overflow-x-auto pb-2 justify-start md:justify-center [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {categories.map((c) => {
                            const isActive = active === c;
                            return (
                                <button
                                    key={c}
                                    onClick={() => setActive(c)}
                                    className={cn(
                                        'relative shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors',
                                        isActive ? 'text-content-primary' : 'text-content-tertiary hover:text-content-secondary'
                                    )}
                                >
                                    {isActive && <motion.span layoutId="useCasePill" className="absolute inset-0 rounded-full bg-surface-elevated border border-stroke-subtle" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                                    <span className="relative z-10">{c}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Swapping carousel — remount per category resets + re-measures the track */}
            {!templates ? (
                <div className="max-w-7xl mx-auto px-6 md:px-8 flex gap-6">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="shrink-0 w-[32vw] aspect-[5/3] rounded-3xl border border-stroke-subtle/40 bg-surface-secondary/40 animate-pulse" />
                    ))}
                </div>
            ) : (
                <AnimatePresence mode="wait">
                    <motion.div
                        key={active ?? 'none'}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        <CategoryCarousel items={visible} />
                    </motion.div>
                </AnimatePresence>
            )}

            <div className="flex justify-center mt-12">
                <Link href={appUrl('/templates')} className="group flex items-center gap-3 px-6 py-3 rounded-xl border border-stroke-subtle/70 text-sm font-medium text-content-primary hover:bg-interactive-hover transition-all">
                    Browse all templates
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                </Link>
            </div>
        </section>
    );
}

// =============================================================================
// PRICING SECTION
// =============================================================================

// Per-tier visual identity (keyed by plan id). Free = gray/white, the highlighted
// tier = primary cyan, Studio (renamed Professional) = gold, Enterprise = violet.
const PLAN_THEME: Record<string, { display?: string; title: string; icon: string; ring: string; btn: string; chip: string; glow: string; popular?: boolean }> = {
    free: { title: 'text-content-primary', icon: 'text-content-tertiary', ring: 'border-stroke-subtle/70', btn: 'bg-surface-tertiary text-content-primary hover:bg-interactive-active', chip: 'bg-white/10 text-content-secondary border border-white/15', glow: 'hover:shadow-[0_0_40px_-8px_rgba(148,163,184,0.2)]' },
    starter: { title: 'text-emerald-300', icon: 'text-emerald-400', ring: 'border-emerald-400/30', btn: 'bg-emerald-400 text-surface-primary hover:brightness-110', chip: 'bg-emerald-400/10 text-emerald-300 border border-emerald-400/30', glow: 'hover:shadow-[0_0_40px_-8px_rgba(52,211,153,0.3)]' },
    pro: { title: 'text-accent-primary', icon: 'text-accent-primary', ring: 'border-accent-primary/50', btn: 'bg-accent-primary text-surface-primary hover:brightness-110', chip: 'bg-accent-primary/10 text-accent-primary border border-accent-primary/30', glow: 'hover:shadow-[0_0_40px_-8px_rgba(56,189,248,0.35)]', popular: true },
    studio: { display: 'Professional', title: 'text-amber-300', icon: 'text-amber-400', ring: 'border-amber-400/40', btn: 'bg-amber-400 text-surface-primary hover:brightness-110', chip: 'bg-amber-400/10 text-amber-300 border border-amber-400/30', glow: 'hover:shadow-[0_0_40px_-8px_rgba(251,191,36,0.35)]' },
};
const planTheme = (id: string) => PLAN_THEME[id] ?? PLAN_THEME.free;

// Rough, tmp output estimates from the monthly credit budget.
function approxOutputs(credits: number) {
    return {
        images: Math.max(1, Math.round(credits / 5)),
        videos: Math.max(1, Math.round(credits / 80)),
        audio: Math.max(1, Math.round(credits / 15)),
    };
}

// Contextual icon per feature line (members/support/rollover/etc.) instead of a
// uniform check mark.
function featureIcon(text: string) {
    const t = text.toLowerCase();
    if (/(team|seat|member)/.test(t)) return Users;
    if (/support/.test(t)) return LifeBuoy;
    if (/roll/.test(t)) return RefreshCw;
    if (/(queue|priority|fast)/.test(t)) return Zap;
    if (/model/.test(t)) return Cpu;
    if (/workflow/.test(t)) return Workflow;
    if (/template/.test(t)) return LayoutTemplate;
    if (/(credit|bonus)/.test(t)) return Coins;
    if (/(a\/b|test)/.test(t)) return GitBranch;
    if (/(early|new)/.test(t)) return Sparkles;
    if (/brand/.test(t)) return Palette;
    if (/save/.test(t)) return Save;
    if (/community/.test(t)) return Users;
    return Check;
}

function InfoTip({ text }: { text: string }) {
    return (
        <Tooltip.Root delayDuration={120}>
            <Tooltip.Trigger asChild>
                <button type="button" aria-label="More info" className="inline-flex align-middle text-content-tertiary hover:text-content-secondary transition-colors">
                    <Info className="w-3.5 h-3.5" />
                </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
                <Tooltip.Content sideOffset={6} className="popover-animate z-[130] max-w-[220px] rounded-lg border border-stroke-subtle bg-surface-elevated px-3 py-2 text-xs leading-relaxed text-content-secondary shadow-xl">
                    {text}
                    <Tooltip.Arrow className="fill-surface-elevated" />
                </Tooltip.Content>
            </Tooltip.Portal>
        </Tooltip.Root>
    );
}

function PlanCard({ plan }: { plan: PlanDisplay }) {
    const theme = planTheme(plan.id);
    const name = theme.display ?? plan.name;
    return (
        <div className={cn(
            'relative flex h-full flex-col rounded-3xl border bg-surface-secondary/60 backdrop-blur-xl p-6 shadow-[0_8px_32px_rgba(0,0,0,0.25)] transition-all duration-300',
            theme.ring, theme.glow, theme.popular && 'bg-accent-primary/[0.05]'
        )}>
            <h3 className={cn('font-display normal-case font-semibold tracking-tight text-xl', theme.title)}>{name}</h3>
            <p className="mt-1 text-sm text-content-tertiary">{plan.tagline}</p>

            <div className="mt-5 flex items-baseline gap-1">
                <span className="font-display text-3xl font-semibold text-content-primary">${plan.priceMonthly}</span>
                <span className="text-xs font-medium text-content-tertiary">/ mo</span>
            </div>
            <p className="mt-1 text-xs text-content-tertiary">
                {plan.priceYearly != null && plan.priceYearly > 0
                    ? <>or <span className="text-content-secondary font-semibold">${plan.priceYearly}</span> billed yearly</>
                    : <>&nbsp;</>}
            </p>

            <div className="mt-4 flex items-center gap-2">
                <CreditCard className={cn('w-4 h-4', theme.icon)} />
                <span className={cn('text-sm font-semibold', theme.title)}>{plan.monthlyCredits.toLocaleString()} credits / month</span>
            </div>

            {/* Approx. output — counts only (tmp estimates) */}
            {(() => {
                const out = approxOutputs(plan.monthlyCredits);
                const rows = [
                    { icon: ImageIcon, label: `~${out.images.toLocaleString()} images` },
                    { icon: Film, label: `~${out.videos.toLocaleString()} videos` },
                    { icon: AudioLines, label: `~${out.audio.toLocaleString()} audio clips` },
                ];
                return (
                    <div className="mt-5 rounded-xl border border-stroke-subtle/60 bg-surface-primary/40 p-3 space-y-2">
                        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-content-tertiary">Approx. monthly output</p>
                        {rows.map((r) => (
                            <div key={r.label} className="flex items-center gap-1.5 text-xs text-content-secondary">
                                <r.icon className={cn('w-3.5 h-3.5', theme.icon)} />{r.label}
                            </div>
                        ))}
                    </div>
                );
            })()}

            <ul className="mt-5 space-y-2.5 border-t border-stroke-subtle/60 pt-5">
                {plan.features.map((f) => {
                    const Icon = featureIcon(f);
                    const isRollover = /roll/.test(f.toLowerCase());
                    return (
                        <li key={f} className="flex items-start gap-2.5 text-sm leading-snug text-content-secondary">
                            <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', theme.icon)} />
                            <span className="inline-flex items-center gap-1.5">
                                {f}
                                {isRollover && <InfoTip text="Unused monthly credits carry over into the next month while your subscription stays active, so nothing you paid for goes to waste." />}
                            </span>
                        </li>
                    );
                })}
            </ul>

            <div className="mt-auto pt-6">
                <Link href={appUrl('/')} className={cn('flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all', theme.btn)}>
                    {plan.priceMonthly === 0 ? 'Start free' : `Get ${name}`}
                </Link>
            </div>
        </div>
    );
}

function EnterpriseCard({ onContact }: { onContact: () => void }) {
    const features = [
        'SSO / SAML & advanced security',
        'Unlimited team seats',
        'Dedicated infrastructure & SLA',
        'Custom & private models',
        'Volume credit pricing',
        'Dedicated account manager',
    ];
    return (
        <div className="relative mt-6 rounded-3xl border border-violet-400/30 bg-surface-secondary/60 backdrop-blur-xl p-8 md:p-10 overflow-hidden">
            <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-violet-500/10 blur-3xl" />
            <div className="relative z-10 flex flex-col md:flex-row md:items-center gap-8 justify-between">
                <div className="max-w-xl">
                    <div className="flex items-center gap-2">
                        <Building2 className="w-5 h-5 text-violet-300" />
                        <h3 className="font-display normal-case font-semibold tracking-tight text-2xl text-violet-300">Enterprise</h3>
                    </div>
                    <p className="mt-2 text-sm text-content-secondary leading-relaxed">For organizations running at scale — custom volume, security and support, tailored to your team.</p>
                    <ul className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {features.map((f) => (
                            <li key={f} className="flex items-start gap-2.5 text-sm text-content-secondary"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" /><span>{f}</span></li>
                        ))}
                    </ul>
                </div>
                <div className="shrink-0 flex flex-col items-start md:items-end gap-3">
                    <div className="text-content-tertiary text-sm">Custom pricing</div>
                    <button onClick={onContact} className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold bg-violet-400 text-surface-primary hover:brightness-110 transition-all">
                        <Mail className="w-4 h-4" /> Contact us
                    </button>
                </div>
            </div>
        </div>
    );
}

function ContactModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
    const email = 'support@prisfol.com';
    return (
        <Modal open={open} onOpenChange={onOpenChange} size="md" srTitle="Contact sales">
            <Modal.Header><Modal.Title>Let’s talk Enterprise</Modal.Title></Modal.Header>
            <Modal.Body>
                <p className="text-sm text-content-secondary leading-relaxed">
                    Tell us about your team and what you need. We’ll put together a plan with the right volume, security and support, and get back to you within one business day.
                </p>
                <a href={`mailto:${email}?subject=Prisfol%20Enterprise%20enquiry`} className="mt-5 flex items-center gap-3 rounded-xl border border-stroke-subtle/70 bg-surface-secondary/60 px-4 py-3 hover:border-accent-primary/40 transition-all">
                    <Mail className="w-4 h-4 text-accent-primary" />
                    <span className="text-sm font-medium text-content-primary">{email}</span>
                    <ArrowRight className="w-4 h-4 ml-auto text-content-tertiary" />
                </a>
            </Modal.Body>
        </Modal>
    );
}

function PackCard({ pack }: { pack: CreditPack }) {
    const perCredit = (pack.price / pack.credits).toFixed(3);
    return (
        <div className={cn(GLASS_CARD, 'p-6 flex flex-col')}>
            <h3 className={cn(H3, 'text-base')}>{pack.name}</h3>
            <p className="mt-1 text-sm text-content-tertiary">{pack.tagline}</p>
            <div className="mt-5 flex items-baseline gap-1">
                <span className="font-display text-2xl font-semibold text-content-primary">${pack.price}</span>
            </div>
            <p className="mt-2 text-sm font-semibold text-accent-primary">{pack.credits.toLocaleString()} credits</p>
            <p className="mt-1 text-xs text-content-tertiary">≈ ${perCredit} per credit</p>
        </div>
    );
}

function PricingSection({ plans, packs }: { plans: PlanDisplay[]; packs: CreditPack[] }) {
    const [contactOpen, setContactOpen] = useState(false);
    return (
        <section className="relative w-full max-w-7xl mx-auto px-6 md:px-8 py-20 md:py-28 scroll-mt-24" id="pricing">
            <SectionHeader tag="Pricing" title="Simple, credit-based pricing." description="Every plan runs on credits — you spend them when you generate. Start free, upgrade or top up whenever you need more." center />
            {plans.length > 0 && (
                <>
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 items-stretch">
                        {plans.map((p) => <PlanCard key={p.id} plan={p} />)}
                    </div>
                    <EnterpriseCard onContact={() => setContactOpen(true)} />
                    <ContactModal open={contactOpen} onOpenChange={setContactOpen} />
                    <p className="mt-4 text-xs text-content-tertiary text-center">Annual billing saves you roughly two months versus paying monthly.</p>
                </>
            )}
            {packs.length > 0 && (
                <div className="mt-16">
                    <h3 className={cn(H3, 'text-center mb-2')}>One-time credit packs</h3>
                    <p className="mb-8 text-sm text-content-tertiary text-center max-w-xl mx-auto">Need a burst of credits without changing your plan? Top-up packs work on any tier, including Free.</p>
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-3 max-w-4xl mx-auto">
                        {packs.map((p) => <PackCard key={p.id} pack={p} />)}
                    </div>
                </div>
            )}
            <div className="flex justify-center mt-12">
                <Link href={appUrl('/')} className="group flex items-center gap-3 px-7 py-3.5 rounded-2xl bg-accent-primary text-surface-primary font-semibold hover:brightness-110 transition-all">
                    Start free
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Link>
            </div>
        </section>
    );
}

// =============================================================================
// FAQ SECTION
// =============================================================================

const FAQS: { q: string; a: React.ReactNode }[] = [
    { q: 'What is Prisfol?', a: 'Prisfol is a visual engine for AI image and video workflows. Describe what you want in plain language and it builds the workflow, wires the right models, and renders the result — or drop nodes on the canvas yourself.' },
    { q: 'What is a credit?', a: 'Credits are how you pay for generative work. Each action — generating an image, running a model, processing an asset — consumes a number of credits depending on the model and settings. Lighter actions cost less; premium models cost more.' },
    { q: 'Do unused credits roll over?', a: 'On paid plans, credits you don’t use roll over to the next month while your subscription is active. Free-plan credits refill monthly and do not accumulate. Exact rollover and expiration rules are shown at the point of purchase.' },
    { q: 'Can I change plans or buy more later?', a: 'Yes. You can upgrade, downgrade or cancel any time from inside the app, and one-time credit packs can be added to any plan whenever you run low.' },
    { q: 'Which models can I use?', a: 'Prisfol gives you access to leading image, video, audio and language models from across the industry — all as drag-and-drop nodes you can chain together on one canvas.' },
    { q: 'Is there a free tier?', a: 'Yes — you can start free with no credit card and a batch of free credits, so you can build and render your first workflows right away.' },
    { q: 'What about taxes?', a: 'Prices shown exclude tax. Any applicable sales tax, VAT or GST is calculated and added at checkout by Dodo Payments, our Merchant of Record, based on your billing location.' },
];

function FaqItem({ q, a }: { q: string; a: React.ReactNode }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="border-b border-stroke-subtle/60">
            <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-4 py-5 text-left">
                <span className="font-sans font-semibold text-content-primary text-base md:text-lg">{q}</span>
                <span className="shrink-0 text-accent-primary">{open ? <Minus className="w-4 h-4" /> : <Plus className="w-4 h-4" />}</span>
            </button>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
                        <p className="pb-5 text-sm md:text-base leading-relaxed text-content-secondary max-w-2xl">{a}</p>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function FaqSection() {
    return (
        <section className="relative w-full max-w-3xl mx-auto px-6 md:px-8 py-20 md:py-28 scroll-mt-24" id="faq">
            <SectionHeader tag="FAQ" title="Questions, answered." center />
            <div>
                {FAQS.map((f) => <FaqItem key={f.q} q={f.q} a={f.a} />)}
            </div>
        </section>
    );
}

// =============================================================================
// MAIN
// =============================================================================

function Divider() {
    return <div className="mx-auto max-w-7xl px-6 md:px-8"><div className="h-px bg-gradient-to-r from-transparent via-stroke-subtle to-transparent" /></div>;
}

export default function HomeClient({ plans, packs }: { plans: PlanDisplay[]; packs: CreditPack[] }) {
    const { createNewSession, isLoading } = useSession();
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    return (
        <div className="relative min-h-screen w-full bg-surface-primary mesh-gradient text-content-primary flex flex-col items-center overflow-x-clip" suppressHydrationWarning>
            <div className="relative z-10 w-full flex flex-col items-center overflow-x-clip">
                <MarketingHeader homeBaseHref="" />

                {/* Hero */}
                <section className="relative w-full flex flex-col items-center pt-32 md:pt-40 pb-12 md:pb-16" id="top">
                    <div className="pointer-events-none absolute top-10 left-1/2 -translate-x-1/2 -z-0 h-72 w-72 rounded-full bg-accent-primary/10 blur-[120px]" />
                    <motion.div
                        initial={{ opacity: 0, y: 30, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                        className="relative z-20 w-full max-w-3xl px-5 md:px-6 flex flex-col items-center text-center gap-6 md:gap-8"
                    >
                        <div className="space-y-4 md:space-y-5">
                            <h1 className={H1}>The visual engine for your <span className="text-accent-primary">imagination</span>.</h1>
                            <p className={cn(LEAD, 'mx-auto max-w-lg')}>Describe it. Prisfol builds the workflow, wires the models, and renders it.</p>
                        </div>
                        <HeroChatInput />
                        <button
                            onClick={() => { const dest = appUrl('/'); if (dest.startsWith('http')) { window.location.href = dest; return; } createNewSession(); }}
                            disabled={isLoading}
                            className="group inline-flex items-center gap-2 text-sm font-medium text-content-tertiary hover:text-content-primary transition-colors"
                        >
                            {isLoading ? <div className="w-3.5 h-3.5 border-2 border-accent-secondary border-t-transparent animate-spin rounded-full" /> : <Workflow className="w-3.5 h-3.5 text-accent-secondary" />}
                            Or start from a blank canvas
                            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                        </button>
                    </motion.div>
                </section>

                {/* Brand strip */}
                {mounted && (
                    <motion.div className="w-full pb-4" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}>
                        <BrandCarousel />
                    </motion.div>
                )}

                <Divider />

                {/* Demo video (no mac chrome) */}
                <section className="w-full max-w-6xl px-6 md:px-8 py-20 md:py-28">
                    <SectionHeader tag="Demo" title="See it move." description="A 30-second look inside a real Prisfol session." center />
                    <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }} className="relative">
                        <div className="absolute -inset-x-12 -bottom-8 h-32 bg-accent-primary/20 blur-[100px] pointer-events-none" />
                        <div className="absolute -inset-x-12 -top-8 h-32 bg-accent-secondary/15 blur-[100px] pointer-events-none" />
                        <div className="relative rounded-3xl overflow-hidden border border-stroke-subtle/70 bg-surface-secondary shadow-[0_30px_80px_-20px_rgba(56,189,248,0.25)]">
                            <video src="https://wyqkbwpybqokmtlghdsr.supabase.co/storage/v1/object/public/chat-assets/demo.mp4" className="block w-full h-auto" autoPlay loop muted playsInline />
                        </div>
                    </motion.div>
                </section>

                {/* Capabilities */}
                <section className="relative w-full max-w-7xl px-6 md:px-8 py-20 md:py-28" id="capabilities">
                    <SectionHeader tag="Capabilities" title="Everything you need to make. Nothing in the way." description="Six core primitives. Mix them on the canvas to build any visual pipeline." center />
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5 auto-rows-[260px]">
                        {CAPABILITIES.map((c) => <CapabilityCard key={c.title} {...c} />)}
                    </div>
                </section>

                {/* Chat-first showcase */}
                <section className="relative w-full max-w-7xl px-6 md:px-8 py-20 md:py-28" id="chat-first">
                    <SectionHeader tag="Chat-first" title="Or just type. We'll build it." description="Skip the canvas if you want. Tell Prisfol what you need in plain English — it lays out the nodes, picks the right models, and runs the graph." center />
                    <ChatFirstShowcase />
                </section>

                <Divider />

                {/* AI Models */}
                <ModelsSection />

                {/* Use cases */}
                <UseCasesSection />

                {/* Live gallery */}
                <section className="w-full max-w-7xl px-6 md:px-8 py-20 md:py-28 relative">
                    <SectionHeader tag="Gallery" title="Made by creators, on the canvas." description="A live look at workflows shipping right now." center />
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 [mask-image:linear-gradient(to_bottom,transparent,black_15%,black_85%,transparent)]">
                        <GalleryColumn images={GALLERY_IMAGES.slice(0, 6)} direction="up" duration={50} />
                        <GalleryColumn images={GALLERY_IMAGES.slice(3, 9)} direction="down" duration={70} />
                        <GalleryColumn images={GALLERY_IMAGES.slice(6, 12)} direction="up" duration={60} className="hidden md:block" />
                        <GalleryColumn images={GALLERY_IMAGES.slice(2, 8)} direction="down" duration={55} className="hidden md:block" />
                    </div>
                </section>

                <Divider />

                {/* Pricing */}
                <PricingSection plans={plans} packs={packs} />

                {/* FAQ */}
                <FaqSection />

                {/* Final CTA */}
                <section className="w-full max-w-7xl px-6 md:px-8 py-16 md:py-28">
                    <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }} className="relative overflow-hidden rounded-[2rem] border border-stroke-subtle/70 bg-surface-secondary/60 backdrop-blur-xl p-12 md:p-20 text-center">
                        <div className="absolute inset-0 opacity-40">
                            <div className="absolute top-0 left-1/4 w-[40rem] h-[40rem] rounded-full bg-accent-primary/30 blur-[120px]" />
                            <div className="absolute bottom-0 right-1/4 w-[40rem] h-[40rem] rounded-full bg-accent-secondary/30 blur-[120px]" />
                        </div>
                        <div className="relative z-10 flex flex-col items-center gap-8 max-w-3xl mx-auto">
                            <span className={EYEBROW}><Sparkles className="w-3.5 h-3.5" /> Your turn</span>
                            <h2 className={cn(H2, 'text-3xl md:text-5xl')}>Build your first workflow in <span className="text-accent-primary">60 seconds</span>.</h2>
                            <PromptRotator />
                            <div className="flex flex-col sm:flex-row gap-4 pt-2">
                                <MagneticButton href={appUrl('/')}>
                                    <div className="group flex items-center justify-center gap-3 px-10 py-5 rounded-2xl bg-accent-primary text-surface-primary font-semibold text-base hover:brightness-110 transition-all shadow-2xl">
                                        Start building
                                        <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                                    </div>
                                </MagneticButton>
                                <Link href={appUrl('/templates')} className="flex items-center justify-center gap-3 px-10 py-5 rounded-2xl border border-stroke-subtle/70 text-content-primary font-semibold text-base hover:bg-interactive-hover transition-all">
                                    <Layers3 className="w-5 h-5" /> Browse templates
                                </Link>
                            </div>
                            <div className="flex flex-wrap items-center justify-center gap-6 pt-4 text-xs font-medium text-content-tertiary">
                                <div className="flex items-center gap-2"><Shield className="w-3.5 h-3.5" /> No credit card</div>
                                <div className="flex items-center gap-2"><Zap className="w-3.5 h-3.5" /> 100 free credits</div>
                                <div className="flex items-center gap-2"><Globe2 className="w-3.5 h-3.5" /> Cancel any time</div>
                            </div>
                        </div>
                    </motion.div>
                </section>

                <MarketingFooter />
            </div>
        </div>
    );
}
