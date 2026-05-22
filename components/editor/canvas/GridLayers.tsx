'use client';

import React, { useMemo } from 'react';
import { Background, BackgroundVariant, useViewport } from 'reactflow';

/**
 * 🚀 PERFORMANCE OPTIMIZATION:
 * We isolate the Background layers into their own component.
 * This ensures that when 'zoom' changes (at 60fps during animation),
 * ONLY these grid components re-render.
 *
 * They are React.memo'd so that a re-render of the parent canvas (e.g. the
 * per-tick setLocalNodes during a marquee box-selection) does NOT cascade
 * into re-rendering these full-viewport SVG dot patterns. They re-render
 * only when their own viewport subscription changes.
 */
function BaseGridLayersInner() {
    const { zoom } = useViewport();

    const activeLevel = useMemo(() => {
        if (zoom > 0.4) return 0;
        if (zoom > 0.15) return 1;
        return 2;
    }, [zoom]);

    return (
        <>
            <Background
                id="base-grid-0"
                variant={BackgroundVariant.Dots}
                gap={20}
                size={1.5}
                style={{
                    backgroundColor: 'rgb(var(--canvas-bg))',
                    opacity: activeLevel === 0 ? 0.5 : 0,
                    visibility: activeLevel === 0 ? 'visible' : 'hidden'
                }}
                color="rgba(var(--accent-primary))"
            />
            <Background
                id="base-grid-1"
                variant={BackgroundVariant.Dots}
                gap={80}
                size={5}
                style={{
                    opacity: activeLevel === 1 ? 0.5 : 0,
                    visibility: activeLevel === 1 ? 'visible' : 'hidden'
                }}
                color="rgba(var(--accent-primary))"
            />
            <Background
                id="base-grid-2"
                variant={BackgroundVariant.Dots}
                gap={320}
                size={14}
                style={{
                    opacity: activeLevel === 2 ? 0.5 : 0,
                    visibility: activeLevel === 2 ? 'visible' : 'hidden'
                }}
                color="rgba(var(--accent-primary))"
            />
        </>
    );
}

export const BaseGridLayers = React.memo(BaseGridLayersInner);

function SpotlightGridLayersInner({ isMouseActive }: { isMouseActive: boolean }) {
    const { zoom } = useViewport();

    const activeLevel = useMemo(() => {
        if (zoom > 0.4) return 0;
        if (zoom > 0.15) return 1;
        return 2;
    }, [zoom]);

    return (
        <div
            className="absolute inset-0 pointer-events-none z-0 transition-opacity duration-500"
            style={{
                maskImage: `radial-gradient(120px circle at var(--mouse-x) var(--mouse-y), black 0%, transparent 100%)`,
                WebkitMaskImage: `radial-gradient(120px circle at var(--mouse-x) var(--mouse-y), black 0%, transparent 100%)`,
                opacity: isMouseActive ? 1 : 0,
            }}
        >
            <Background
                id="spotlight-grid-0"
                variant={BackgroundVariant.Dots}
                gap={20}
                size={1.5}
                style={{
                    opacity: activeLevel === 0 ? 1 : 0,
                    visibility: activeLevel === 0 ? 'visible' : 'hidden'
                }}
                color="rgba(var(--accent-primary))"
            />
            <Background
                id="spotlight-grid-1"
                variant={BackgroundVariant.Dots}
                gap={80}
                size={6}
                style={{
                    opacity: activeLevel === 1 ? 1 : 0,
                    visibility: activeLevel === 1 ? 'visible' : 'hidden'
                }}
                color="rgba(var(--accent-primary))"
            />
            <Background
                id="spotlight-grid-2"
                variant={BackgroundVariant.Dots}
                gap={320}
                size={24}
                style={{
                    opacity: activeLevel === 2 ? 1 : 0,
                    visibility: activeLevel === 2 ? 'visible' : 'hidden'
                }}
                color="rgba(var(--accent-primary))"
            />
        </div>
    );
}

export const SpotlightGridLayers = React.memo(SpotlightGridLayersInner);
