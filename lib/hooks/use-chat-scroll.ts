'use client';

import { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { useAppStore } from '@/lib/store/app-store';

interface Message {
    id: string;
    type: 'user' | 'assistant';
    [key: string]: any;
}

interface UseChatScrollOptions {
    messages: Message[];
    isLoading: boolean;
    sessionId: string | null | undefined;
}

interface UseChatScrollReturn {
    scrollContainerRef: React.RefObject<HTMLDivElement>;
    contentRef: React.RefObject<HTMLDivElement>;
    messagesEndRef: React.RefObject<HTMLDivElement>;
    spacerRef: React.RefObject<HTMLDivElement>;
    handleScroll: () => void;
    autoScrollEnabled: boolean;
}

export function useChatScroll({
    messages,
    isLoading,
    sessionId,
}: UseChatScrollOptions): UseChatScrollReturn {
    const chatScrollTop = useAppStore((state) => state.chatScrollTop);
    const setChatScrollTop = useAppStore((state) => state.setChatScrollTop);

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const spacerRef = useRef<HTMLDivElement>(null);
    const lastScrollTime = useRef<number>(0);

    const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
    const lastScrollTopRef = useRef(0);

    const [pinnedUserMessageId, setPinnedUserMessageId] = useState<string | null>(null);
    const pinnedUserMessageIdRef = useRef<string | null>(null);
    const prevMessagesLengthRef = useRef(messages.length);
    const lastPinnedScrolledIdRef = useRef<string | null>(null);
    const userMsgViewportOffsetRef = useRef<number>(16);
    const isProgrammaticScrollRef = useRef(false);

    useEffect(() => {
        pinnedUserMessageIdRef.current = pinnedUserMessageId;
    }, [pinnedUserMessageId]);

    const handleScroll = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const { scrollTop, scrollHeight, clientHeight } = container;
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;

        // Sync scroll position to global store for persistence across views
        setChatScrollTop(scrollTop);

        // Strictly tie auto-scroll to whether the user is at the bottom
        setAutoScrollEnabled(isNearBottom);

        lastScrollTopRef.current = scrollTop;

        // Track where the pinned user message sits in the viewport, so we can
        // restore that exact offset after a chat-panel resize. Skip while we
        // are mid-programmatic-scroll to avoid feedback loops.
        if (pinnedUserMessageIdRef.current && !isProgrammaticScrollRef.current) {
            const el = container.querySelector(
                `[data-message-id="${pinnedUserMessageIdRef.current}"]`
            ) as HTMLElement | null;
            if (el) {
                const containerRect = container.getBoundingClientRect();
                const elRect = el.getBoundingClientRect();
                userMsgViewportOffsetRef.current = elRect.top - containerRect.top;
            }
        }
    }, [isLoading, setChatScrollTop]);

    // RESTORE scroll position instantly on mount (avoid eye-jump)
    useLayoutEffect(() => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = chatScrollTop;
            lastScrollTopRef.current = chatScrollTop;
        }
    }, []); // Only on mount

    // 🛡️ ROBUST PINNING: Use ResizeObserver to stay at bottom during any layout shift
    useEffect(() => {
        const content = contentRef.current;
        const container = scrollContainerRef.current;
        if (!content || !container) return;

        const resizeObserver = new ResizeObserver(() => {
            if (autoScrollEnabled && !pinnedUserMessageIdRef.current) {
                container.scrollTop = container.scrollHeight;
                lastScrollTopRef.current = container.scrollTop;
            }
        });

        resizeObserver.observe(content);
        return () => resizeObserver.disconnect();
    }, [autoScrollEnabled]);

    // Reset auto-scroll and position memory when a new request starts
    useEffect(() => {
        if (isLoading) {
            setAutoScrollEnabled(true);
            setChatScrollTop(9999999);
        }
    }, [isLoading, setChatScrollTop]);

    // Force reset scroll memory when switching sessions (fresh start at bottom)
    useEffect(() => {
        if (sessionId) {
            setChatScrollTop(9999999);
            setAutoScrollEnabled(true);
            setPinnedUserMessageId(null);
            if (spacerRef.current) spacerRef.current.style.height = '0px';
            lastPinnedScrolledIdRef.current = null;
            prevMessagesLengthRef.current = 0;
        }
    }, [sessionId, setChatScrollTop]);

    // ChatGPT-style pin: when a new user message is appended, anchor it to the
    // top of the viewport with a spacer below so the assistant reply has the
    // full chat height to render into before scrolling kicks in.
    // handleSend adds user + empty assistant placeholder in one batch, so the
    // last message is the assistant — scan backward through the newly-added
    // range to find the most recent user message.
    useLayoutEffect(() => {
        if (messages.length > prevMessagesLengthRef.current) {
            let newUserMessageId: string | null = null;
            for (let i = messages.length - 1; i >= prevMessagesLengthRef.current; i--) {
                if (messages[i]?.type === 'user') {
                    newUserMessageId = messages[i].id;
                    break;
                }
            }
            if (newUserMessageId) {
                const container = scrollContainerRef.current;
                // Generous initial spacer so the smooth-scroll has room. The
                // dynamic-spacer effect will tighten this to the exact value
                // once the assistant content settles.
                if (container && spacerRef.current) {
                    spacerRef.current.style.height = `${container.clientHeight}px`;
                }
                // Reset the viewport-offset target to the pin position. The
                // smooth-scroll will land the user message at 16px from top.
                userMsgViewportOffsetRef.current = 16;
                // Set ref synchronously so the ResizeObserver bottom-pin gate
                // sees it on the very next tick, before our smooth scroll runs.
                pinnedUserMessageIdRef.current = newUserMessageId;
                setPinnedUserMessageId(newUserMessageId);
            }
        }
        prevMessagesLengthRef.current = messages.length;
    }, [messages]);

    useLayoutEffect(() => {
        if (!pinnedUserMessageId) return;
        if (lastPinnedScrolledIdRef.current === pinnedUserMessageId) return;

        const container = scrollContainerRef.current;
        if (!container) return;
        const el = container.querySelector(
            `[data-message-id="${pinnedUserMessageId}"]`
        ) as HTMLElement | null;
        if (!el) return;

        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const targetScrollTop = container.scrollTop + (elRect.top - containerRect.top) - 16;
        container.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
        lastPinnedScrolledIdRef.current = pinnedUserMessageId;
    }, [pinnedUserMessageId]);

    // Dynamic spacer: keep the spacer sized so that max-scrollTop equals the
    // pinned-position scrollTop. That way the user can't scroll past the pin,
    // and the pin survives chat-panel resizes (e.g. min↔full screen).
    // spacer = max(0, clientHeight − (content below the user message))
    //
    // Two observers: container resize also restores the user-msg viewport
    // offset (because reflow changes message heights and shifts user-msg
    // position); content resize only adjusts the spacer (offset is invariant
    // when content above the user message doesn't change).
    useEffect(() => {
        if (!pinnedUserMessageId) return;

        const container = scrollContainerRef.current;
        if (!container) return;

        const updateSpacer = (restoreOffset: boolean) => {
            const userMsgEl = container.querySelector(
                `[data-message-id="${pinnedUserMessageId}"]`
            ) as HTMLElement | null;
            const spacer = spacerRef.current;
            if (!userMsgEl || !spacer) return;

            const containerHeight = container.clientHeight;
            const containerRect = container.getBoundingClientRect();
            const userMsgRect = userMsgEl.getBoundingClientRect();

            // Invariant offset of the user message inside the scrollable content.
            const userMsgTopInContent =
                userMsgRect.top - containerRect.top + container.scrollTop;

            const currentSpacerHeight = spacer.offsetHeight;
            const naturalScrollHeight = container.scrollHeight - currentSpacerHeight;

            // We want max-scrollTop = userMsgTopInContent − 16.
            //   max-scrollTop = scrollHeight − clientHeight
            // → scrollHeight = userMsgTopInContent − 16 + clientHeight
            const desiredScrollHeight = userMsgTopInContent - 16 + containerHeight;
            const desiredSpacer = Math.max(0, desiredScrollHeight - naturalScrollHeight);

            if (Math.abs(desiredSpacer - currentSpacerHeight) > 1) {
                spacer.style.height = `${desiredSpacer}px`;
            }

            // After a chat-panel resize, message reflow may have shifted the
            // user message — adjust scrollTop so its viewport position matches
            // the previously-captured offset.
            if (restoreOffset) {
                const containerRectAfter = container.getBoundingClientRect();
                const userMsgRectAfter = userMsgEl.getBoundingClientRect();
                const currentOffset = userMsgRectAfter.top - containerRectAfter.top;
                const adjustment = currentOffset - userMsgViewportOffsetRef.current;
                if (Math.abs(adjustment) > 1) {
                    isProgrammaticScrollRef.current = true;
                    container.scrollTop += adjustment;
                    requestAnimationFrame(() => {
                        isProgrammaticScrollRef.current = false;
                    });
                }
            }
        };

        updateSpacer(false);

        const containerRO = new ResizeObserver(() => updateSpacer(true));
        containerRO.observe(container);

        const contentRO = new ResizeObserver(() => updateSpacer(false));
        if (contentRef.current) contentRO.observe(contentRef.current);

        return () => {
            containerRO.disconnect();
            contentRO.disconnect();
        };
    }, [pinnedUserMessageId]);

    useEffect(() => {
        if (autoScrollEnabled && !pinnedUserMessageId) {
            const container = scrollContainerRef.current;
            if (!container) return;

            const now = Date.now();
            if (now - lastScrollTime.current > 100) {
                // Use 'auto' for streaming (performance) and 'smooth' for the very first scroll
                const isStreaming = isLoading && messages.length > 0;
                messagesEndRef.current?.scrollIntoView({
                    behavior: isStreaming ? 'auto' : 'smooth',
                    block: 'end'
                });
                lastScrollTime.current = now;
            }
        }
    }, [messages, autoScrollEnabled, isLoading, pinnedUserMessageId]);

    return {
        scrollContainerRef,
        contentRef,
        messagesEndRef,
        spacerRef,
        handleScroll,
        autoScrollEnabled,
    };
}
