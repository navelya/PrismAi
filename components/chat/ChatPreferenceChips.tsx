'use client';

import React from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '@/lib/store/app-store';
import { persistPrefs } from '@/lib/user/preferences';
import type { AiModel } from '@/lib/nodes/types';
import { resolvePreferenceChips } from '@/lib/chat/preferences';

/**
 * Removable pills for the user's non-Auto chat preferences, shown under the
 * textarea and above the action row. An isolated self-subscribing leaf (like
 * SelectionPillRow): it reads chatPreferences + models directly so a preference
 * change re-renders only this row, never the conversation. Returns null when
 * every preference is Auto.
 *
 * Each pill's X resets that preference to Auto (and re-persists), which also
 * removes the pill.
 */
export function ChatPreferenceChips() {
    const chatPreferences = useAppStore((s) => s.chatPreferences);
    const models = useAppStore((s) => s.models) as AiModel[];
    const setChatPreference = useAppStore((s) => s.setChatPreference);

    const chips = resolvePreferenceChips(chatPreferences, models);
    if (chips.length === 0) return null;

    const reset = (key: typeof chips[number]['key']) => {
        setChatPreference(key, 'auto');
        void persistPrefs({ chatPreferences: useAppStore.getState().chatPreferences });
    };

    return (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3">
            {chips.map((chip) => (
                <span
                    key={chip.key}
                    className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-accent-primary/10 border border-accent-primary/20 text-xs text-content-primary"
                >
                    <span className="truncate max-w-[160px]">{chip.label}</span>
                    <button
                        type="button"
                        onClick={() => reset(chip.key)}
                        aria-label={`Reset ${chip.label} to auto`}
                        className="shrink-0 w-4 h-4 inline-flex items-center justify-center rounded-full text-content-tertiary hover:text-content-primary hover:bg-white/10 transition-colors"
                    >
                        <X className="w-3 h-3" />
                    </button>
                </span>
            ))}
        </div>
    );
}
