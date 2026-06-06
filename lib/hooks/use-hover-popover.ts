'use client';

import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface HoverPopover {
    /** Whether the popover should be shown. */
    open: boolean;
    /** Imperative setter (e.g. close after an item is chosen). */
    setOpen: (open: boolean) => void;
    /**
     * Spread onto the element that wraps the trigger. Opens on enter, closes on
     * leave after a grace window.
     */
    rootProps: {
        ref: React.RefObject<HTMLDivElement>;
        onMouseEnter: () => void;
        onMouseLeave: () => void;
    };
    /**
     * Spread onto the popover surface itself. Needed when the popover is
     * PORTALED out of the root (so it's no longer a DOM descendant): keeps it
     * open while hovered and counts as "inside" for outside-click. Harmless on
     * an in-tree popover too.
     */
    popoverProps: {
        ref: React.RefObject<HTMLDivElement>;
        onMouseEnter: () => void;
        onMouseLeave: () => void;
    };
    /** Toggle handler for the trigger's onClick (touch + a11y fallback). */
    toggle: () => void;
}

/**
 * Hover-to-open popover behavior shared by the chat composer's `+` and
 * Preferences menus. Opens on pointer enter; closes on leave after a short grace
 * window so the cursor can travel from the trigger into the popover without
 * dismissing it. Click still toggles (the primary path on touch). Closes on
 * outside pointer-down and Escape while open.
 *
 * Works whether the popover is rendered in-tree or portaled to the body — spread
 * popoverProps on the surface so hover/outside-click account for it either way.
 */
export function useHoverPopover(graceMs = 150): HoverPopover {
    const [open, setOpenState] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
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

    // Outside pointer-down + Escape close. Treat BOTH the root and the (possibly
    // portaled) popover as "inside".
    useEffect(() => {
        if (!open) return;
        const onPointer = (e: PointerEvent) => {
            const t = e.target as Node;
            if (rootRef.current?.contains(t) || popoverRef.current?.contains(t)) return;
            setOpen(false);
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
        popoverProps: { ref: popoverRef, onMouseEnter, onMouseLeave },
        toggle,
    };
}
