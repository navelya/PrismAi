'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ImagePlus, Pen, ArrowRight, LayoutTemplate, ImageIcon } from 'lucide-react';
import ChatInput from './ChatInput';
import { Toast } from '@/components/ui/Toast';
import { useAppStore } from '@/lib/store/app-store';
import { TemplatePreviewModal } from '@/components/templates/TemplatePreviewModal';
import type { TemplateListItem } from '@/components/templates/TemplateCard';
import type { Character } from '@/lib/api/client';

/**
 * Capability cards for the welcome screen. Each teaches one thing Prisfol can
 * do and, on click, seeds the composer with a starter prompt the user can edit
 * and send. The `image` is a generated glass-icon thumbnail (in
 * public/assets/welcome-cards) standing in for a generic icon, so the cards
 * read as a small gallery of what's possible rather than a list of buttons.
 */
const CAPABILITY_CARDS: {
    image: string;
    title: string;
    description: string;
    prompt: string;
}[] = [
    {
        image: '/assets/welcome-cards/generate.png',
        title: 'Generate',
        description: 'Create images & video from a description.',
        prompt: 'Generate a cinematic product shot of ',
    },
    {
        image: '/assets/welcome-cards/edit.png',
        title: 'Edit & retouch',
        description: 'Remove backgrounds, swap outfits, fix lighting.',
        prompt: 'Remove the background from my photo and ',
    },
    {
        image: '/assets/welcome-cards/automate.png',
        title: 'Automate',
        description: 'Chain steps to process many images at once.',
        prompt: 'Build a workflow to upscale and watermark a batch of photos',
    },
    {
        image: '/assets/welcome-cards/guidance.png',
        title: 'Get guidance',
        description: 'Not sure where to start? Ask what is possible.',
        prompt: 'What can I build with Prisfol?',
    },
];

// Each card enters from the corner it sits in (2×2 grid), so on a new chat the
// four cards converge inward toward the center. Index order = TL, TR, BL, BR.
const CARD_ENTER_OFFSETS = [
    { x: -52, y: -20 },
    { x: 52, y: -20 },
    { x: -52, y: 20 },
    { x: 52, y: 20 },
];

function WelcomeCard({
    card,
    index,
    onClick,
}: {
    card: (typeof CAPABILITY_CARDS)[number];
    index: number;
    onClick: () => void;
}) {
    const off = CARD_ENTER_OFFSETS[index % CARD_ENTER_OFFSETS.length];
    return (
        <motion.button
            type="button"
            onClick={onClick}
            initial={{ opacity: 0, x: off.x, y: off.y, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            transition={{ delay: 0.12 + index * 0.09, type: 'spring', stiffness: 230, damping: 22 }}
            whileHover={{ y: -4 }}
            className="group relative flex items-center gap-3.5 p-3 text-left rounded-2xl overflow-hidden
                       bg-surface-secondary/60 hover:bg-surface-secondary
                       border border-stroke-subtle hover:border-accent-primary/40
                       transition-colors duration-200 hover:shadow-xl hover:shadow-black/30"
        >
            {/* Generated glass-icon thumbnail (stands in for an icon) */}
            <span className="shrink-0 w-14 h-14 rounded-xl overflow-hidden bg-surface-primary ring-1 ring-white/10 group-hover:ring-accent-primary/30 transition-all">
                <img src={card.image} alt="" draggable={false} className="w-full h-full object-cover" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-content-primary">
                    {card.title}
                    <ArrowRight className="w-3.5 h-3.5 text-content-tertiary opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />
                </span>
                <span className="block text-xs text-content-secondary mt-0.5 leading-relaxed">
                    {card.description}
                </span>
            </span>
        </motion.button>
    );
}

/** Fisher–Yates shuffle, returning the first `n` of a fresh copy. */
function sample<T>(arr: T[], n: number): T[] {
    const pool = [...arr];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n);
}

/**
 * Entry point to the template gallery. The "Browse templates" pill opens
 * /templates on click; hovering it reveals a popover of 4 RANDOM templates
 * (re-rolled each time it opens) with thumbnail + description, each selectable
 * — clicking one opens the same preview modal the gallery uses.
 *
 * Hover stays alive across the button→popover trip via (a) a `pb-2` bridge so
 * there's no dead gap between them and (b) a short close delay on mouse-leave,
 * so the popover no longer vanishes the instant the cursor leaves the button.
 */
function TemplatesAffordance() {
    const router = useRouter();
    const templates = useAppStore((s) => s.templates) as TemplateListItem[];
    const fetchTemplates = useAppStore((s) => s.fetchTemplates);

    // No-op if already preloaded on app open; covers a cold welcome screen.
    useEffect(() => { fetchTemplates?.(); }, [fetchTemplates]);

    const [open, setOpen] = useState(false);
    const [picks, setPicks] = useState<TemplateListItem[]>([]);
    const [previewId, setPreviewId] = useState<string | null>(null);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const openMenu = () => {
        if (closeTimer.current) clearTimeout(closeTimer.current);
        if (templates.length === 0) return; // nothing to preview; the pill still navigates
        if (!open) setPicks(sample(templates, 4)); // fresh 4 every time it opens
        setOpen(true);
    };
    const scheduleClose = () => {
        if (closeTimer.current) clearTimeout(closeTimer.current);
        closeTimer.current = setTimeout(() => setOpen(false), 160);
    };

    return (
        <div className="relative inline-flex" onMouseEnter={openMenu} onMouseLeave={scheduleClose}>
            <AnimatePresence>
                {open && picks.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 6 }}
                        transition={{ duration: 0.15, ease: 'easeOut' }}
                        // pb-2 is the hover bridge: it makes the popover wrapper
                        // touch the button's top edge, so there is no gap to "fall
                        // through" on the way up.
                        className="absolute bottom-full left-1/2 -translate-x-1/2 pb-2 w-80 z-30"
                    >
                        <div className="rounded-2xl bg-surface-primary border border-white/10 shadow-2xl ring-1 ring-white/5 p-2">
                            <div className="flex items-center justify-between px-1.5 pt-1 pb-1.5">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">
                                    Templates
                                </span>
                                <span className="text-[10px] text-content-tertiary/70">Click to preview</span>
                            </div>
                            <div className="space-y-0.5">
                                {picks.map((t) => (
                                    <button
                                        key={t.id}
                                        type="button"
                                        onClick={() => { setPreviewId(t.id); setOpen(false); }}
                                        className="group/t w-full flex items-center gap-2.5 p-1.5 rounded-xl text-left hover:bg-white/5 transition-colors"
                                    >
                                        <span className="shrink-0 w-14 h-11 rounded-lg overflow-hidden bg-surface-tertiary border border-white/10 flex items-center justify-center">
                                            {t.thumbnail_url
                                                ? <img src={t.thumbnail_url} alt="" className="w-full h-full object-cover" />
                                                : <ImageIcon className="w-4 h-4 text-content-tertiary/50" />}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-xs font-medium text-content-primary truncate">{t.name}</span>
                                            {t.description && (
                                                <span className="block text-[11px] text-content-secondary leading-snug line-clamp-2">
                                                    {t.description}
                                                </span>
                                            )}
                                        </span>
                                    </button>
                                ))}
                            </div>
                            <button
                                type="button"
                                onClick={() => router.push('/templates')}
                                className="mt-1 w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded-xl text-xs font-medium text-accent-primary hover:bg-accent-primary/10 transition-colors"
                            >
                                Open the full gallery
                                <ArrowRight className="w-3 h-3" />
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <button
                type="button"
                onClick={() => router.push('/templates')}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm
                           bg-surface-secondary hover:bg-surface-tertiary
                           border border-stroke-subtle hover:border-accent-primary/40
                           text-content-secondary hover:text-content-primary transition-colors"
            >
                <LayoutTemplate className="w-4 h-4" />
                Browse templates
            </button>

            <TemplatePreviewModal id={previewId} onClose={() => setPreviewId(null)} />
        </div>
    );
}

interface ChatInputProps {
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
    onSend: () => void;
    onStop: () => void;
    isLoading: boolean;
    onOpenImagePicker: () => void;
    onToggleVoice: () => void;
    isVoiceActive: boolean;
    isCanvasMode: boolean;
    attachedImages: string[];
    onRemoveAttachedImage: (index: number) => void;
    hasMessages?: boolean;
    onMentionedCharactersChange: (chars: Character[]) => void;
}

interface ChatEmptyStateProps {
    userName?: string;
    isMobile: boolean;
    isDragOver: boolean;
    onDragOver: React.DragEventHandler<HTMLDivElement>;
    onDragLeave: React.DragEventHandler<HTMLDivElement>;
    onDrop: React.DragEventHandler<HTMLDivElement>;
    imageInputRef: React.RefObject<HTMLInputElement>;
    onImageInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    chatInputProps: ChatInputProps;
    textareaRef: React.Ref<HTMLTextAreaElement>;
    onCreateNewSession: () => void;
    onSuggestionClick: (prompt: string) => void;
    evictionToast?: boolean;
    evictionToastMessage?: string;
    onDismissEvictionToast?: () => void;
}

export function ChatEmptyState({
    userName,
    isMobile,
    isDragOver,
    onDragOver,
    onDragLeave,
    onDrop,
    imageInputRef,
    onImageInputChange,
    chatInputProps,
    textareaRef,
    onCreateNewSession,
    onSuggestionClick,
    evictionToast,
    evictionToastMessage,
    onDismissEvictionToast,
}: ChatEmptyStateProps) {
    const firstName = userName ? userName.trim().split(' ')[0].replace(/^./, (c) => c.toUpperCase()) : '';

    if (!isMobile) {
        return (
            <div
                className="relative flex flex-col h-full bg-surface-primary"
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
            >
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={onImageInputChange}
                    className="hidden"
                />

                {isDragOver && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-primary/90 backdrop-blur-sm">
                        <div className="text-center">
                            <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                                <ImagePlus className="w-10 h-10 text-white" />
                            </div>
                            <h2 className="text-xl font-semibold text-content-primary">Add images</h2>
                            <p className="text-content-secondary mt-1">Drop files here to add to your message</p>
                        </div>
                    </div>
                )}

                {/* Middle: greeting + capability cards, vertically centered. The
                    composer is pinned to the bottom (below), so the cards sit in
                    the open space above it. */}
                <div className="flex-1 overflow-y-auto">
                    <div className="min-h-full flex flex-col items-center justify-center px-6 py-10">
                        <div className="w-full max-w-2xl">
                            {/* Greeting — softened off the global all-caps/black
                                heading style for a warmer, friendlier tone. */}
                            <div className="text-center mb-8 chat-text-fade-in">
                                <h1 className="font-sans normal-case font-semibold tracking-tight text-[28px] sm:text-[32px] text-content-primary">
                                    {firstName ? `Welcome, ${firstName}` : 'Welcome to Prisfol'}
                                </h1>
                                <p className="text-content-secondary mt-2 max-w-md mx-auto">
                                    Pick a starting point below — or just describe what you want in the composer.
                                </p>
                            </div>

                            {/* Capability cards — converge in from each corner */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {CAPABILITY_CARDS.map((card, i) => (
                                    <WelcomeCard
                                        key={card.title}
                                        card={card}
                                        index={i}
                                        onClick={() => onSuggestionClick(card.prompt)}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Composer — pinned to the bottom, with the secondary actions
                    (blank canvas + browse templates) stacked right above it. */}
                <div className="sticky bottom-0 p-4 bg-surface-primary/80 backdrop-blur-sm">
                    <div className="max-w-3xl mx-auto flex flex-col items-center gap-2 mb-3">
                        <button
                            onClick={onCreateNewSession}
                            className="group inline-flex items-center gap-2 px-3 py-1 text-sm text-content-tertiary hover:text-content-primary transition-colors"
                        >
                            <Pen className="w-3.5 h-3.5" />
                            Prefer a blank slate? Start an empty canvas
                            <ArrowRight className="w-3.5 h-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />
                        </button>
                        <TemplatesAffordance />
                    </div>
                    <ChatInput ref={textareaRef} {...chatInputProps} hasMessages={false} />
                </div>

                {evictionToast && (
                    <Toast
                        message={evictionToastMessage ?? ''}
                        duration={4000}
                        onClose={onDismissEvictionToast ?? (() => {})}
                    />
                )}
            </div>
        );
    }

    // Mobile variant
    return (
        <div
            className="relative flex flex-col h-full bg-surface-primary"
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={onImageInputChange}
                className="hidden"
            />

            {isDragOver && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-primary/90 backdrop-blur-sm">
                    <div className="text-center">
                        <div className="w-16 h-16 mx-auto mb-3 rounded-xl bg-gradient-premium flex items-center justify-center">
                            <ImagePlus className="w-8 h-8 text-white" />
                        </div>
                        <h2 className="text-lg font-semibold text-content-primary">Add images</h2>
                        <p className="text-content-secondary text-sm mt-1">Drop files here</p>
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-5 py-8">
                <div className="w-full max-w-sm">
                    <div className="text-center mb-6">
                        <h1 className="font-sans normal-case font-semibold tracking-tight text-2xl text-content-primary">
                            {firstName ? `Welcome, ${firstName}` : 'Welcome to Prisfol'}
                        </h1>
                        <p className="text-content-secondary text-sm mt-1.5">
                            Pick a starting point, or describe what you want below.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 gap-2.5">
                        {CAPABILITY_CARDS.map((card, i) => (
                            <WelcomeCard
                                key={card.title}
                                card={card}
                                index={i}
                                onClick={() => onSuggestionClick(card.prompt)}
                            />
                        ))}
                    </div>
                </div>
            </div>

            <div className="sticky bottom-0 border-t border-stroke-subtle p-4 bg-surface-primary/80 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-2 mb-3">
                    <button
                        onClick={onCreateNewSession}
                        className="inline-flex items-center gap-2 px-3 py-1 text-sm text-content-tertiary hover:text-content-primary transition-colors"
                    >
                        <Pen className="w-3.5 h-3.5" />
                        Prefer a blank slate? Start an empty canvas
                    </button>
                    <TemplatesAffordance />
                </div>
                <ChatInput ref={textareaRef} {...chatInputProps} hasMessages={false} />
            </div>
            {evictionToast && (
                <Toast
                    message={evictionToastMessage ?? ''}
                    duration={4000}
                    onClose={onDismissEvictionToast ?? (() => {})}
                />
            )}
        </div>
    );
}
