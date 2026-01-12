'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextType {
    /** User's selected theme preference */
    theme: Theme;
    /** Actual applied theme (resolves 'system' to light/dark) */
    resolvedTheme: ResolvedTheme;
    /** Update theme preference */
    setTheme: (theme: Theme) => void;
    /** Check if dark mode is active */
    isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = 'prism-theme';

function getSystemTheme(): ResolvedTheme {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme: Theme): ResolvedTheme {
    return theme === 'system' ? getSystemTheme() : theme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setThemeState] = useState<Theme>('system');
    const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');
    const [mounted, setMounted] = useState(false);

    // Load saved theme preference on mount
    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
        if (saved && ['light', 'dark', 'system'].includes(saved)) {
            setThemeState(saved);
        }
        setMounted(true);
    }, []);

    // Apply theme to document and listen for system changes
    useEffect(() => {
        if (!mounted) return;

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        const updateTheme = () => {
            const resolved = resolveTheme(theme);
            setResolvedTheme(resolved);
            document.documentElement.setAttribute('data-theme', resolved);
        };

        updateTheme();

        // Only listen for system changes if theme is 'system'
        if (theme === 'system') {
            mediaQuery.addEventListener('change', updateTheme);
            return () => mediaQuery.removeEventListener('change', updateTheme);
        }
    }, [theme, mounted]);

    const setTheme = useCallback((newTheme: Theme) => {
        setThemeState(newTheme);
        localStorage.setItem(STORAGE_KEY, newTheme);
    }, []);

    const value: ThemeContextType = {
        theme,
        resolvedTheme,
        setTheme,
        isDark: resolvedTheme === 'dark',
    };

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    );
}

/**
 * Hook to access theme context
 * @throws Error if used outside ThemeProvider
 */
export function useTheme(): ThemeContextType {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}

/**
 * Hook that returns CSS variable value based on current theme
 * Useful for JS-based rendering (canvas, charts, etc.)
 */
export function useThemeValue(lightValue: string, darkValue: string): string {
    const { isDark } = useTheme();
    return isDark ? darkValue : lightValue;
}
