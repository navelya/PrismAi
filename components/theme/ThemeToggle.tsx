'use client';

import { useTheme, Theme } from './ThemeProvider';
import { Sun, Moon, Monitor } from 'lucide-react';

interface ThemeToggleProps {
    /** Show labels next to icons */
    showLabels?: boolean;
    /** Compact mode - single button that cycles through themes */
    compact?: boolean;
    /** Additional className */
    className?: string;
}

const themes: { value: Theme; icon: typeof Sun; label: string }[] = [
    { value: 'light', icon: Sun, label: 'Light' },
    { value: 'dark', icon: Moon, label: 'Dark' },
    { value: 'system', icon: Monitor, label: 'System' },
];

export function ThemeToggle({ showLabels = false, compact = false, className = '' }: ThemeToggleProps) {
    const { theme, setTheme, resolvedTheme } = useTheme();

    if (compact) {
        // Single button that cycles: light → dark → system → light
        const currentIndex = themes.findIndex(t => t.value === theme);
        const nextIndex = (currentIndex + 1) % themes.length;
        const CurrentIcon = themes[currentIndex].icon;

        return (
            <button
                onClick={() => setTheme(themes[nextIndex].value)}
                className={`p-2 rounded-lg transition-colors
                   bg-surface-tertiary hover:bg-interactive-hover
                   text-content-primary ${className}`}
                title={`Theme: ${themes[currentIndex].label} (click to change)`}
                aria-label={`Current theme: ${themes[currentIndex].label}. Click to switch to ${themes[nextIndex].label}`}
            >
                <CurrentIcon className="w-5 h-5" />
            </button>
        );
    }

    // Segmented button group
    return (
        <div className={`flex rounded-lg p-1 bg-surface-tertiary ${className}`} role="radiogroup" aria-label="Theme selection">
            {themes.map(({ value, icon: Icon, label }) => {
                const isActive = theme === value;
                return (
                    <button
                        key={value}
                        onClick={() => setTheme(value)}
                        role="radio"
                        aria-checked={isActive}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all
                       ${isActive
                                ? 'bg-surface-elevated text-content-primary shadow-sm'
                                : 'text-content-secondary hover:text-content-primary'}`}
                    >
                        <Icon className="w-4 h-4" />
                        {showLabels && <span>{label}</span>}
                    </button>
                );
            })}
        </div>
    );
}

/**
 * Simple icon-only toggle for compact spaces (e.g., sidebar)
 */
export function ThemeIconToggle({ className = '' }: { className?: string }) {
    const { isDark, setTheme, theme } = useTheme();

    // Cycle through themes on click
    const cycleTheme = () => {
        const order: Theme[] = ['light', 'dark', 'system'];
        const currentIndex = order.indexOf(theme);
        const nextIndex = (currentIndex + 1) % order.length;
        setTheme(order[nextIndex]);
    };

    const Icon = isDark ? Moon : Sun;
    const isSystem = theme === 'system';

    return (
        <button
            onClick={cycleTheme}
            className={`relative p-2 rounded-lg transition-colors
                 hover:bg-interactive-hover text-content-secondary hover:text-content-primary ${className}`}
            title={`Theme: ${theme.charAt(0).toUpperCase() + theme.slice(1)}`}
            aria-label={`Toggle theme (currently ${theme})`}
        >
            <Icon className="w-5 h-5" />
            {isSystem && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent-primary"
                    title="Following system preference" />
            )}
        </button>
    );
}
