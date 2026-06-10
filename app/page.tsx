'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, useScroll, useTransform, AnimatePresence, useMotionValue, useSpring, useInView, MotionValue, animate, useAnimationFrame } from 'framer-motion';
import {
    ArrowRight,
    Play,
    Workflow,
    Activity,
    Target,
    Image as ImageIcon,
    Wand2,
    Layers3,
    Eraser,
    Maximize2,
    Film,
    Zap,
    Cpu,
    Globe2,
    Shield,
    Network,
    GitBranch,
    Scissors,
    MessageSquare,
    Send,
    X
} from 'lucide-react';
import { BrandCarousel } from '@/components/ui/BrandCarousel';
import { Logo } from '@/components/ui/Logo';
import { useSession } from '@/lib/hooks/use-session';
import { cn } from '@/lib/utils';

const PrisfolLogo = ({ className, dark = false }: { className?: string, dark?: boolean }) => (
    <Logo
        variant="wordmark"
        className={cn("h-7 w-auto", dark ? "text-white" : "text-slate-900", className)}
    />
);

const SectionHeader = ({ tag, title, description, dark = false, center = false }: { tag: string, title: string, description?: string, dark?: boolean, center?: boolean }) => (
    <motion.div
        initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
        whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        className={cn("mb-12 space-y-5", center && "text-center flex flex-col items-center")}
    >
        <span className="text-[7px] font-black uppercase tracking-[0.5em] text-accent-primary opacity-60">{tag}</span>
        <h2 className={cn(
            "text-2xl md:text-4xl font-black leading-tight uppercase font-display",
            dark ? "text-white" : "text-slate-900"
        )}>
            {title}
        </h2>
        {description && (
            <p className={cn(
                "text-xs max-w-lg leading-relaxed font-bold uppercase tracking-wider",
                dark ? "text-slate-400" : "text-slate-500"
            )}>
                {description}
            </p>
        )}
    </motion.div>
);

// =============================================================================
// HERO CHAT INPUT (typewriter prompt suggestions + jump straight into a chat)
// =============================================================================

// Rotating, action-oriented prompts that get "typed" into the empty input so a
// first-time visitor instantly sees what they can ask for.
const HERO_PROMPTS = [
    'A cinematic portrait, 35mm film, golden-hour light…',
    'Turn this product photo into a neon studio hero shot…',
    'Generate an isometric dashboard in a mint & slate palette…',
    'Remove the background and drop the subject on marble…',
    'An editorial fashion shoot on a brutalist concrete set…',
    'Ghibli-style landscape with hand-painted clouds…',
    'Restore and upscale this old photo to crisp 4K…',
];

// One-tap starters. Clicking sends the full `prompt`; the chip shows the short label.
const HERO_CHIPS: { label: string; prompt: string }[] = [
    { label: 'Product hero shot', prompt: 'Create a clean product hero shot on a seamless studio backdrop with soft rim lighting.' },
    { label: 'Cinematic portrait', prompt: 'A cinematic portrait, 35mm film, shallow depth of field, warm golden-hour light.' },
    { label: 'Remove background', prompt: 'Remove the background from my image and place the subject on a polished marble surface.' },
    { label: 'Restore old photo', prompt: 'Restore and upscale this old photo to crisp 4K with natural, true-to-life color.' },
];

// A self-deleting typewriter. Types a phrase, holds, deletes, advances to the
// next. `active` lets the caller freeze + clear it the moment the user starts
// typing for real (the live text takes over from the animated placeholder).
function useTypewriter(
    phrases: string[],
    { typeSpeed = 42, deleteSpeed = 22, holdTime = 1700, active = true }: { typeSpeed?: number; deleteSpeed?: number; holdTime?: number; active?: boolean } = {}
) {
    const [text, setText] = useState('');
    const [phraseIdx, setPhraseIdx] = useState(0);
    const phaseRef = useRef<'typing' | 'holding' | 'deleting'>('typing');

    useEffect(() => {
        if (!active) {
            setText('');
            phaseRef.current = 'typing';
        }
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
                timer = setTimeout(() => {
                    phaseRef.current = 'deleting';
                    setText(current.slice(0, current.length - 1));
                }, holdTime);
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

// The hero centerpiece: a large, glassy composer. Typing here and hitting send
// stashes the prompt and jumps to /chat, where ChatInterface auto-submits it —
// so the visitor lands mid-conversation with a workflow already building.
function HeroChatInput() {
    const router = useRouter();
    const [value, setValue] = useState('');
    const [focused, setFocused] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const placeholder = useTypewriter(HERO_PROMPTS, { active: value.length === 0 && !focused });

    const submit = (text?: string) => {
        const t = (text ?? value).trim();
        if (!t || leaving) {
            if (!t) textareaRef.current?.focus();
            return;
        }
        try {
            sessionStorage.setItem('prismai:pendingPrompt', t);
        } catch {
            // Private-mode / blocked storage: fall through and let the user type
            // again on the chat page rather than hard-failing.
        }
        setLeaving(true);
        router.push('/chat');
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
    };

    // Grow with content, capped so a long paste doesn't take over the hero.
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
            <div
                className={cn(
                    "relative rounded-[1.9rem] border bg-white/80 backdrop-blur-xl shadow-2xl shadow-slate-900/10 transition-colors duration-500 overflow-hidden",
                    focused ? "border-accent-primary/50" : "border-slate-200/80"
                )}
            >
                {/* Top hairline accent */}
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent-primary/60 to-transparent" />

                <div className="relative flex items-end gap-2.5 p-3 md:p-4">
                    {/* Textarea + animated placeholder overlay */}
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
                            className="relative z-10 w-full resize-none bg-transparent text-slate-900 text-base md:text-lg font-medium leading-relaxed outline-none placeholder:text-transparent max-h-[220px]"
                        />
                        {value.length === 0 && (
                            <div className="pointer-events-none absolute inset-0 z-0 flex items-start pl-2 text-base md:text-lg font-medium text-slate-400 leading-relaxed">
                                <span className="whitespace-pre-wrap">{placeholder}</span>
                                <span className="ml-0.5 mt-[0.15em] inline-block w-[2px] h-[1.15em] bg-accent-primary animate-pulse" />
                            </div>
                        )}
                    </div>

                    {/* Send */}
                    <button
                        type="button"
                        onClick={() => submit()}
                        disabled={leaving}
                        aria-label="Start building"
                        className={cn(
                            "group shrink-0 flex items-center justify-center w-11 h-11 md:w-12 md:h-12 rounded-2xl transition-all duration-300 shadow-lg",
                            value.trim()
                                ? "bg-accent-primary text-slate-900 hover:scale-105"
                                : "bg-slate-900 text-white hover:bg-slate-800"
                        )}
                    >
                        {leaving ? (
                            <div className="w-5 h-5 border-2 border-current border-t-transparent animate-spin rounded-full" />
                        ) : (
                            <ArrowRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                        )}
                    </button>
                </div>
            </div>

            {/* One-tap starters */}
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2 px-2">
                {HERO_CHIPS.map((chip) => (
                    <button
                        key={chip.label}
                        type="button"
                        onClick={() => submit(chip.prompt)}
                        disabled={leaving}
                        className="inline-flex items-center px-3.5 py-2 rounded-full bg-white/70 backdrop-blur-md border border-slate-200 text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 hover:text-slate-900 hover:border-accent-primary/50 hover:bg-white transition-all shadow-sm"
                    >
                        {chip.label}
                    </button>
                ))}
            </div>
        </motion.div>
    );
}

// =============================================================================
// ANIMATED COUNTER
// =============================================================================

function AnimatedCounter({ value, suffix = '', duration = 1.6 }: { value: number; suffix?: string; duration?: number }) {
    const ref = useRef<HTMLSpanElement>(null);
    const inView = useInView(ref, { once: true, margin: '-20%' });
    const motionValue = useMotionValue(0);
    const spring = useSpring(motionValue, { duration: duration * 1000, bounce: 0 });
    const [display, setDisplay] = useState('0');

    useEffect(() => {
        if (inView) motionValue.set(value);
    }, [inView, motionValue, value]);

    useEffect(() => {
        return spring.on('change', (latest) => {
            setDisplay(Math.round(latest).toLocaleString('en-US'));
        });
    }, [spring]);

    return <span ref={ref}>{display}{suffix}</span>;
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
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        x.set((e.clientX - cx) * 0.18);
        y.set((e.clientY - cy) * 0.18);
    };

    const handleLeave = () => {
        x.set(0);
        y.set(0);
    };

    const inner = (
        <motion.div
            ref={ref}
            style={{ x: xs, y: ys }}
            onMouseMove={handleMove}
            onMouseLeave={handleLeave}
            className={cn("inline-block", disabled && "opacity-60 pointer-events-none")}
        >
            {children}
        </motion.div>
    );

    if (href) return <Link href={href} className={className} onClick={onClick}>{inner}</Link>;
    return <button onClick={onClick} disabled={disabled} className={className}>{inner}</button>;
}

// =============================================================================
// CAPABILITY BENTO CARD
// =============================================================================

function CapabilityCard({
    icon: Icon,
    title,
    desc,
    image,
    span,
    accent
}: {
    icon: any;
    title: string;
    desc: string;
    image?: string;
    span?: string;
    accent?: boolean;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [tilt, setTilt] = useState({ rx: 0, ry: 0 });

    const handleMove = (e: React.MouseEvent) => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        setTilt({ rx: (py - 0.5) * -6, ry: (px - 0.5) * 6 });
    };
    const handleLeave = () => setTilt({ rx: 0, ry: 0 });

    return (
        <motion.div
            ref={ref}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            onMouseMove={handleMove}
            onMouseLeave={handleLeave}
            style={{ transform: `perspective(1200px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)` }}
            className={cn(
                "relative group rounded-3xl border border-slate-200 bg-white overflow-hidden transition-shadow duration-500 hover:shadow-2xl",
                "p-8 flex flex-col gap-6",
                span
            )}
        >
            {image && (
                <div className="absolute inset-0 -z-0 opacity-[0.08] group-hover:opacity-[0.14] transition-opacity duration-700">
                    <img src={image} alt="" className="w-full h-full object-cover" />
                </div>
            )}
            <div className={cn(
                "absolute -top-24 -right-24 w-64 h-64 rounded-full blur-3xl transition-opacity duration-700",
                accent ? "bg-accent-primary/30 opacity-60 group-hover:opacity-90" : "bg-accent-secondary/15 opacity-0 group-hover:opacity-100"
            )} />

            <div className="relative z-10 flex items-center justify-between">
                <div className={cn(
                    "w-11 h-11 rounded-xl flex items-center justify-center border",
                    accent ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-200 text-slate-900"
                )}>
                    <Icon className="w-5 h-5" />
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent-success animate-pulse" />
                    <span className="text-[7px] font-black uppercase tracking-[0.4em] text-slate-400">LIVE</span>
                </div>
            </div>

            <div className="relative z-10 mt-auto">
                <h3 className="text-xl md:text-2xl font-black uppercase font-display tracking-tight text-slate-900 leading-tight mb-2">
                    {title}
                </h3>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 leading-relaxed max-w-xs">
                    {desc}
                </p>
            </div>

            <div className="relative z-10 flex items-center gap-2 text-[8px] font-black uppercase tracking-[0.4em] text-slate-400 group-hover:text-accent-primary transition-colors">
                Explore
                <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
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
            if (!initRef.current) {
                y.set(direction === 'down' ? -half : 0);
                initRef.current = true;
            }
        };
        measure();
        const ro = new ResizeObserver(measure);
        if (trackRef.current) ro.observe(trackRef.current);
        const imgs = trackRef.current?.querySelectorAll('img') ?? [];
        imgs.forEach((img) => img.addEventListener('load', measure));
        return () => {
            ro.disconnect();
            imgs.forEach((img) => img.removeEventListener('load', measure));
        };
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

    const doubled = [...images, ...images];
    return (
        <div className={cn("relative h-[640px] overflow-hidden", className)}>
            <motion.div
                ref={trackRef}
                className="flex flex-col gap-4 will-change-transform"
                style={{ y }}
            >
                {doubled.map((src, i) => (
                    <div key={i} className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl group/img">
                        <img
                            src={src}
                            loading="lazy"
                            draggable={false}
                            className="w-full h-auto object-cover transition-transform duration-700 group-hover/img:scale-105"
                            alt=""
                        />
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
        <div className={cn("relative overflow-hidden", size === 'sm' ? "h-5" : "h-7")}>
            <AnimatePresence mode="wait">
                <motion.span
                    key={idx}
                    initial={{ y: 24, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -24, opacity: 0 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className={cn(
                        "absolute inset-0 flex items-center justify-center text-accent-primary font-mono tracking-tight whitespace-nowrap",
                        size === 'sm' ? "text-xs" : "text-sm md:text-base"
                    )}
                >
                    "{PROMPT_ROTATOR[idx]}"
                </motion.span>
            </AnimatePresence>
        </div>
    );
}

// =============================================================================
// SCROLL WORKFLOW SECTION (sticky scroll-driven progressive build)
// =============================================================================

function PhaseCaption({
    idx,
    tag,
    title,
    desc,
    scrollYProgress,
    isLast
}: {
    idx: number;
    tag: string;
    title: string;
    desc: string;
    scrollYProgress: MotionValue<number>;
    isLast: boolean;
}) {
    const start = idx * 0.2;
    const end = start + 0.2;
    const op = useTransform(
        scrollYProgress,
        // Keep every breakpoint within [0,1]: framer-motion accelerates scroll-linked
        // opacity onto the WAAPI ScrollTimeline and feeds this input range in as keyframe
        // offsets, which throw if any value exceeds 1 (the last phase's end is 1.0).
        [Math.max(0, start - 0.05), start + 0.02, end - 0.04, Math.min(1, end + 0.05)],
        isLast ? [0.25, 1, 1, 1] : [0.25, 1, 1, 0.35]
    );
    const x = useTransform(
        scrollYProgress,
        [Math.max(0, start - 0.05), start + 0.02],
        [-12, 0]
    );

    return (
        <motion.div style={{ opacity: op, x }} className="flex gap-5 items-start">
            <span className="text-[7px] font-black uppercase tracking-[0.4em] text-accent-primary mt-1 shrink-0 w-8">{tag}</span>
            <div className="min-w-0">
                <h3 className="text-base md:text-lg font-black uppercase font-display tracking-tight text-white mb-1 leading-tight">{title}</h3>
                <p className="text-xs text-white/60 leading-relaxed">{desc}</p>
            </div>
        </motion.div>
    );
}

function MobileActivePhase({ phases, scrollYProgress }: { phases: { tag: string; t: string; d: string }[]; scrollYProgress: MotionValue<number> }) {
    const [idx, setIdx] = useState(0);
    useEffect(() => {
        return scrollYProgress.on('change', (v) => {
            setIdx(Math.max(0, Math.min(phases.length - 1, Math.floor(v * phases.length))));
        });
    }, [scrollYProgress, phases.length]);

    const phase = phases[idx];
    return (
        <div className="min-h-[72px] text-center">
            <AnimatePresence mode="wait">
                <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.3 }}
                >
                    <h3 className="text-base font-black uppercase font-display tracking-tight text-white leading-tight">
                        {phase.t}
                    </h3>
                    <p className="mt-1.5 text-[11px] text-white/60 leading-snug max-w-xs mx-auto">
                        {phase.d}
                    </p>
                </motion.div>
            </AnimatePresence>
        </div>
    );
}

function StepDots({ count, scrollYProgress }: { count: number; scrollYProgress: MotionValue<number> }) {
    const [active, setActive] = useState(0);
    useEffect(() => {
        return scrollYProgress.on('change', (v) => {
            setActive(Math.max(0, Math.min(count - 1, Math.floor(v * count))));
        });
    }, [scrollYProgress, count]);

    return (
        <div className="flex items-center justify-center">
            {Array.from({ length: count }).map((_, i) => {
                const isActive = i === active;
                const isCompleted = i < active;
                const reached = isActive || isCompleted;
                return (
                    <React.Fragment key={i}>
                        <motion.div
                            initial={false}
                            animate={{
                                width: isActive ? 26 : 8,
                                height: isActive ? 26 : 8,
                            }}
                            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                            className={cn(
                                "relative rounded-full flex items-center justify-center shrink-0 transition-colors duration-300",
                                reached ? "bg-accent-primary" : "bg-white/15"
                            )}
                        >
                            {isActive && (
                                <motion.span
                                    initial={{ opacity: 0, scale: 0.5 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ duration: 0.2, delay: 0.1 }}
                                    className="text-[10px] font-black text-slate-900 leading-none"
                                >
                                    {i + 1}
                                </motion.span>
                            )}
                        </motion.div>
                        {i < count - 1 && (
                            <div className={cn(
                                "h-px w-4 transition-colors duration-300",
                                isCompleted ? "bg-accent-primary" : "bg-white/15"
                            )} />
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
}

function ScrollWorkflowSection() {
    const ref = useRef<HTMLDivElement>(null);
    const { scrollYProgress } = useScroll({
        target: ref,
        offset: ['start start', 'end end']
    });

    const node1Op = useTransform(scrollYProgress, [0.0, 0.06], [0, 1]);
    const node1Sc = useTransform(scrollYProgress, [0.0, 0.06], [0.85, 1]);
    const node2Op = useTransform(scrollYProgress, [0.20, 0.26], [0, 1]);
    const node2Sc = useTransform(scrollYProgress, [0.20, 0.26], [0.85, 1]);
    const node3Op = useTransform(scrollYProgress, [0.40, 0.46], [0, 1]);
    const node3Sc = useTransform(scrollYProgress, [0.40, 0.46], [0.85, 1]);
    const node4Op = useTransform(scrollYProgress, [0.60, 0.66], [0, 1]);
    const node4Sc = useTransform(scrollYProgress, [0.60, 0.66], [0.85, 1]);
    const node5Op = useTransform(scrollYProgress, [0.80, 0.86], [0, 1]);
    const node5Sc = useTransform(scrollYProgress, [0.80, 0.86], [0.85, 1]);

    const edge13 = useTransform(scrollYProgress, [0.44, 0.52], [1, 0]);
    const edge23 = useTransform(scrollYProgress, [0.46, 0.54], [1, 0]);
    const edge34 = useTransform(scrollYProgress, [0.64, 0.72], [1, 0]);
    const edge45 = useTransform(scrollYProgress, [0.84, 0.92], [1, 0]);

    const outputOp = useTransform(scrollYProgress, [0.86, 0.96], [0, 1]);
    const progressW = useTransform(scrollYProgress, [0, 1], ['0%', '100%']);

    const phases = [
        { tag: '01', t: 'Stack the source', d: 'Drop any image onto the canvas. Hero shot, sketch, screen grab — Prisfol reads it natively.' },
        { tag: '02', t: 'Add a reference', d: 'Pile on style, color, mood. Multi-input is where the interesting work happens.' },
        { tag: '03', t: 'Write the intent', d: 'Plain language. The neural prompt translates instructions into precision controls.' },
        { tag: '04', t: 'Wire the model', d: 'Pick from 32 frontier models. Each one is a node. Hot-swap any time.' },
        { tag: '05', t: 'Render the graph', d: 'Hit run. Prisfol parallelizes the DAG, caches what it can, streams results back live.' },
    ];

    return (
        <section ref={ref} className="relative w-full h-[250vh] md:h-[300vh]" id="process">
            <div className="sticky top-0 h-screen w-full flex items-center overflow-hidden">
                <div className="w-full max-w-7xl mx-auto px-5 md:px-8 grid grid-cols-1 md:grid-cols-[1fr_1.2fr] md:grid-rows-[auto_1fr_auto] gap-4 md:gap-x-14 md:gap-y-6 md:items-center">
                    {/* Heading — col 1 row 1 on desktop, top on mobile */}
                    <div className="md:col-start-1 md:row-start-1">
                        <span className="text-[7px] font-black uppercase tracking-[0.5em] text-accent-primary opacity-60">Anatomy</span>
                        <h2 className="mt-3 md:mt-5 text-2xl md:text-5xl font-black leading-[0.95] uppercase font-display text-white">
                            Anatomy of a render.
                        </h2>
                        <p className="hidden md:block mt-4 text-xs font-bold uppercase tracking-wider text-slate-400 max-w-md">
                            Five nodes. One canvas. Scroll to assemble.
                        </p>
                    </div>

                    {/* Step dots — mobile only, between heading and canvas */}
                    <div className="md:hidden h-12 content-center">
                        <StepDots count={phases.length} scrollYProgress={scrollYProgress} />
                    </div>

                    {/* Canvas — col 2 spanning all rows on desktop, between dots and active text on mobile */}
                    <div className="relative w-full aspect-[5/4] md:aspect-[6/4] md:col-start-2 md:row-start-1 md:row-span-3 rounded-2xl md:rounded-3xl border border-white/10 bg-slate-950/60 backdrop-blur overflow-hidden shadow-[0_30px_80px_-20px_rgba(56,189,248,0.25)]">
                        {/* Window chrome */}
                        <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-2 px-4 py-2.5 border-b border-white/5 bg-white/[0.02] backdrop-blur">
                            <div className="flex gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-red-400/50" />
                                <span className="w-2 h-2 rounded-full bg-amber-400/50" />
                                <span className="w-2 h-2 rounded-full bg-emerald-400/50" />
                            </div>
                            <div className="ml-3 text-[7px] font-black uppercase tracking-[0.4em] text-white/30">prisfol.com / canvas</div>
                            <div className="ml-auto flex items-center gap-1.5 text-[7px] font-black uppercase tracking-[0.3em] text-emerald-400/80">
                                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                                Live
                            </div>
                        </div>

                        {/* Canvas grid */}
                        <div
                            className="absolute inset-0 opacity-30"
                            style={{
                                backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(56,189,248,0.18) 1px, transparent 0)',
                                backgroundSize: '20px 20px'
                            }}
                        />

                        {/* SVG Edges */}
                        <svg
                            className="absolute inset-0 w-full h-full pointer-events-none"
                            viewBox="0 0 100 100"
                            preserveAspectRatio="none"
                        >
                            <motion.path d="M 26 25.5 C 32 25.5 32 50 38 50" stroke="rgb(56,189,248)" strokeWidth="0.4" fill="none" pathLength="1" strokeDasharray="1" style={{ strokeDashoffset: edge13 }} />
                            <motion.path d="M 26 74.5 C 32 74.5 32 50 38 50" stroke="rgb(56,189,248)" strokeWidth="0.4" fill="none" pathLength="1" strokeDasharray="1" style={{ strokeDashoffset: edge23 }} />
                            <motion.path d="M 60 50 L 64 50" stroke="rgb(56,189,248)" strokeWidth="0.4" fill="none" pathLength="1" strokeDasharray="1" style={{ strokeDashoffset: edge34 }} />
                            <motion.path d="M 76 50 L 82 50" stroke="rgb(56,189,248)" strokeWidth="0.4" fill="none" pathLength="1" strokeDasharray="1" style={{ strokeDashoffset: edge45 }} />
                        </svg>

                        {/* Node 1: source */}
                        <motion.div
                            style={{ opacity: node1Op, scale: node1Sc, left: '4%', top: '12%', width: '22%', height: '32%' }}
                            className="absolute origin-center"
                        >
                            <div className="w-full h-full rounded-lg overflow-hidden border border-white/15 bg-slate-800 shadow-2xl flex flex-col">
                                <div className="px-2 py-1 bg-slate-900/90 border-b border-white/5 flex items-center gap-1">
                                    <ImageIcon className="w-2 h-2 text-accent-primary" />
                                    <span className="text-[6px] font-black uppercase tracking-[0.3em] text-white/60">SOURCE_A</span>
                                </div>
                                <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400" className="flex-1 w-full object-cover" alt="" />
                            </div>
                        </motion.div>

                        {/* Node 2: reference */}
                        <motion.div
                            style={{ opacity: node2Op, scale: node2Sc, left: '4%', top: '60%', width: '22%', height: '32%' }}
                            className="absolute origin-center"
                        >
                            <div className="w-full h-full rounded-lg overflow-hidden border border-white/15 bg-slate-800 shadow-2xl flex flex-col">
                                <div className="px-2 py-1 bg-slate-900/90 border-b border-white/5 flex items-center gap-1">
                                    <Target className="w-2 h-2 text-accent-primary" />
                                    <span className="text-[6px] font-black uppercase tracking-[0.3em] text-white/60">REFERENCE</span>
                                </div>
                                <img src="https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&q=80&w=400" className="flex-1 w-full object-cover" alt="" />
                            </div>
                        </motion.div>

                        {/* Node 3: prompt */}
                        <motion.div
                            style={{ opacity: node3Op, scale: node3Sc, left: '38%', top: '36%', width: '22%', height: '28%' }}
                            className="absolute origin-center"
                        >
                            <div className="w-full h-full rounded-lg border border-accent-primary/30 bg-slate-800 shadow-2xl flex flex-col">
                                <div className="px-2 py-1 bg-accent-primary/10 border-b border-accent-primary/20 flex items-center gap-1">
                                    <MessageSquare className="w-2 h-2 text-accent-primary" />
                                    <span className="text-[6px] font-black uppercase tracking-[0.3em] text-accent-primary">PROMPT</span>
                                </div>
                                <div className="flex-1 p-2 overflow-hidden">
                                    <p className="text-[6px] font-bold leading-snug text-white/70 uppercase tracking-wide">
                                        CINEMATIC PORTRAIT · 35MM · GOLDEN HOUR · EDITORIAL FASHION
                                    </p>
                                </div>
                            </div>
                        </motion.div>

                        {/* Node 4: model */}
                        <motion.div
                            style={{ opacity: node4Op, scale: node4Sc, left: '64%', top: '38%', width: '12%', height: '24%' }}
                            className="absolute origin-center"
                        >
                            <div className="w-full h-full rounded-lg border border-accent-secondary/30 bg-slate-800 shadow-2xl flex flex-col items-center justify-center gap-1 px-1">
                                <Cpu className="w-3.5 h-3.5 text-accent-secondary" />
                                <span className="text-[6px] font-black uppercase tracking-[0.3em] text-white">FLUX</span>
                                <span className="text-[5px] font-bold uppercase tracking-wider text-white/40">v1.1 PRO</span>
                            </div>
                        </motion.div>

                        {/* Node 5: output */}
                        <motion.div
                            style={{ opacity: node5Op, scale: node5Sc, left: '80%', top: '20%', width: '16%', height: '60%' }}
                            className="absolute origin-center"
                        >
                            <div className="w-full h-full rounded-lg overflow-hidden border border-emerald-400/30 bg-slate-800 shadow-2xl flex flex-col">
                                <div className="px-2 py-1 bg-slate-900/90 border-b border-white/5 flex items-center gap-1">
                                    <Play className="w-2 h-2 text-emerald-400" />
                                    <span className="text-[6px] font-black uppercase tracking-[0.3em] text-white/70">OUTPUT</span>
                                    <span className="ml-auto w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                                </div>
                                <motion.img
                                    src="https://images.unsplash.com/photo-1492707892479-7bc8d5a4ee93?auto=format&fit=crop&q=80&w=400"
                                    style={{ opacity: outputOp }}
                                    className="flex-1 w-full object-cover"
                                    alt=""
                                />
                            </div>
                        </motion.div>
                    </div>

                    {/* Desktop phase list — col 1 row 2 */}
                    <div className="hidden md:block md:col-start-1 md:row-start-2 space-y-5 pt-2">
                        {phases.map((p, i) => (
                            <PhaseCaption
                                key={i}
                                idx={i}
                                tag={p.tag}
                                title={p.t}
                                desc={p.d}
                                scrollYProgress={scrollYProgress}
                                isLast={i === phases.length - 1}
                            />
                        ))}
                    </div>

                    {/* Mobile active phase text — below canvas */}
                    <div className="md:hidden">
                        <MobileActivePhase phases={phases} scrollYProgress={scrollYProgress} />
                    </div>

                    {/* Desktop progress bar — col 1 row 3 */}
                    <div className="hidden md:block md:col-start-1 md:row-start-3 relative h-0.5 bg-white/10 rounded-full overflow-hidden mt-2 max-w-sm">
                        <motion.div style={{ width: progressW }} className="absolute inset-y-0 left-0 bg-accent-primary" />
                    </div>
                </div>
            </div>
        </section>
    );
}

// =============================================================================
// TEMPLATE CAROUSEL (infinite auto-marquee)
// =============================================================================

const TEMPLATES = [
    {
        idx: '01',
        name: 'Product Photoshoot',
        category: 'E-commerce',
        tag: '4 backdrops',
        desc: 'Studio backdrops × 4. Drop in your product, render the lookbook.',
        img: 'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&q=80&w=1400',
    },
    {
        idx: '02',
        name: 'Hero Banner',
        category: 'Marketing',
        tag: '16:9',
        desc: 'High-impact landing visuals. Headline-ready, brand-aligned.',
        img: 'https://images.unsplash.com/photo-1547891654-e66ed7ebb968?auto=format&fit=crop&q=80&w=1400',
    },
    {
        idx: '03',
        name: 'Editorial Portrait',
        category: 'Photography',
        tag: '35mm · film',
        desc: 'Cinematic portraits with film-grade light and texture.',
        img: 'https://images.unsplash.com/photo-1492707892479-7bc8d5a4ee93?auto=format&fit=crop&q=80&w=1400',
    },
    {
        idx: '04',
        name: 'Social Carousel',
        category: 'Social',
        tag: '6 frames',
        desc: 'Auto-formatted Instagram and LinkedIn carousels.',
        img: 'https://images.unsplash.com/photo-1635776062127-d379bfcba9f8?auto=format&fit=crop&q=80&w=1400',
    },
    {
        idx: '05',
        name: 'Brand Video',
        category: 'Motion',
        tag: '15s · loop',
        desc: 'Image-to-video with branded motion and ambient sound.',
        img: 'https://images.unsplash.com/photo-1633957897986-70e83293f3ff?auto=format&fit=crop&q=80&w=1400',
    },
    {
        idx: '06',
        name: 'Logo Variations',
        category: 'Branding',
        tag: 'Vector · SVG',
        desc: 'Brand-perfect SVG logos. Export-ready for print and web.',
        img: 'https://images.unsplash.com/photo-1614624532983-4ce03382d63d?auto=format&fit=crop&q=80&w=1400',
    },
    {
        idx: '07',
        name: '3D Mockup',
        category: 'Product',
        tag: 'Multi-angle',
        desc: 'Spin a flat asset into a coherent 3D scene. Print-ready.',
        img: 'https://images.unsplash.com/photo-1620421680010-0766ff230392?auto=format&fit=crop&q=80&w=1400',
    },
    {
        idx: '08',
        name: 'Background Swap',
        category: 'Editing',
        tag: 'One-click',
        desc: 'Cut your subject. Recompose anywhere. Studio-clean edges.',
        img: 'https://images.unsplash.com/photo-1626544827763-d516dce335e2?auto=format&fit=crop&q=80&w=1400',
    },
];

function TemplateCarousel() {
    const trackRef = useRef<HTMLDivElement>(null);
    const x = useMotionValue(0);
    const halfWidthRef = useRef(0);
    const isDraggingRef = useRef(false);

    useEffect(() => {
        const measure = () => {
            if (trackRef.current) {
                halfWidthRef.current = trackRef.current.scrollWidth / 2;
            }
        };
        measure();
        const ro = new ResizeObserver(measure);
        if (trackRef.current) ro.observe(trackRef.current);
        window.addEventListener('resize', measure);
        return () => {
            window.removeEventListener('resize', measure);
            ro.disconnect();
        };
    }, []);

    useAnimationFrame((_, delta) => {
        if (isDraggingRef.current) return;
        const half = halfWidthRef.current;
        if (half === 0) return;
        const SPEED = half / 80000; // ~80s for one full cycle
        let next = x.get() - delta * SPEED;
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

    return (
        <section className="relative w-full py-24" id="templates">
            {/* Heading */}
            <div className="max-w-7xl mx-auto px-8 mb-14 text-center flex flex-col items-center gap-5">
                <span className="text-[7px] font-black uppercase tracking-[0.5em] text-accent-primary opacity-60">Templates</span>
                <h2 className="text-3xl md:text-5xl font-black leading-[0.95] uppercase font-display text-white">
                    Hundreds of templates. <span className="text-accent-primary italic">One click.</span>
                </h2>
                <p className="max-w-md text-xs font-bold uppercase tracking-wider text-slate-400">
                    Pre-wired workflows. Drop one on the canvas, swap your assets, render.
                </p>
            </div>

            {/* Infinite marquee + drag overlay */}
            <div className="relative overflow-hidden">
                {/* Edge fades */}
                <div className="absolute left-0 top-0 bottom-0 w-24 md:w-40 z-10 bg-gradient-to-r from-slate-900 to-transparent pointer-events-none" />
                <div className="absolute right-0 top-0 bottom-0 w-24 md:w-40 z-10 bg-gradient-to-l from-slate-900 to-transparent pointer-events-none" />

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
                    {[...TEMPLATES, ...TEMPLATES].map((t, i) => (
                        <div
                            key={i}
                            className="relative shrink-0 w-[78vw] md:w-[40vw] lg:w-[32vw] aspect-[5/3] rounded-3xl overflow-hidden border border-white/10 group"
                        >
                            <img
                                src={t.img}
                                draggable={false}
                                className="absolute inset-0 w-full h-full object-cover pointer-events-none transition-transform duration-1000 group-hover:scale-[1.04]"
                                alt={t.name}
                                loading="lazy"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/50 to-transparent pointer-events-none" />

                            <div className="absolute top-5 left-5 right-5 flex items-start justify-between pointer-events-none">
                                <div className="px-2.5 py-1 rounded-full bg-white/10 backdrop-blur border border-white/15">
                                    <span className="text-[7px] font-black uppercase tracking-[0.4em] text-white">{t.tag}</span>
                                </div>
                                <div className="text-[10px] font-black uppercase tracking-[0.4em] text-white/60 font-mono">{t.idx}</div>
                            </div>

                            <div className="absolute bottom-5 left-5 right-5 pointer-events-none">
                                <div className="text-[7px] font-black uppercase tracking-[0.4em] text-accent-primary mb-2">{t.category}</div>
                                <h3 className="text-2xl md:text-3xl font-black uppercase font-display tracking-tighter text-white leading-[0.9]">{t.name}</h3>
                                <p className="mt-2 text-[11px] text-white/70 max-w-sm leading-relaxed font-medium">{t.desc}</p>
                            </div>
                        </div>
                    ))}
                </motion.div>
            </div>

            {/* CTA */}
            <div className="flex justify-center mt-12">
                <Link
                    href="/templates"
                    className="group flex items-center gap-3 px-7 py-3 rounded-xl border border-white/15 text-[8px] font-black uppercase tracking-[0.4em] text-white hover:bg-white hover:text-slate-900 transition-all"
                >
                    Browse all templates
                    <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                </Link>
            </div>
        </section>
    );
}

// =============================================================================
// CHAT-FIRST SHOWCASE (chat with inline results + a related mini-workflow)
// =============================================================================

// One coherent story shared by the chat, its inline results, and the workflow
// graph — so the conversation, the rendered frames, and the nodes all match.
const SHOWCASE_RESULTS = [
    { src: 'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&q=80&w=600', tag: 'minimal' },
    { src: 'https://images.unsplash.com/photo-1635776062127-d379bfcba9f8?auto=format&fit=crop&q=80&w=600', tag: 'dramatic' },
    { src: 'https://images.unsplash.com/photo-1547891654-e66ed7ebb968?auto=format&fit=crop&q=80&w=600', tag: 'neon' },
    { src: 'https://images.unsplash.com/photo-1614624532983-4ce03382d63d?auto=format&fit=crop&q=80&w=600', tag: 'editorial' },
];

const SHOWCASE_SOURCE = 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&q=80&w=400';

// Chat panel — the conversation plus the generated frames shown INLINE in one
// row, exactly like a result lands in a real session.
function ShowcaseChatPanel() {
    return (
        <div className="h-full w-full rounded-3xl border border-slate-200 bg-white overflow-hidden shadow-xl flex flex-col">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/60 shrink-0">
                <div className="flex gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-400/50" />
                    <span className="w-2 h-2 rounded-full bg-amber-400/50" />
                    <span className="w-2 h-2 rounded-full bg-emerald-400/50" />
                </div>
                <div className="ml-2 flex items-center gap-1.5">
                    <MessageSquare className="w-3 h-3 text-accent-primary" />
                    <span className="text-[7px] font-black uppercase tracking-[0.4em] text-slate-500">Prisfol Chat</span>
                </div>
                <div className="ml-auto flex items-center gap-1.5 text-[7px] font-black uppercase tracking-[0.3em] text-emerald-500">
                    <span className="relative flex w-1.5 h-1.5">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-70 animate-ping" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                    </span>
                    Live
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
                <motion.div initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }} className="flex justify-end">
                    <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-tr-sm bg-slate-900 text-white text-sm leading-relaxed">
                        Make 4 hero shots of my watch on different studio backdrops — minimal, dramatic, neon, editorial.
                    </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.35 }} className="flex justify-start">
                    <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-tl-sm bg-slate-100 text-slate-700 text-sm leading-relaxed">
                        On it — taking your watch and generating it across 4 studio backdrops: minimal, dramatic, neon, editorial.
                    </div>
                </motion.div>

                {/* Inline results — one row, right inside the conversation */}
                <motion.div initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.7 }} className="flex justify-start">
                    <div className="w-full max-w-[94%] space-y-2">
                        <div className="flex items-center gap-1.5 text-[7px] font-black uppercase tracking-[0.4em] text-accent-primary">
                            <span className="w-1.5 h-1.5 rounded-full bg-accent-primary" /> 4 frames ready
                        </div>
                        <div className="flex gap-2">
                            {SHOWCASE_RESULTS.map((o, i) => (
                                <motion.div
                                    key={o.tag}
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    whileInView={{ opacity: 1, scale: 1 }}
                                    viewport={{ once: true }}
                                    transition={{ duration: 0.5, delay: 0.9 + i * 0.12 }}
                                    className="relative flex-1 min-w-0 aspect-square rounded-xl overflow-hidden border border-slate-200 group"
                                >
                                    <img src={o.src} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" alt={o.tag} />
                                    <div className="absolute bottom-1 inset-x-1 px-1 py-0.5 rounded-md bg-white/85 backdrop-blur text-[6px] font-black uppercase tracking-[0.15em] text-slate-700 text-center truncate">
                                        {o.tag}
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                </motion.div>
            </div>

            <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/30 flex items-center gap-3 shrink-0">
                <div className="flex-1 min-w-0">
                    <PromptRotator size="sm" />
                </div>
                <button className="shrink-0 w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center hover:bg-accent-primary hover:text-slate-900 transition-colors">
                    <Send className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
}

// A minimal node graph that mirrors the chat: source + 4 backdrops → composite
// → upscale → the 4 output frames. Looks like a workflow; not interactive.
function ShowcaseWorkflowNode({ style, label, icon: Icon, accent, children }: { style: React.CSSProperties; label: string; icon: any; accent?: boolean; children: React.ReactNode }) {
    return (
        <div className="absolute" style={style}>
            <div className={cn("w-full h-full rounded-xl border bg-white shadow-lg flex flex-col overflow-hidden", accent ? "border-accent-primary/40" : "border-slate-200")}>
                <div className={cn("flex items-center gap-1 px-1.5 py-1 border-b shrink-0", accent ? "bg-accent-primary/10 border-accent-primary/20" : "bg-slate-50 border-slate-100")}>
                    <Icon className={cn("w-2.5 h-2.5", accent ? "text-accent-primary" : "text-slate-400")} />
                    <span className="text-[6px] font-black uppercase tracking-[0.18em] text-slate-500 truncate">{label}</span>
                </div>
                <div className="flex-1 min-h-0">{children}</div>
            </div>
        </div>
    );
}

function ShowcaseWorkflow() {
    const wires = [
        'M31 28 C 36 28, 35 50, 40 50',
        'M31 72 C 36 72, 35 50, 40 50',
        'M66 50 L 74 50',
    ];
    return (
        <div className="relative h-full w-full rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white overflow-hidden shadow-xl">
            <div className="absolute top-0 inset-x-0 z-20 flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-white/70 backdrop-blur">
                <Network className="w-3 h-3 text-accent-primary" />
                <span className="text-[7px] font-black uppercase tracking-[0.4em] text-slate-500">Workflow · 4 nodes</span>
                <span className="ml-auto flex items-center gap-1.5 text-[7px] font-black uppercase tracking-[0.3em] text-emerald-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Ready
                </span>
            </div>

            <div className="absolute inset-0 opacity-100" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(15,23,42,0.06) 1px, transparent 0)', backgroundSize: '18px 18px' }} />

            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                {wires.map((d, i) => (
                    <g key={i}>
                        <path d={d} stroke="rgba(56,189,248,0.25)" strokeWidth="0.5" fill="none" />
                        <motion.path
                            d={d}
                            stroke="rgb(56,189,248)"
                            strokeWidth="0.5"
                            fill="none"
                            strokeDasharray="2 4"
                            animate={{ strokeDashoffset: [0, -6] }}
                            transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
                        />
                    </g>
                ))}
            </svg>

            {/* Source */}
            <ShowcaseWorkflowNode style={{ left: '4%', top: '14%', width: '27%', height: '28%' }} label="Source · watch" icon={ImageIcon}>
                <img src={SHOWCASE_SOURCE} className="w-full h-full object-cover" alt="watch source" />
            </ShowcaseWorkflowNode>

            {/* Backdrops ×4 (style references) */}
            <ShowcaseWorkflowNode style={{ left: '4%', top: '58%', width: '27%', height: '28%' }} label="Backdrops ×4" icon={Layers3}>
                <div className="grid grid-cols-2 grid-rows-2 gap-0.5 w-full h-full p-0.5">
                    <div className="rounded-sm bg-gradient-to-br from-slate-200 to-slate-100" />
                    <div className="rounded-sm bg-gradient-to-br from-slate-900 to-slate-600" />
                    <div className="rounded-sm bg-gradient-to-br from-fuchsia-400 to-cyan-400" />
                    <div className="rounded-sm bg-gradient-to-br from-amber-200 to-rose-300" />
                </div>
            </ShowcaseWorkflowNode>

            {/* Image generation */}
            <ShowcaseWorkflowNode style={{ left: '40%', top: '33%', width: '26%', height: '34%' }} label="Image generation" icon={Wand2} accent>
                <div className="w-full h-full flex flex-col items-center justify-center gap-1.5">
                    <Wand2 className="w-6 h-6 text-accent-primary/70" />
                    <span className="text-[6px] font-black uppercase tracking-[0.25em] text-slate-400">diffusion</span>
                </div>
            </ShowcaseWorkflowNode>

            {/* Output ×4 */}
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

// Marketing showcase. Desktop: chat + workflow side-by-side. Mobile: the canvas
// is always the base layer with the chat docked over it as a minimized bottom
// sheet (open by default — so the canvas reads behind it on load, like a real
// workflow session). Closing the sheet reveals the full canvas; a chat FAB
// re-opens it.
function ChatFirstShowcase() {
    const [chatOpen, setChatOpen] = useState(true);

    return (
        <>
            {/* Desktop: side-by-side */}
            <div className="hidden md:grid md:grid-cols-[1.1fr_1fr] gap-6 md:h-[560px]">
                <ShowcaseChatPanel />
                <ShowcaseWorkflow />
            </div>

            {/* Mobile: canvas base + chat as a minimized sheet on top */}
            <div className="md:hidden relative w-full h-[560px] overflow-hidden rounded-3xl">
                {/* Canvas — always behind */}
                <div className="absolute inset-0">
                    <ShowcaseWorkflow />
                </div>

                {/* Chat FAB — shown when the sheet is closed */}
                <AnimatePresence>
                    {!chatOpen && (
                        <motion.button
                            type="button"
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0, opacity: 0 }}
                            transition={{ type: 'spring', damping: 18, stiffness: 320 }}
                            onClick={() => setChatOpen(true)}
                            aria-label="Open chat"
                            className="absolute bottom-4 right-4 z-40 w-12 h-12 rounded-2xl bg-slate-900 text-white shadow-2xl flex items-center justify-center active:scale-95 transition-transform"
                        >
                            <MessageSquare className="w-5 h-5 text-accent-primary" />
                        </motion.button>
                    )}
                </AnimatePresence>

                {/* Chat — minimized bottom sheet docked over the canvas */}
                <AnimatePresence>
                    {chatOpen && (
                        <>
                            {/* Light tap-to-close catcher; keeps the canvas clearly visible */}
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.25 }}
                                onClick={() => setChatOpen(false)}
                                className="absolute inset-0 z-30 bg-slate-900/5"
                            />
                            <motion.div
                                initial={{ y: '100%' }}
                                animate={{ y: 0 }}
                                exit={{ y: '100%' }}
                                transition={{ type: 'spring', damping: 30, stiffness: 320 }}
                                className="absolute inset-x-2 bottom-2 top-[42%] z-40"
                            >
                                <ShowcaseChatPanel />
                                <button
                                    type="button"
                                    onClick={() => setChatOpen(false)}
                                    aria-label="Close chat"
                                    className="absolute -top-9 right-0 z-50 w-8 h-8 rounded-xl bg-slate-900 text-white shadow-lg flex items-center justify-center active:scale-95 transition-transform"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </motion.div>
                        </>
                    )}
                </AnimatePresence>
            </div>
        </>
    );
}

// =============================================================================
// MAIN HOME PAGE
// =============================================================================

export default function Home() {
    const { createNewSession, isLoading } = useSession();
    const { scrollYProgress } = useScroll();
    const [mounted, setMounted] = React.useState(false);
    const [zoomCompensation, setZoomCompensation] = React.useState(1);
    const initialDevicePixelRatioRef = React.useRef<number | null>(null);
    const [navScrolled, setNavScrolled] = React.useState(false);

    useEffect(() => {
        setMounted(true);

        const updateZoom = () => {
            const currentDPR = window.devicePixelRatio || 1;
            if (initialDevicePixelRatioRef.current === null) {
                initialDevicePixelRatioRef.current = currentDPR;
            }
            const baseDPR = initialDevicePixelRatioRef.current || 1;
            const factor = currentDPR / baseDPR;
            setZoomCompensation(factor > 0 ? 1 / factor : 1);
        };

        let mql: MediaQueryList | null = null;
        const handleMql = () => {
            updateZoom();
            if (mql) mql.removeEventListener('change', handleMql);
            mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
            mql.addEventListener('change', handleMql);
        };

        updateZoom();
        mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        mql.addEventListener('change', handleMql);
        window.addEventListener('resize', updateZoom);

        const onScroll = () => setNavScrolled(window.scrollY > 80);
        window.addEventListener('scroll', onScroll);

        return () => {
            mql?.removeEventListener('change', handleMql);
            window.removeEventListener('resize', updateZoom);
            window.removeEventListener('scroll', onScroll);
        };
    }, []);

    const backgroundY = useTransform(scrollYProgress, [0, 1], ['0%', '20%']);
    const gridOpacity = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0.07, 0.1, 0.1, 0.05]);
    const meshScale = useTransform(scrollYProgress, [0, 1], [1, 1.2]);
    const heroBgRight = useTransform(scrollYProgress, [0, 1], ['0%', '40%']);

    return (
        <div className="relative w-full flex flex-col items-center overflow-x-clip" suppressHydrationWarning>
            {/* Advanced Dynamic Background System */}
            <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
                <div className="absolute inset-0 bg-white" />

                <motion.div
                    style={{ y: backgroundY, scale: meshScale }}
                    className="absolute inset-0 bg-[radial-gradient(at_50%_0%,rgba(56,189,248,0.15)_0%,transparent_50%)]"
                />
                <motion.div
                    style={{ y: heroBgRight }}
                    className="absolute top-[20%] right-[-10%] w-[50vw] h-[50vw] bg-accent-secondary/5 blur-[120px] rounded-full"
                />

                <motion.div
                    style={{
                        opacity: gridOpacity,
                        backgroundImage: `linear-gradient(#000 ${0.5 * zoomCompensation}px, transparent ${0.5 * zoomCompensation}px), linear-gradient(90deg, #000 ${0.5 * zoomCompensation}px, transparent ${0.5 * zoomCompensation}px)`,
                        backgroundSize: `${24 * zoomCompensation}px ${24 * zoomCompensation}px`,
                        backgroundAttachment: 'local'
                    }}
                    className="absolute inset-0"
                />
                <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: `linear-gradient(#000 ${0.2 * zoomCompensation}px, transparent ${0.2 * zoomCompensation}px), linear-gradient(90deg, #000 ${0.2 * zoomCompensation}px, transparent ${0.2 * zoomCompensation}px)`, backgroundSize: `${8 * zoomCompensation}px ${8 * zoomCompensation}px` }} />
            </div>

            <div className="relative z-10 w-full flex flex-col items-center overflow-x-clip">
                {/* ─── Floating Glass Nav ─────────────────────────────────────── */}
                <motion.nav
                    initial={{ y: -20, x: '-50%', opacity: 0 }}
                    animate={{ y: 0, x: '-50%', opacity: 1 }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    className={cn(
                        "fixed top-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-5xl rounded-2xl transition-all duration-500",
                        navScrolled
                            ? "bg-white/80 backdrop-blur-xl border border-slate-200/80 shadow-lg shadow-slate-900/5"
                            : "bg-transparent border border-transparent"
                    )}
                >
                    <div className="px-6 py-3 flex items-center justify-between">
                        <Link href="/" aria-label="Prisfol home" className="shrink-0">
                            <PrisfolLogo />
                        </Link>
                        <div className="hidden md:flex items-center gap-8">
                            <Link href="#workflow" className="text-[7px] font-black uppercase tracking-[0.4em] text-slate-500 hover:text-slate-900 transition-colors">Canvas</Link>
                            <Link href="#capabilities" className="text-[7px] font-black uppercase tracking-[0.4em] text-slate-500 hover:text-slate-900 transition-colors">Capabilities</Link>
                            <Link href="#process" className="text-[7px] font-black uppercase tracking-[0.4em] text-slate-500 hover:text-slate-900 transition-colors">Process</Link>
                            <Link href="#templates" className="text-[7px] font-black uppercase tracking-[0.4em] text-slate-500 hover:text-slate-900 transition-colors">Templates</Link>
                            <Link href="/pricing" className="text-[7px] font-black uppercase tracking-[0.4em] text-slate-500 hover:text-slate-900 transition-colors">Pricing</Link>
                        </div>
                        <div className="flex items-center gap-3">
                            <Link href="/chat" className="hidden md:inline text-[7px] font-black uppercase tracking-[0.4em] text-slate-500 hover:text-slate-900 transition-colors">Sign In</Link>
                            <Link
                                href="/chat"
                                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-[7px] font-black uppercase tracking-[0.4em] hover:bg-accent-primary hover:text-slate-900 transition-all"
                            >
                                Get Started
                            </Link>
                        </div>
                    </div>
                </motion.nav>

                {/* ─── Hero & Chat Composer Section ───────────────────────────── */}
                <section className="relative w-full flex flex-col items-center pt-24 md:pt-28 pb-10 md:pb-14" id="workflow">
                    {/* Ambient concentric rings + glow behind the composer */}
                    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(95vw,900px)] aspect-square rounded-full bg-[radial-gradient(circle,rgba(56,189,248,0.14),transparent_62%)]" />
                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(90vw,860px)] aspect-square rounded-full border border-accent-primary/10" />
                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(62vw,580px)] aspect-square rounded-full border border-accent-primary/[0.07]" />
                    </div>

                    <motion.div
                        initial={{ opacity: 0, y: 30, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                        className="relative z-20 w-full max-w-3xl px-5 md:px-6 flex flex-col items-center text-center gap-6 md:gap-8"
                    >
                        <div className="space-y-4 md:space-y-5">
                            <h1 className="text-[clamp(2.25rem,8vw,4.75rem)] font-black tracking-tighter text-slate-900 leading-[0.88] font-display uppercase drop-shadow-sm">
                                The Visual Engine for Your <span className="text-accent-primary italic">Imagination</span>.
                            </h1>
                            <p className="mx-auto max-w-md text-xs md:text-sm font-bold uppercase tracking-[0.18em] text-slate-500 leading-relaxed">
                                Describe it. Prisfol builds the workflow, wires the models, and renders it.
                            </p>
                        </div>

                        {/* The composer — type here and you land mid-build inside /chat */}
                        <HeroChatInput />

                        {/* Secondary: skip straight to a blank canvas */}
                        <button
                            onClick={createNewSession}
                            disabled={isLoading}
                            className="group inline-flex items-center gap-2 text-[8px] md:text-[9px] font-black uppercase tracking-[0.4em] text-slate-400 hover:text-slate-900 transition-colors"
                        >
                            {isLoading
                                ? <div className="w-3 h-3 border-2 border-accent-secondary border-t-transparent animate-spin rounded-full" />
                                : <Workflow className="w-3 h-3 text-accent-secondary" />}
                            Or start from a blank canvas
                            <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                        </button>
                    </motion.div>
                </section>

                {/* ─── Capabilities Bento (Light) ─────────────────────────────── */}
                <section className="relative w-full max-w-7xl px-8 pt-12 pb-20 md:py-24" id="capabilities">
                    <SectionHeader
                        tag="Capabilities"
                        title="Everything you need to make. Nothing in the way."
                        description="Six core primitives. Mix them on the canvas to build any visual pipeline."
                        center
                    />

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5 auto-rows-[260px]">
                        <CapabilityCard
                            icon={Wand2}
                            title="Generate"
                            desc="Text-to-image, text-to-video. Every flagship model, ready to chain."
                            image="https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&q=80&w=900"
                            span="md:col-span-2"
                            accent
                        />
                        <CapabilityCard
                            icon={Layers3}
                            title="Compose"
                            desc="Stack, mask, blend. Multi-input pipelines without leaving the canvas."
                            image="https://images.unsplash.com/photo-1635776062127-d379bfcba9f8?auto=format&fit=crop&q=80&w=900"
                        />
                        <CapabilityCard
                            icon={Eraser}
                            title="Edit"
                            desc="Inpaint, extend, retouch. Surgical control on any source asset."
                            image="https://images.unsplash.com/photo-1547891654-e66ed7ebb968?auto=format&fit=crop&q=80&w=900"
                        />
                        <CapabilityCard
                            icon={Maximize2}
                            title="Upscale"
                            desc="Sub-pixel detail recovery. Print-ready output from any source."
                            image="https://images.unsplash.com/photo-1614624532983-4ce03382d63d?auto=format&fit=crop&q=80&w=900"
                        />
                        <CapabilityCard
                            icon={Scissors}
                            title="Remove Background"
                            desc="One click. Studio-clean cutouts. Subjects, products, people — preserved with sub-pixel edges."
                            image="https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&q=80&w=900"
                            span="md:col-start-3 md:row-start-2 md:row-span-2"
                        />
                        <CapabilityCard
                            icon={Film}
                            title="Animate"
                            desc="Bring stills to motion. Frame interpolation, looping, video extension."
                            image="https://images.unsplash.com/photo-1633957897986-70e83293f3ff?auto=format&fit=crop&q=80&w=900"
                            span="md:col-span-2"
                            accent
                        />
                    </div>
                </section>

                {/* ─── How it works (Light) ────────────────────────────────────── */}
                <section className="relative w-full max-w-7xl px-8 py-24" id="how">
                    <SectionHeader
                        tag="Workflow"
                        title="From idea to render in three nodes."
                        description="The same canvas pros use to ship campaigns. The fastest start a beginner has ever had."
                        center
                    />

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {[
                            {
                                n: '01',
                                t: 'Drop a model',
                                d: 'Pick from 32 frontier models. Imagen, Flux, Sora, Kling — they all live as drag-and-drop nodes.',
                                icon: Cpu
                            },
                            {
                                n: '02',
                                t: 'Wire the inputs',
                                d: 'Plug a reference image, a prompt, a style. Connect outputs of one node into the next.',
                                icon: Network
                            },
                            {
                                n: '03',
                                t: 'Run the graph',
                                d: 'Hit run. Prisfol dispatches the DAG, caches what it can, and streams results back live.',
                                icon: Zap
                            },
                        ].map((step, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 24 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ duration: 0.6, delay: i * 0.12 }}
                                className="relative p-8 rounded-3xl border border-slate-200 bg-white hover:border-accent-primary/40 transition-all duration-500 group"
                            >
                                <div className="absolute -top-3 left-8 px-3 py-1 rounded-full bg-slate-900 text-white text-[7px] font-black uppercase tracking-[0.4em]">
                                    Step {step.n}
                                </div>
                                <step.icon className="w-7 h-7 text-accent-primary mb-6 mt-2" />
                                <h3 className="text-2xl font-black uppercase font-display tracking-tight text-slate-900 leading-tight mb-2">
                                    {step.t}
                                </h3>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 leading-relaxed">
                                    {step.d}
                                </p>
                                {i < 2 && (
                                    <div className="hidden md:flex absolute top-1/2 -right-3 z-10 w-6 h-6 rounded-full bg-white border border-slate-200 items-center justify-center">
                                        <ArrowRight className="w-3 h-3 text-slate-400" />
                                    </div>
                                )}
                            </motion.div>
                        ))}
                    </div>
                </section>

                {/* ─── Chat-First Section (Light) ──────────────────────────────── */}
                <section className="relative w-full max-w-7xl px-8 py-24" id="chat-first">
                    <SectionHeader
                        tag="Chat-first"
                        title="Or just type. We'll build it."
                        description="Skip the canvas if you want. Tell Prisfol what you need in plain English — it lays out the nodes, picks the right models, and runs the graph."
                        center
                    />

                    <ChatFirstShowcase />
                </section>

                {/* ─── Dark Sections Wrapper ───────────────────────────────────── */}
                <div className="w-full bg-slate-900 flex flex-col items-center relative overflow-x-clip">
                    <div className="absolute top-0 inset-x-0 h-24 bg-gradient-to-b from-white to-transparent pointer-events-none z-10" />

                    {/* ─── Brand Carousel ───────────────────────────────────────── */}
                    {mounted && (
                        <motion.div
                            className="w-full pt-24 pb-4"
                            initial={{ opacity: 0 }}
                            whileInView={{ opacity: 1 }}
                            viewport={{ once: true }}
                        >
                            <BrandCarousel />
                        </motion.div>
                    )}

                    {/* ─── Demo Video (Dark) ────────────────────────────────────── */}
                    <section className="w-full max-w-6xl px-8 py-16">
                        <SectionHeader
                            tag="Demo"
                            title="See it move."
                            description="A 30-second look inside a real Prisfol session."
                            dark
                            center
                        />

                        <motion.div
                            initial={{ opacity: 0, y: 30 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.8 }}
                            className="relative"
                        >
                            {/* Ambient glow */}
                            <div className="absolute -inset-x-12 -bottom-8 h-32 bg-accent-primary/30 blur-[100px] pointer-events-none" />
                            <div className="absolute -inset-x-12 -top-8 h-32 bg-accent-secondary/20 blur-[100px] pointer-events-none" />

                            <div className="relative rounded-3xl overflow-hidden border border-white/10 bg-slate-950 shadow-[0_30px_80px_-20px_rgba(56,189,248,0.35)]">
                                {/* Window chrome */}
                                <div className="flex items-center gap-2 px-5 py-3 border-b border-white/5 bg-white/[0.02]">
                                    <div className="flex gap-1.5">
                                        <span className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
                                        <span className="w-2.5 h-2.5 rounded-full bg-amber-400/60" />
                                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/60" />
                                    </div>
                                    <div className="ml-3 text-[7px] font-black uppercase tracking-[0.4em] text-white/40">prisfol.com / canvas / live-session</div>
                                    <div className="ml-auto flex items-center gap-2 text-[7px] font-black uppercase tracking-[0.3em] text-emerald-400/80">
                                        <span className="relative flex w-1.5 h-1.5">
                                            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-70 animate-ping" />
                                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                                        </span>
                                        REC
                                    </div>
                                </div>

                                {/* Video */}
                                <video
                                    src="https://wyqkbwpybqokmtlghdsr.supabase.co/storage/v1/object/public/chat-assets/demo.mp4"
                                    className="block w-full h-auto"
                                    autoPlay
                                    loop
                                    muted
                                    playsInline
                                />
                            </div>
                        </motion.div>
                    </section>

                    {/* ─── Live Gallery (Dark) ──────────────────────────────────── */}
                    <section className="w-full max-w-7xl px-8 py-24 relative">
                        <SectionHeader
                            tag="Gallery"
                            title="Made by creators, on the canvas."
                            description="A live look at workflows shipping right now."
                            dark
                            center
                        />

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 [mask-image:linear-gradient(to_bottom,transparent,black_15%,black_85%,transparent)]">
                            <GalleryColumn images={GALLERY_IMAGES.slice(0, 6)} direction="up" duration={50} />
                            <GalleryColumn images={GALLERY_IMAGES.slice(3, 9)} direction="down" duration={70} />
                            <GalleryColumn images={GALLERY_IMAGES.slice(6, 12)} direction="up" duration={60} className="hidden md:block" />
                            <GalleryColumn images={GALLERY_IMAGES.slice(2, 8)} direction="down" duration={55} className="hidden md:block" />
                        </div>

                        <div className="flex justify-center mt-12">
                            <Link
                                href="/templates"
                                className="group flex items-center gap-3 px-7 py-3 rounded-xl border border-white/15 text-[8px] font-black uppercase tracking-[0.4em] text-white hover:bg-white hover:text-slate-900 transition-all"
                            >
                                Explore templates
                                <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                            </Link>
                        </div>
                    </section>

                    {/* ─── NEW: Scroll-Workflow-Build (Dark, scroll-driven) ─────── */}
                    <ScrollWorkflowSection />

                    {/* ─── Templates Carousel (Dark, infinite marquee) ──────────── */}
                    <TemplateCarousel />

                    {/* ─── Final CTA (Dark) ────────────────────────────────────── */}
                    <section className="w-full max-w-7xl px-8 py-32">
                        <motion.div
                            initial={{ opacity: 0, y: 30 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.8 }}
                            className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 p-12 md:p-20 text-center"
                        >
                            <div className="absolute inset-0 opacity-30">
                                <div className="absolute top-0 left-1/4 w-[40rem] h-[40rem] rounded-full bg-accent-primary/40 blur-[120px]" />
                                <div className="absolute bottom-0 right-1/4 w-[40rem] h-[40rem] rounded-full bg-accent-secondary/40 blur-[120px]" />
                            </div>

                            <div className="relative z-10 flex flex-col items-center gap-8 max-w-3xl mx-auto">
                                <span className="text-[7px] font-black uppercase tracking-[0.5em] text-accent-primary opacity-80">Your turn</span>
                                <h2 className="text-3xl md:text-6xl font-black uppercase font-display tracking-tighter text-white leading-[0.9]">
                                    Build your first workflow in <span className="text-accent-primary italic">60 seconds</span>.
                                </h2>
                                <PromptRotator />
                                <div className="flex flex-col sm:flex-row gap-4 pt-2">
                                    <MagneticButton href="/chat">
                                        <div className="group flex items-center justify-center gap-3 px-10 py-5 rounded-2xl bg-white text-slate-900 font-black text-base hover:bg-accent-primary transition-colors shadow-2xl">
                                            START BUILDING
                                            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                                        </div>
                                    </MagneticButton>
                                    <Link
                                        href="/templates"
                                        className="flex items-center justify-center gap-3 px-10 py-5 rounded-2xl border border-white/15 text-white font-black text-base hover:bg-white/10 transition-all"
                                    >
                                        <Layers3 className="w-5 h-5" />
                                        Browse templates
                                    </Link>
                                </div>
                                <div className="flex items-center gap-6 pt-4 text-[7px] font-black uppercase tracking-[0.4em] text-white/40">
                                    <div className="flex items-center gap-2"><Shield className="w-3 h-3" />No credit card</div>
                                    <div className="flex items-center gap-2"><Zap className="w-3 h-3" />100 free credits</div>
                                    <div className="flex items-center gap-2"><Globe2 className="w-3 h-3" />Cancel any time</div>
                                </div>
                            </div>
                        </motion.div>
                    </section>

                    {/* ─── Footer ─────────────────────────────────────────────── */}
                    <footer className="w-full max-w-7xl px-12 py-16 mt-8">
                        <div className="flex flex-col md:flex-row justify-between items-start gap-12 mb-12">
                            <div className="space-y-4 max-w-xs">
                                <PrisfolLogo dark />
                                <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 leading-relaxed">
                                    The visual engine for AI image and video workflows.
                                </p>
                            </div>
                            <div className="grid grid-cols-4 gap-12 w-full">
                                <div className="space-y-4">
                                    <h4 className="text-[7px] font-black uppercase tracking-[0.4em] text-accent-primary opacity-60">Product</h4>
                                    <ul className="space-y-2 text-[7px] font-black text-white/40 uppercase tracking-[0.2em]">
                                        <li><a href="#capabilities" className="hover:text-white transition-colors">Capabilities</a></li>
                                        <li><a href="#process" className="hover:text-white transition-colors">Process</a></li>
                                        <li><a href="#templates" className="hover:text-white transition-colors">Templates</a></li>
                                        <li><Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link></li>
                                    </ul>
                                </div>
                                <div className="space-y-4">
                                    <h4 className="text-[7px] font-black uppercase tracking-[0.4em] text-accent-primary opacity-60">Engine</h4>
                                    <ul className="space-y-2 text-[7px] font-black text-white/40 uppercase tracking-[0.2em]">
                                        <li><a href="#" className="hover:text-white transition-colors">Nodes</a></li>
                                        <li><a href="#" className="hover:text-white transition-colors">Models</a></li>
                                        <li><Link href="/templates" className="hover:text-white transition-colors">Templates</Link></li>
                                    </ul>
                                </div>
                                <div className="space-y-4">
                                    <h4 className="text-[7px] font-black uppercase tracking-[0.4em] text-accent-primary opacity-60">Network</h4>
                                    <ul className="space-y-2 text-[7px] font-black text-white/40 uppercase tracking-[0.2em]">
                                        <li><a href="#" className="hover:text-white transition-colors">GitHub</a></li>
                                        <li><a href="#" className="hover:text-white transition-colors">Discord</a></li>
                                        <li><a href="#" className="hover:text-white transition-colors">Twitter</a></li>
                                    </ul>
                                </div>
                                <div className="space-y-4">
                                    <h4 className="text-[7px] font-black uppercase tracking-[0.4em] text-accent-primary opacity-60">Legal</h4>
                                    <ul className="space-y-2 text-[7px] font-black text-white/40 uppercase tracking-[0.2em]">
                                        <li><Link href="/legal/terms" className="hover:text-white transition-colors">Terms</Link></li>
                                        <li><Link href="/legal/privacy" className="hover:text-white transition-colors">Privacy</Link></li>
                                        <li><Link href="/legal/refund" className="hover:text-white transition-colors">Refunds</Link></li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-between items-center pt-8 border-t border-white/5 text-[7px] font-black tracking-[0.6em] text-white/10 uppercase">
                            <div>© 2026 PRISFOL</div>
                            <div className="flex gap-6"><span>NOMINAL</span><span>EDGE_GLOBAL</span></div>
                        </div>
                    </footer>
                </div>
            </div>
        </div>
    );
}
