'use client';

import React from 'react';
import { Check, Monitor } from 'lucide-react';
import { useTheme, type Theme } from '@/components/theme/ThemeProvider';

/**
 * A theme's display palette, mirroring the CSS tokens in app/theme-tokens.css.
 * Used only to paint the little preview "window" in the picker — the live theme
 * still comes from the data-theme attribute, not these values.
 */
interface Palette {
    bg: string;
    surface: string;
    accent: string;
    accent2: string;
    text: string;
    border: string;
}

interface ThemeDef {
    id: Theme;
    name: string;
    palette: Palette;
}

const THEMES: ThemeDef[] = [
    {
        id: 'modern-dark',
        name: 'Modern Dark',
        palette: { bg: '#09090b', surface: '#18181b', accent: '#6366f1', accent2: '#8b5cf6', text: '#fafafa', border: '#27272a' },
    },
    {
        id: 'modern-light',
        name: 'Modern Light',
        palette: { bg: '#fafafa', surface: '#ffffff', accent: '#4f46e5', accent2: '#7c3aed', text: '#18181b', border: '#e4e4e7' },
    },
    {
        id: 'midnight-slate',
        name: 'Midnight Slate',
        palette: { bg: '#020617', surface: '#0f172a', accent: '#38bdf8', accent2: '#818cf8', text: '#f1f5f9', border: '#1e293b' },
    },
    {
        id: 'emerald-aurora',
        name: 'Emerald Aurora',
        palette: { bg: '#020f0c', surface: '#06231c', accent: '#10b981', accent2: '#059669', text: '#ecfdf5', border: '#064e3b' },
    },
    {
        id: 'sunset-vibe',
        name: 'Sunset Vibe',
        palette: { bg: '#180a20', surface: '#371446', accent: '#fb923c', accent2: '#c026d3', text: '#fff5f0', border: '#501e64' },
    },
    {
        id: 'oceanic-neon',
        name: 'Oceanic Neon',
        palette: { bg: '#05070a', surface: '#0f172a', accent: '#06b6d4', accent2: '#14b8a6', text: '#f8fafc', border: '#1e293b' },
    },
];

/** Miniature editor-window preview painted from a theme's palette. */
function ThemePreview({ palette }: { palette: Palette }) {
    return (
        <div
            className="w-full h-[78px] rounded-lg overflow-hidden flex flex-col"
            style={{ background: palette.bg, boxShadow: `inset 0 0 0 1px ${palette.border}` }}
        >
            {/* Title bar with traffic-light dots */}
            <div
                className="h-4 flex items-center gap-1 px-2"
                style={{ background: palette.surface, borderBottom: `1px solid ${palette.border}` }}
            >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: palette.accent }} />
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: palette.accent2, opacity: 0.8 }} />
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: palette.text, opacity: 0.25 }} />
            </div>
            {/* Body: mini sidebar + content lines */}
            <div className="flex-1 flex gap-1.5 p-1.5">
                <div className="w-5 rounded-sm" style={{ background: palette.surface }} />
                <div className="flex-1 flex flex-col justify-center gap-1.5">
                    <div className="h-1.5 rounded-full" style={{ background: palette.accent, width: '55%' }} />
                    <div className="h-1.5 rounded-full" style={{ background: palette.text, opacity: 0.35, width: '85%' }} />
                    <div className="h-1.5 rounded-full" style={{ background: palette.text, opacity: 0.2, width: '70%' }} />
                </div>
            </div>
        </div>
    );
}

/** Split light/dark preview for the "System" option. */
function SystemPreview() {
    const light = THEMES.find((t) => t.id === 'modern-light')!.palette;
    const dark = THEMES.find((t) => t.id === 'modern-dark')!.palette;
    return (
        <div className="relative w-full h-[78px] rounded-lg overflow-hidden grid grid-cols-2">
            <div style={{ background: light.bg }} />
            <div style={{ background: dark.bg }} />
            <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-7 h-7 rounded-full bg-surface-primary/80 backdrop-blur flex items-center justify-center border border-stroke-subtle">
                    <Monitor className="w-3.5 h-3.5 text-content-secondary" />
                </div>
            </div>
        </div>
    );
}

interface ThemeCardProps {
    name: string;
    selected: boolean;
    onSelect: () => void;
    children: React.ReactNode;
}

function ThemeCard({ name, selected, onSelect, children }: ThemeCardProps) {
    return (
        <button
            onClick={onSelect}
            className={`group text-left rounded-xl p-2 transition-all ${
                selected
                    ? 'bg-accent-primary/5 ring-2 ring-accent-primary'
                    : 'ring-1 ring-stroke-subtle hover:ring-stroke-strong/60 hover:bg-white/[0.02]'
            }`}
        >
            {children}
            <div className="flex items-center justify-between mt-2 px-1">
                <span
                    className={`text-xs font-semibold ${selected ? 'text-content-primary' : 'text-content-secondary'}`}
                >
                    {name}
                </span>
                {selected ? (
                    <span className="w-4 h-4 rounded-full bg-accent-primary flex items-center justify-center">
                        <Check className="w-2.5 h-2.5 text-white" strokeWidth={4} />
                    </span>
                ) : (
                    <span className="w-4 h-4 rounded-full border border-stroke-subtle group-hover:border-stroke-strong/60" />
                )}
            </div>
        </button>
    );
}

/**
 * VS Code-style theme selector: a grid of palette previews that apply instantly
 * on click (no Save — `setTheme` persists to the DB and swaps `data-theme`).
 */
export function ThemePicker() {
    const { theme, setTheme } = useTheme();

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <ThemeCard name="System" selected={theme === 'system'} onSelect={() => setTheme('system')}>
                <SystemPreview />
            </ThemeCard>
            {THEMES.map((t) => (
                <ThemeCard
                    key={t.id}
                    name={t.name}
                    selected={theme === t.id}
                    onSelect={() => setTheme(t.id)}
                >
                    <ThemePreview palette={t.palette} />
                </ThemeCard>
            ))}
        </div>
    );
}
