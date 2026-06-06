'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { History, Maximize2, Minimize2, PanelLeftClose, SquarePen, Loader2, Clock, Check } from 'lucide-react';
import { useAppStore } from '@/lib/store/app-store';
import { useSession } from '@/lib/hooks/use-session';
import { chatsApi, ChatRow } from '@/lib/api/client';

const iconBtn =
    'flex items-center justify-center w-7 h-7 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

// ─── Relative-time formatter ────────────────────────────────────────────────
function timeAgo(iso?: string): string {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const diffMs = Date.now() - then;
    const m = Math.floor(diffMs / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    const w = Math.floor(d / 7);
    if (w < 5) return `${w}w ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Header bar for the canvas-mode (copilot) chat — mirrors the Assets/Characters
 * side-window header.
 *
 * Left:  New chat (archive current + start fresh, same session/canvas) · History
 *        (this session's chats).
 * Right: Full screen toggle · Minimize.
 *
 * A session (workflow) owns one canvas and many chats; "New chat" keeps the
 * canvas and just resets the conversation, which also keeps the AI's context
 * small. Nothing is deleted — past chats live in the history dropdown.
 */
export function ChatPanelHeader() {
    const isFullscreen = useAppStore((s) => s.isChatFullscreen);
    const setIsFullscreen = useAppStore((s) => s.setIsChatFullscreen);
    const setIsCopilotMinimized = useAppStore((s) => s.setIsCopilotMinimized);
    const hasMessages = useAppStore((s) => s.chatMessages.length > 0);
    const { createNewChat, switchChat } = useSession();

    const [busy, setBusy] = useState(false);

    const handleNewChat = useCallback(async () => {
        // Empty chat already → nothing to archive; avoid spawning blank chats.
        if (!hasMessages || busy) return;
        setBusy(true);
        try {
            await createNewChat();
        } finally {
            setBusy(false);
        }
    }, [hasMessages, busy, createNewChat]);

    const handleMinimize = useCallback(() => {
        setIsFullscreen(false);
        setIsCopilotMinimized(true);
    }, [setIsFullscreen, setIsCopilotMinimized]);

    return (
        <div className="flex items-center justify-between gap-2 px-2 py-2 border-b border-stroke-subtle/60 flex-shrink-0">
            {/* Left — new chat + history */}
            <div className="flex items-center gap-0.5">
                <button
                    onClick={handleNewChat}
                    disabled={!hasMessages || busy}
                    className={iconBtn}
                    title="New chat"
                    aria-label="New chat"
                >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <SquarePen className="w-4 h-4" />}
                </button>
                <ChatHistoryMenu onSelect={switchChat} />
            </div>

            {/* Right — full screen + minimize */}
            <div className="flex items-center gap-0.5">
                <button
                    onClick={() => setIsFullscreen(!isFullscreen)}
                    className={iconBtn}
                    title={isFullscreen ? 'Exit full screen' : 'Full screen'}
                    aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
                >
                    {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
                <button
                    onClick={handleMinimize}
                    className={iconBtn}
                    title="Minimize chat"
                    aria-label="Minimize chat"
                >
                    <PanelLeftClose className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

// ─── History dropdown (hover-opened, portaled to escape the chat's clip) ─────
function ChatHistoryMenu({ onSelect }: { onSelect: (chatId: string) => void }) {
    const activeSessionId = useAppStore((s) => s.activeSessionId);

    const [open, setOpen] = useState(false);
    const [chats, setChats] = useState<ChatRow[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

    const triggerRef = useRef<HTMLButtonElement>(null);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    const fetchChats = useCallback(async () => {
        const sid = useAppStore.getState().activeSessionId;
        if (!sid) return;
        setLoading(true);
        try {
            const { chats: data, activeChatId: active } = await chatsApi.list(sid);
            setChats(Array.isArray(data) ? data : []);
            setActiveChatId(active);
            setLoaded(true);
        } catch (err) {
            console.error('[ChatHistory] failed to load chats', err);
        } finally {
            setLoading(false);
        }
    }, []);

    const positionFromTrigger = useCallback(() => {
        const el = triggerRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setCoords({ top: r.bottom + 6, left: r.left });
    }, []);

    const cancelClose = useCallback(() => {
        if (closeTimer.current) {
            clearTimeout(closeTimer.current);
            closeTimer.current = null;
        }
    }, []);

    const scheduleClose = useCallback(() => {
        cancelClose();
        closeTimer.current = setTimeout(() => setOpen(false), 160);
    }, [cancelClose]);

    const handleOpen = useCallback(() => {
        cancelClose();
        positionFromTrigger();
        setOpen(true);
        fetchChats();
    }, [cancelClose, positionFromTrigger, fetchChats]);

    useEffect(() => () => cancelClose(), [cancelClose]);

    useEffect(() => {
        if (!open) return;
        const onShift = () => positionFromTrigger();
        window.addEventListener('resize', onShift);
        window.addEventListener('scroll', onShift, true);
        return () => {
            window.removeEventListener('resize', onShift);
            window.removeEventListener('scroll', onShift, true);
        };
    }, [open, positionFromTrigger]);

    const pick = useCallback(
        (id: string) => {
            setOpen(false);
            if (id === activeChatId) return;
            onSelect(id);
        },
        [onSelect, activeChatId],
    );

    if (!activeSessionId) return null;

    return (
        <>
            <button
                ref={triggerRef}
                onMouseEnter={handleOpen}
                onMouseLeave={scheduleClose}
                onClick={open ? () => setOpen(false) : handleOpen}
                className={`${iconBtn} ${open ? 'text-content-primary bg-white/10' : ''}`}
                title="Chat history"
                aria-label="Chat history"
                aria-haspopup="menu"
                aria-expanded={open}
            >
                <History className="w-4 h-4" />
            </button>

            {mounted &&
                createPortal(
                    <AnimatePresence>
                        {open && coords && (
                            <motion.div
                                role="menu"
                                onMouseEnter={cancelClose}
                                onMouseLeave={scheduleClose}
                                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                                transition={{ duration: 0.14, ease: 'easeOut' }}
                                style={{ position: 'fixed', top: coords.top, left: coords.left, zIndex: 90 }}
                                className="w-64 max-h-[60vh] overflow-y-auto rounded-xl bg-surface-elevated/95 backdrop-blur-xl border border-stroke-subtle shadow-2xl shadow-black/50 p-1.5"
                            >
                                <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-content-tertiary">
                                    Chats in this workflow
                                </div>

                                {loading && !loaded && (
                                    <div className="flex items-center gap-2 px-2 py-3 text-xs text-content-tertiary">
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
                                    </div>
                                )}

                                {loaded && chats.length === 0 && (
                                    <div className="px-2 py-3 text-xs text-content-tertiary">No chats yet.</div>
                                )}

                                <div className="flex flex-col">
                                    {chats.map((c) => {
                                        const active = c.id === activeChatId;
                                        return (
                                            <button
                                                key={c.id}
                                                role="menuitem"
                                                onClick={() => pick(c.id)}
                                                className={`group flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-colors ${
                                                    active
                                                        ? 'bg-accent-primary/10 text-accent-primary'
                                                        : 'text-content-secondary hover:text-content-primary hover:bg-white/5'
                                                }`}
                                            >
                                                <div className="min-w-0 flex-1">
                                                    <span className="block truncate text-sm font-medium">
                                                        {c.title?.trim() || 'New chat'}
                                                    </span>
                                                    <div className="flex items-center gap-1 mt-0.5 text-[11px] text-content-tertiary">
                                                        <Clock className="w-3 h-3" />
                                                        {timeAgo(c.updated_at)}
                                                    </div>
                                                </div>
                                                {active && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>,
                    document.body,
                )}
        </>
    );
}
