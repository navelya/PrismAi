'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type Theme = 'modern-light' | 'modern-dark' | 'oceanic-neon' | 'midnight-slate' | 'system' | 'light' | 'dark';
export type ResolvedTheme = 'modern-light' | 'modern-dark' | 'oceanic-neon' | 'midnight-slate';

interface ThemeContextType {
    /** User's selected theme preference */
    theme: Theme;
    /** Actual applied theme (resolves 'system' or legacy 'light'/'dark') */
    resolvedTheme: ResolvedTheme;
    /** Update theme preference */
    setTheme: (theme: Theme) => void;
    /** Check if a dark-based theme is active */
    isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = 'prism-theme';

function getSystemTheme(): ResolvedTheme {
    if (typeof window === 'undefined') return 'modern-light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'modern-dark' : 'modern-light';
}

function resolveTheme(theme: Theme): ResolvedTheme {
    if (theme === 'system') return getSystemTheme();
    if (theme === 'light') return 'modern-light';
    if (theme === 'dark') return 'modern-dark';
    return theme as ResolvedTheme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setThemeState] = useState<Theme>('system');
    const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('modern-dark');
    const [mounted, setMounted] = useState(false);

    // Load saved theme preference on mount
    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
        if (saved) {
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

            // Legacy support for 'dark' class if needed by some external libs
            if (resolved.includes('dark') || resolved === 'oceanic-neon' || resolved === 'midnight-slate') {
                document.documentElement.classList.add('dark');
            } else {
                document.documentElement.classList.remove('dark');
            }
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
        isDark: resolvedTheme !== 'modern-light',
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
