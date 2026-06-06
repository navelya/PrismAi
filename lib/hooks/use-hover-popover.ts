'use client';

import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface HoverPopover {
    /** Whether the popover should be shown. */
    open: boolean;
    /** Imperative setter (e.g. close after an item is chosen). */
    setOpen: (open: boolean) => void;
    /**
     * Spread onto the root element that wraps BOTH the trigger and the popover,
     * so moving the cursor from the trigger into the popover keeps it open.
     */
    rootProps: {
        ref: React.RefObject<HTMLDivElement>;
        onMouseEnter: () => void;
        onMouseLeave: () => void;
    };
    /** Toggle handler for the trigger's onClick (touch + a11y fallback). */
    toggle: () => void;
}

/**
 * Hover-to-open popover behavior shared by the chat composer's `+` and
 * Preferences menus. Opens on pointer enter of the root; closes on leave after a
 * short grace window so the cursor can travel from the trigger into the popover
 * without dismissing it. Click still toggles (the primary path on touch, where
 * mouseenter fires but the grace-close on leave is harmless). Also closes on
 * outside pointer-down and Escape while open.
 */
export function useHoverPopover(graceMs = 150): HoverPopover {
    const [open, setOpenState] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearTimer = () => {
        if (closeTimer.current) {
            clearTimeout(closeTimer.current);
            closeTimer.current = null;
        }
    };

    const setOpen = useCallback((next: boolean) => {
        clearTimer();
        setOpenState(next);
    }, []);

    const onMouseEnter = useCallback(() => {
        clearTimer();
        setOpenState(true);
    }, []);

    const onMouseLeave = useCallback(() => {
        clearTimer();
        closeTimer.current = setTimeout(() => setOpenState(false), graceMs);
    }, [graceMs]);

    const toggle = useCallback(() => {
        clearTimer();
        setOpenState((o) => !o);
    }, []);

    // Outside pointer-down + Escape close (matches the prior ChatPlusMenu logic).
    useEffect(() => {
        if (!open) return;
        const onPointer = (e: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [open, setOpen]);

    // Clear any pending timer on unmount.
    useEffect(() => clearTimer, []);

    return {
        open,
        setOpen,
        rootProps: { ref: rootRef, onMouseEnter, onMouseLeave },
        toggle,
    };
}
