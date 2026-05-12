'use client';

import React, {
    useState,
    useRef,
    useEffect,
    useLayoutEffect,
    useCallback,
    forwardRef,
} from 'react';
import {
    Send,
    Mic,
    MicOff,
    Square,
    Plus,
    X,
    ImagePlus,
    Sparkles,
} from 'lucide-react';
import { Tooltip } from '@/components/ui/Tooltip';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { ModelPicker } from './ModelPicker';
import { Select, type SelectOption } from '@/components/ui/Select';

const PLUS_MENU_OPTIONS: SelectOption[] = [
    {
        id: 'add-images',
        display_name: 'Add images',
        icon: <ImagePlus className="w-3.5 h-3.5 text-accent-primary" />,
    },
    {
        id: 'templates',
        display_name: 'Templates',
        subtitle: 'Coming soon',
        icon: <Sparkles className="w-3.5 h-3.5 text-content-tertiary" />,
        disabled: true,
    },
];

const PlusTriggerButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
    function PlusTriggerButton(props, ref) {
        const { className, children, ...rest } = props;
        return (
            <button
                ref={ref}
                type="button"
                aria-label="Add attachment"
                {...rest}
                className={`p-2 rounded-lg transition-colors bg-surface-secondary hover:bg-surface-tertiary text-content-tertiary hover:text-content-secondary data-[state=open]:bg-surface-tertiary data-[state=open]:text-content-primary outline-none [&[data-state=open]>svg]:rotate-45 ${className ?? ''}`}
            >
                <Plus className="w-5 h-5 transition-transform" />
                {children}
            </button>
        );
    }
);

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
    isPaid?: boolean;
    selectedModel?: 'haiku' | 'sonnet';
    onModelSelect?: (m: 'haiku' | 'sonnet') => void;
    hasMessages?: boolean;
}

const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
    function ChatInput(
        {
            value,
            onChange,
            disabled,
            onSend,
            onStop,
            isLoading,
            onOpenImagePicker,
            onToggleVoice,
            isVoiceActive,
            isCanvasMode,
            attachedImages,
            onRemoveAttachedImage,
            isPaid = false,
            selectedModel = 'sonnet',
            onModelSelect,
            hasMessages = false,
        },
        ref
    ) {
        const isMobile = useIsMobile();

        const [isExpanded, setIsExpanded] = useState(false);
        const [isMultiLine, setIsMultiLine] = useState(false);
        // Mirror isMultiLine into a ref so adjustTextareaHeight can read the latest
        // value without taking isMultiLine as a useCallback dep. Otherwise:
        //   setIsMultiLine → state change → adjustTextareaHeight new identity →
        //   useEffect re-fires → adjustTextareaHeight → setIsMultiLine → ...
        // Triggered by any external CSS change that perturbs the textarea's
        // scrollHeight into the (40, 60) band (e.g. canvas-mode toggle, which
        // flips minHeight 24↔40 and the textarea's positioning class). Result was
        // "Maximum update depth exceeded".
        const isMultiLineRef = useRef(isMultiLine);
        useEffect(() => { isMultiLineRef.current = isMultiLine; }, [isMultiLine]);
        // Single source of truth for which footer dropdown is open. Opening one
        // automatically closes the other so they can't both be visible.
        const [openMenu, setOpenMenu] = useState<'none' | 'plus' | 'model'>('none');
        const plusTriggerRef = useRef<HTMLButtonElement>(null);
        const modelTriggerRef = useRef<HTMLButtonElement>(null);

        /**
         * Radix Select disables pointer events on the page while open, so a
         * click on the *other* dropdown's trigger never fires the trigger's
         * click handler. We bridge the two by inspecting the outside-pointer-down
         * target: if it landed on the sibling trigger, switch which menu is
         * open in the same interaction.
         *
         * Functional setState ensures we don't fight with Radix's own
         * onOpenChange(false) firing right after — we only collapse to 'none'
         * if the menu is still showing the dropdown that just dismissed.
         */
        const handlePlusOutside = (e: CustomEvent<{ originalEvent: PointerEvent }>) => {
            const target = e.detail?.originalEvent?.target as Node | null | undefined;
            if (target && modelTriggerRef.current?.contains(target)) {
                setOpenMenu('model');
            }
        };
        const handleModelOutside = (e: CustomEvent<{ originalEvent: PointerEvent }>) => {
            const target = e.detail?.originalEvent?.target as Node | null | undefined;
            if (target && plusTriggerRef.current?.contains(target)) {
                setOpenMenu('plus');
            }
        };
        const handlePlusOpenChange = (o: boolean) => {
            if (o) setOpenMenu('plus');
            else setOpenMenu(prev => (prev === 'plus' ? 'none' : prev));
        };
        const handleModelOpenChange = (o: boolean) => {
            if (o) setOpenMenu('model');
            else setOpenMenu(prev => (prev === 'model' ? 'none' : prev));
        };

        // Internal refs for the ghost element (single-line width probe) and the
        // forwarded textarea.  We need a local ref for effects; if the parent
        // passes a callback ref we create a local one and keep them in sync.
        const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
        const textareaRef =
            (ref as React.RefObject<HTMLTextAreaElement>) ?? internalTextareaRef;
        const ghostRef = useRef<HTMLDivElement>(null);

        // ── height management ──────────────────────────────────────────────
        const adjustTextareaHeight = useCallback(() => {
            const textarea = textareaRef.current;
            const ghost = ghostRef.current;
            if (!textarea) return;

            const currentInput = textarea.value;
            const hasNewlines = currentInput.includes('\n');

            if (!isMultiLineRef.current && !hasNewlines) {
                if (textarea.scrollHeight > 40) {
                    setIsMultiLine(true);
                }
            } else {
                textarea.style.height = 'auto';
                const contentHeight = textarea.scrollHeight;

                if (!hasNewlines && contentHeight < 60 && ghost) {
                    ghost.textContent = currentInput;
                    const singleLineAvailableWidth = textarea.clientWidth - 144;
                    ghost.style.width = `${singleLineAvailableWidth}px`;

                    if (ghost.scrollHeight < 50) {
                        setIsMultiLine(false);
                    }
                } else if (!hasNewlines && contentHeight < 60) {
                    setIsMultiLine(false);
                } else {
                    setIsMultiLine(hasNewlines || contentHeight > 40);
                    const maxHeight = isMobile ? (isExpanded ? 200 : 72) : 200;
                    const newHeight = Math.min(contentHeight, maxHeight);
                    textarea.style.height = `${newHeight}px`;
                }
            }
        }, [isMobile, isExpanded, textareaRef]);

        // Sync height whenever value changes (including when cleared)
        useEffect(() => {
            adjustTextareaHeight();
        }, [value, adjustTextareaHeight]);

        // Sync height on textarea resize
        useEffect(() => {
            const textarea = textareaRef.current;
            if (!textarea) return;
            const ro = new ResizeObserver(() => {
                adjustTextareaHeight();
            });
            ro.observe(textarea);
            return () => ro.disconnect();
        }, [adjustTextareaHeight, textareaRef]);

        // Enforce max-height on isMultiLine toggle
        useLayoutEffect(() => {
            const textarea = textareaRef.current;
            if (textarea && isMultiLine) {
                textarea.style.height = 'auto';
                const newHeight = textarea.scrollHeight;
                const maxHeight = isMobile ? (isExpanded ? 200 : 72) : 200;
                textarea.style.height = `${Math.min(newHeight, maxHeight)}px`;
            }
        }, [isMultiLine, isMobile, isExpanded, textareaRef]);

        const showExpandButton =
            isMobile &&
            !isExpanded &&
            textareaRef.current !== null &&
            (textareaRef.current?.scrollHeight ?? 0) > 72;

        return (
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    onSend();
                }}
                className="relative w-full max-w-3xl mx-auto"
            >
                {showExpandButton && (
                    <button
                        type="button"
                        onClick={() => setIsExpanded(true)}
                        className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 text-xs
                                   bg-surface-tertiary hover:bg-surface-elevated text-content-secondary rounded-t-lg
                                   border border-b-0 border-stroke-subtle transition-colors z-10"
                    >
                        Expand ↑
                    </button>
                )}

                <div
                    className={`relative flex flex-col rounded-2xl border bg-surface-secondary/30 backdrop-blur-xl
                               focus-within:ring-2 focus-within:ring-accent-primary/20 focus-within:border-accent-primary/50 focus-within:bg-bg-primary/50
                               transition-all duration-300 group/input
                               ${isVoiceActive
                            ? 'border-accent-error ring-2 ring-accent-error/20'
                            : 'border-accent-primary/10'
                        }`}
                >
                    {attachedImages.length > 0 && (
                        <div
                            className={`flex gap-2 px-3 pt-3 pb-1 overflow-x-auto ${isCanvasMode ? 'px-2 pt-2' : 'px-3 pt-3'}`}
                        >
                            {attachedImages.map((img, index) => (
                                <div
                                    key={index}
                                    className="relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden group/img bg-surface-tertiary border border-stroke-subtle"
                                >
                                    <img
                                        src={img}
                                        alt={`Attached ${index + 1}`}
                                        className="w-full h-full object-cover"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => onRemoveAttachedImage(index)}
                                        className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/70 rounded-full flex items-center justify-center
                                                   opacity-0 group-hover/img:opacity-100 hover:bg-accent-error transition-all"
                                    >
                                        <X className="w-3 h-3 text-white" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Ghost div for single-line width probe */}
                    <div
                        ref={ghostRef}
                        className="absolute top-0 left-0 -z-50 invisible whitespace-pre-wrap break-words pointer-events-none"
                        style={{
                            fontFamily: 'inherit',
                            fontSize: 'inherit',
                            lineHeight: '1.5rem',
                            padding: '8px 8px',
                            minHeight: '0px',
                        }}
                        aria-hidden="true"
                    />

                    <textarea
                        ref={textareaRef}
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                onSend();
                            }
                        }}
                        placeholder={
                            isVoiceActive
                                ? 'Listening...'
                                : hasMessages
                                    ? 'Edit'
                                    : 'Describe what you want to do'
                        }
                        rows={1}
                        disabled={disabled}
                        className={`bg-transparent focus:outline-none text-content-primary placeholder-content-tertiary resize-none leading-6 [&::-webkit-scrollbar]:hidden
                                     ${isMultiLine || attachedImages.length > 0 || isCanvasMode
                                ? `relative w-full px-4 py-2 ${isCanvasMode ? 'px-3' : 'px-4'}`
                                : `absolute left-24 right-24 top-1/2 -translate-y-1/2 px-2 py-2`
                            }`}
                        style={{
                            minHeight:
                                isMultiLine || attachedImages.length > 0 || isCanvasMode ? '40px' : '24px',
                            maxHeight: isMobile
                                ? isExpanded
                                    ? '200px'
                                    : '72px'
                                : '200px',
                            overflowY: isMultiLine ? 'auto' : 'hidden',
                            scrollbarWidth: 'none',
                            msOverflowStyle: 'none',
                        } as React.CSSProperties}
                    />

                    {/* ── Action row ─────────────────────────────────────────────────
                         Full-screen (!isCanvasMode):  [ + ] [ ModelPicker ]  ···  [ mic ] [ send ]
                         Canvas / minimized (isCanvasMode): textarea goes full width,
                           then this row appears beneath it.
                    ──────────────────────────────────────────────────────────────── */}
                    <div
                        className={`flex w-full items-center justify-between px-2 pb-2
                                    ${isMultiLine || attachedImages.length > 0 || isCanvasMode ? '' : 'pt-2'}`}
                    >
                        {/* Left: attachment button + model picker */}
                        <div className="flex items-center gap-1">
                            {/* Attachment (+) menu — shared Select dropdown */}
                            <div className="relative z-10">
                                <Select
                                    variant="minimal"
                                    options={PLUS_MENU_OPTIONS}
                                    value=""
                                    onChange={(e) => {
                                        if (e.target.value === 'add-images') onOpenImagePicker();
                                    }}
                                    open={openMenu === 'plus'}
                                    onOpenChange={handlePlusOpenChange}
                                    onPointerDownOutside={handlePlusOutside}
                                    triggerNode={<PlusTriggerButton ref={plusTriggerRef} />}
                                />
                            </div>

                            {/* Model picker — same Select dropdown, controlled */}
                            {onModelSelect && (
                                <ModelPicker
                                    selectedModel={selectedModel}
                                    onSelect={onModelSelect}
                                    isPaid={isPaid}
                                    open={openMenu === 'model'}
                                    onOpenChange={handleModelOpenChange}
                                    onPointerDownOutside={handleModelOutside}
                                    triggerRef={modelTriggerRef}
                                />
                            )}
                        </div>

                        {/* Right: voice + send/stop */}
                        <div className="flex items-center gap-1 z-10">
                            {!isLoading && (
                                <Tooltip
                                    content={isVoiceActive ? 'Stop listening' : 'Voice input'}
                                    position="top"
                                >
                                    <button
                                        type="button"
                                        onClick={onToggleVoice}
                                        className={`p-2 rounded-lg transition-all duration-200
                                            ${isVoiceActive
                                                ? 'bg-accent-error text-white animate-pulse'
                                                : 'bg-surface-secondary text-content-tertiary hover:bg-surface-tertiary hover:text-content-secondary'
                                            }`}
                                    >
                                        {isVoiceActive ? (
                                            <MicOff className="w-4 h-4" />
                                        ) : (
                                            <Mic className="w-4 h-4" />
                                        )}
                                    </button>
                                </Tooltip>
                            )}

                            {isLoading ? (
                                <Tooltip content="Stop" position="top">
                                    <button
                                        type="button"
                                        onClick={onStop}
                                        className="p-2 rounded-lg bg-surface-secondary hover:bg-accent-error/10 border border-stroke-subtle hover:border-accent-error/30 transition-all duration-200 group"
                                    >
                                        <Square className="w-4 h-4 text-content-tertiary group-hover:text-accent-error fill-current transition-colors" />
                                    </button>
                                </Tooltip>
                            ) : (
                                <Tooltip content="Send message" position="top">
                                    <button
                                        type="submit"
                                        disabled={!value.trim() && attachedImages.length === 0}
                                        className={`p-2 rounded-lg transition-all duration-300
                                            ${value.trim() || attachedImages.length > 0
                                                ? 'bg-accent-primary hover:bg-accent-hover text-white shadow-[0_0_15px_rgba(6,182,212,0.4)]'
                                                : 'bg-surface-tertiary text-content-tertiary cursor-not-allowed'
                                            }`}
                                    >
                                        <Send
                                            className={`${isCanvasMode ? 'w-3.5 h-3.5' : 'w-4 h-4'}`}
                                        />
                                    </button>
                                </Tooltip>
                            )}
                        </div>
                    </div>
                </div>
            </form>
        );
    }
);

export default ChatInput;
