'use client';

import React, { useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAppStore } from '@/lib/store/app-store';
import { NumberInput } from '@/components/ui/NumberInput';
import { Slider } from '@/components/ui/Slider';
import { ThemePicker } from './ThemePicker';
import { SectionLabel, SettingRow, DisabledToggle } from './primitives';

export function PreferencesTab({ user, onProfileUpdated }: { user: any; onProfileUpdated: () => void }) {
    const baseline: number = (user?.profile?.preferences as any)?.maxAutoRunCredits ?? 10;
    const [maxAutoRun, setMaxAutoRun] = useState<number>(baseline);
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const persist = async (n: number) => {
        setSaveState('saving');
        try {
            const supabase = createClient();
            // Re-read the freshest preferences before merging: the theme picker
            // persists `theme` independently, so a stale in-memory snapshot would
            // clobber a theme the user just changed in this same session.
            const { data: row } = await supabase
                .from('profiles')
                .select('preferences, avatar_url')
                .eq('id', user.id)
                .maybeSingle();
            const newPrefs = {
                ...(row?.preferences || user?.profile?.preferences || {}),
                maxAutoRunCredits: n,
            };
            const { error } = await supabase.from('profiles').upsert({
                id: user.id,
                preferences: newPrefs,
                avatar_url: row?.avatar_url ?? user?.profile?.avatar_url ?? null,
            });
            if (error) throw error;
            onProfileUpdated();
            setSaveState('saved');
            setTimeout(() => setSaveState('idle'), 1600);
        } catch (e) {
            console.error('Failed to save preferences:', e);
            setSaveState('idle');
        }
    };

    // Update the live store immediately (so chat auto-run honours it at once),
    // then debounce the DB write so dragging the slider doesn't spam upserts.
    const handleChange = (n: number) => {
        setMaxAutoRun(n);
        useAppStore.getState().setMaxAutoRunCredits(n);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => persist(n), 600);
    };

    return (
        <div className="space-y-10">
            {/* Appearance */}
            <section className="space-y-5">
                <SectionLabel>Appearance</SectionLabel>
                <div>
                    <p className="text-sm text-content-secondary mb-4">
                        Pick a theme — it applies instantly across the app.
                    </p>
                    <ThemePicker />
                </div>
            </section>

            {/* Editor */}
            <section className="space-y-5">
                <SectionLabel>Editor</SectionLabel>
                <SettingRow
                    title="Auto-save"
                    description="Automatically save your workflow changes."
                    soon
                    disabled
                >
                    <DisabledToggle />
                </SettingRow>
            </section>

            {/* Automation */}
            <section className="space-y-5">
                <SectionLabel>Automation</SectionLabel>
                <SettingRow
                    title="Max auto-run credits"
                    description="Chat runs costing up to this many credits start automatically. Above it, a Run button appears."
                    layout="stacked"
                >
                    <div className="flex items-center gap-3 max-w-md">
                        <Slider
                            value={Math.min(maxAutoRun, 100)}
                            min={0}
                            max={100}
                            step={1}
                            onChange={handleChange}
                            ariaLabel="Max auto-run credits"
                            className="flex-1"
                        />
                        <NumberInput
                            min={0}
                            step={1}
                            value={maxAutoRun}
                            onChange={(e) =>
                                handleChange(Math.max(0, Math.min(10000, Math.trunc(Number(e.target.value) || 0))))
                            }
                            className="w-20"
                        />
                        <span
                            className={`text-[11px] font-medium w-12 transition-opacity ${
                                saveState === 'idle' ? 'opacity-0' : 'opacity-100'
                            } ${saveState === 'saved' ? 'text-accent-success' : 'text-content-tertiary'}`}
                        >
                            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : ''}
                        </span>
                    </div>
                </SettingRow>
            </section>
        </div>
    );
}
