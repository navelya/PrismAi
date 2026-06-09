'use client';

import Lottie from 'lottie-react';
import { useEffect, useMemo, useState } from 'react';
import animationData from '@/public/assets/Loading_animation.json';
import { useTheme } from '@/components/theme/ThemeProvider';

type LottieColor = [number, number, number, number];

/**
 * Read the active theme's `--accent-primary` ("R G B" 0–255 triplet, see
 * app/theme-tokens.css) and normalise it into a Lottie fill colour [r,g,b,1].
 */
function readPrimaryColor(): LottieColor | null {
    if (typeof window === 'undefined') return null;
    const raw = getComputedStyle(document.documentElement)
        .getPropertyValue('--accent-primary')
        .trim();
    const parts = raw.split(/[\s,]+/).map(Number);
    if (parts.length < 3 || parts.some(Number.isNaN)) return null;
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255, 1];
}

/** Deep-clone the animation, repainting every solid fill with `color`. */
function recolor(data: unknown, color: LottieColor): unknown {
    const clone = JSON.parse(JSON.stringify(data));
    const walk = (node: any) => {
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        if (node && typeof node === 'object') {
            if (node.ty === 'fl' && node.c && Array.isArray(node.c.k)) {
                node.c.k = [...color];
            }
            Object.values(node).forEach(walk);
        }
    };
    walk(clone);
    return clone;
}

export default function CanvasLoader() {
    const { resolvedTheme } = useTheme();
    const [color, setColor] = useState<LottieColor | null>(null);

    // The CSS var resolves only after `data-theme` is on <html>, so read it in
    // an effect and re-read whenever the resolved theme changes.
    useEffect(() => {
        setColor(readPrimaryColor());
    }, [resolvedTheme]);

    const themed = useMemo(
        () => (color ? recolor(animationData, color) : animationData),
        [color]
    );

    return (
        <div className="w-full h-full flex items-center justify-center bg-surface-primary">
            <div className="w-40 h-40">
                {/* key forces a fresh Lottie instance when the palette swaps */}
                <Lottie key={resolvedTheme} animationData={themed} loop autoplay />
            </div>
        </div>
    );
}
