'use client';

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { userApi } from '@/lib/api/client';
import { createClient } from '@/lib/supabase/client';
import { useAppStore } from '@/lib/store/app-store';

export type Theme = 'modern-light' | 'modern-dark' | 'oceanic-neon' | 'midnight-slate' | 'emerald-aurora' | 'sunset-vibe' | 'system' | 'light' | 'dark';
export type ResolvedTheme = 'modern-light' | 'modern-dark' | 'oceanic-neon' | 'midnight-slate' | 'emerald-aurora' | 'sunset-vibe';

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
    if (typeof window === 'undefined') return 'midnight-slate';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'modern-dark' : 'modern-light';
}

function resolveTheme(theme: Theme): ResolvedTheme {
    if (theme === 'system') return getSystemTheme();
    if (theme === 'light') return 'modern-light';
    if (theme === 'dark') return 'modern-dark';
    return theme as ResolvedTheme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isHomePage = pathname === '/';

    const [theme, setThemeState] = useState<Theme>('midnight-slate');
    const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('midnight-slate');
    const [mounted, setMounted] = useState(false);
    const [user, setUser] = useState<any>(null);

    // Initial load from localStorage (fastest)
    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
        if (saved) {
            setThemeState(saved);
        }
        setMounted(true);

        // Fetch user profile from DB to sync theme preference
        const syncProfile = async () => {
            try {
                const { user: userData } = await userApi.me();
                if (userData) {
                    setUser(userData);
                    const dbTheme = userData.profile?.preferences?.theme;
                    if (dbTheme) {
                        setThemeState(dbTheme);
                        localStorage.setItem(STORAGE_KEY, dbTheme);
                    }
                    const pref = (userData.profile?.preferences as any)?.maxAutoRunCredits;
                    useAppStore.getState().setMaxAutoRunCredits(
                        typeof pref === 'number' && pref >= 0 ? pref : 10
                    );
                    useAppStore.getState().setHasSeenAutoRunIntro(
                        (userData.profile?.preferences as any)?.seenAutoRunIntro === true
                    );
                    // Absent → enabled (default on); only an explicit `false` disables it.
                    useAppStore.getState().setAutoRunEnabled(
                        (userData.profile?.preferences as any)?.autoRunEnabled !== false
                    );
                }
            } catch (err) {
                // Not logged in or error
            }
        };
        syncProfile();
    }, []);

    // Apply theme to document
    useEffect(() => {
        if (!mounted) return;

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        const updateTheme = () => {
            // HOME PAGE OVERRIDE: Always use midnight-slate
            let resolved = resolveTheme(theme);
            if (isHomePage) {
                resolved = 'midnight-slate';
            }

            setResolvedTheme(resolved);
            document.documentElement.setAttribute('data-theme', resolved);

            // Legacy support for 'dark' class
            if (resolved.includes('dark') || resolved === 'oceanic-neon' || resolved === 'midnight-slate') {
                document.documentElement.classList.add('dark');
            } else {
                document.documentElement.classList.remove('dark');
            }
        };

        updateTheme();

        if (theme === 'system' && !isHomePage) {
            mediaQuery.addEventListener('change', updateTheme);
            return () => mediaQuery.removeEventListener('change', updateTheme);
        }
    }, [theme, mounted, isHomePage]);

    const setTheme = useCallback(async (newTheme: Theme) => {
        setThemeState(newTheme);
        localStorage.setItem(STORAGE_KEY, newTheme);

        // PERSIST TO DATABASE
        if (user?.id) {
            try {
                const supabase = createClient();
                // Re-read the freshest preferences before merging so we don't
                // clobber keys (e.g. maxAutoRunCredits) written elsewhere — the
                // account modal's Preferences tab persists those independently.
                const { data: row } = await supabase
                    .from('profiles')
                    .select('preferences')
                    .eq('id', user.id)
                    .maybeSingle();
                const newPrefs = {
                    ...(row?.preferences || user.profile?.preferences || {}),
                    theme: newTheme
                };

                await supabase.from('profiles').upsert({
                    id: user.id,
                    preferences: newPrefs,
                });
            } catch (err) {
                console.error('[ThemeProvider] Failed to persist theme to DB:', err);
            }
        }
    }, [user]);

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
