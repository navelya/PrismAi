'use client';

import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 768;

/**
 * Hook to detect if the current device is mobile (screen width < 768px)
 * Uses both initial check and resize listener for responsive detection
 */
export function useIsMobile(): boolean {
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        // Check on mount
        const checkMobile = () => {
            setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
        };

        // Initial check
        checkMobile();

        // Listen for resize events
        window.addEventListener('resize', checkMobile);

        return () => {
            window.removeEventListener('resize', checkMobile);
        };
    }, []);

    return isMobile;
}

/**
 * Hook that reports whether the component has mounted on the client.
 *
 * Used to gate layout branches that diverge hard between mobile/desktop
 * (see AppLayout). On the server and the first client render this is `false`,
 * so consumers can render a neutral shell instead of committing to a layout
 * before `useIsMobile` knows the real viewport width. Without this gate the
 * desktop tree mounts first and is then torn down when `isMobile` flips — and
 * unmounting that Radix-heavy subtree triggers a compose-refs ref-detach loop
 * (React error #185) under React 18.
 */
export function useHasMounted(): boolean {
    const [hasMounted, setHasMounted] = useState(false);
    useEffect(() => {
        setHasMounted(true);
    }, []);
    return hasMounted;
}

/**
 * Hook to get current window dimensions
 */
export function useWindowSize() {
    const [size, setSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        const updateSize = () => {
            setSize({ width: window.innerWidth, height: window.innerHeight });
        };

        updateSize();
        window.addEventListener('resize', updateSize);

        return () => window.removeEventListener('resize', updateSize);
    }, []);

    return size;
}
