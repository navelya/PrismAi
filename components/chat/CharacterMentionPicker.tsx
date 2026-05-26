'use client';

import React from 'react';
import { UserCircle, Plus } from 'lucide-react';
import type { Character } from '@/lib/api/client';

interface CharacterMentionPickerProps {
    own: Character[];
    shared: Character[];
    query: string;
    activeIndex: number;
    onSelect: (c: Character) => void;
    onCreateNew: () => void;
}

const TOP_N = 5;

export function filterCharacters(characters: Character[], query: string): Character[] {
    const q = query.trim().toLowerCase();
    if (!q) return characters.slice(0, TOP_N); // already recency-ordered from the API
    return characters.filter((c) => c.name.toLowerCase().includes(q));
}

export interface MentionResults {
    /** Flat, ordered list (own first, then shared) — index maps directly to a
     *  character for keyboard navigation. */
    items: Character[];
    ownCount: number;
    sharedCount: number;
}

/**
 * Build the grouped @-mention results: the user's own characters first, then
 * shared-by-others. Shared entries whose id is already owned are dropped so a
 * character never appears twice. `items` is the concatenation used for keyboard
 * navigation; `ownCount`/`sharedCount` tell the picker where to draw the header.
 */
export function buildMentionResults(own: Character[], shared: Character[], query: string): MentionResults {
    const ownResults = filterCharacters(own, query);
    const ownIds = new Set(own.map((c) => c.id));
    const sharedResults = filterCharacters(shared.filter((c) => !ownIds.has(c.id)), query);
    return {
        items: [...ownResults, ...sharedResults],
        ownCount: ownResults.length,
        sharedCount: sharedResults.length,
    };
}

/**
 * Parse free text for `@<character name>` tokens and return the referenced
 * characters in order of first appearance (deduped). The mention lives inline
 * in the prompt text, so order/position carries meaning — this derives the
 * read-only roster and the ordered ids sent to the brain. Matching is
 * boundary-aware: `@` must start the string or follow whitespace, and the name
 * must not be immediately followed by another word char (so `@Alice` doesn't
 * match when only "Ali" is a character, and emails like `x@alice.com` are
 * ignored). Longer names win naturally because each character is matched on its
 * own full name.
 */
export function extractMentionedCharacters(text: string, characters: Character[]): Character[] {
    if (!text || characters.length === 0) return [];
    const lower = text.toLowerCase();
    const found: { c: Character; idx: number }[] = [];
    for (const c of characters) {
        const name = c.name?.trim();
        if (!name) continue;
        const token = ('@' + name).toLowerCase();
        let from = 0;
        while (true) {
            const idx = lower.indexOf(token, from);
            if (idx === -1) break;
            const before = idx === 0 ? '' : text[idx - 1];
            const afterPos = idx + token.length;
            const after = afterPos >= text.length ? '' : text[afterPos];
            const boundaryBefore = before === '' || /\s/.test(before);
            const boundaryAfter = after === '' || !/[A-Za-z0-9]/.test(after);
            if (boundaryBefore && boundaryAfter) {
                found.push({ c, idx });
                break;
            }
            from = idx + 1;
        }
    }
    found.sort((a, b) => a.idx - b.idx);
    const seen = new Set<string>();
    const ordered: Character[] = [];
    for (const { c } of found) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        ordered.push(c);
    }
    return ordered;
}

export default function CharacterMentionPicker({
    own,
    shared,
    query,
    activeIndex,
    onSelect,
    onCreateNew,
}: CharacterMentionPickerProps) {
    const { items, ownCount, sharedCount } = buildMentionResults(own, shared, query);

    const renderItem = (c: Character, i: number) => (
        <button
            key={c.id}
            type="button"
            onMouseDown={(e) => { e.preventDefault(); onSelect(c); }}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${
                i === activeIndex ? 'bg-accent-primary/10' : 'hover:bg-interactive-hover'
            }`}
        >
            <span className="w-8 h-8 rounded-md overflow-hidden bg-surface-tertiary flex-shrink-0 flex items-center justify-center">
                {c.thumbnail_url || c.reference_images?.[0]?.url ? (
                    <img src={c.thumbnail_url || c.reference_images[0].url} alt="" className="w-full h-full object-cover" />
                ) : (
                    <UserCircle className="w-5 h-5 text-content-tertiary" />
                )}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-content-primary truncate">{c.name}</span>
                {c.description && (
                    <span className="block text-xs text-content-tertiary truncate">{c.description}</span>
                )}
            </span>
        </button>
    );

    return (
        <div className="absolute bottom-full left-0 mb-2 w-72 max-h-72 overflow-y-auto rounded-xl border border-stroke-subtle bg-surface-primary shadow-2xl z-50 p-1">
            {items.length === 0 ? (
                <div className="px-3 py-3 text-sm text-content-tertiary">
                    No characters match "{query}"
                </div>
            ) : (
                <>
                    {/* Your characters — no header */}
                    {items.slice(0, ownCount).map((c, i) => renderItem(c, i))}

                    {/* Shared group — thin divider + small label, only when present */}
                    {sharedCount > 0 && (
                        <>
                            {ownCount > 0 && <div className="h-px bg-stroke-subtle my-1" />}
                            <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">
                                Shared characters
                            </div>
                            {items.slice(ownCount).map((c, i) => renderItem(c, ownCount + i))}
                        </>
                    )}
                </>
            )}
            <div className="h-px bg-stroke-subtle my-1" />
            <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onCreateNew(); }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-sm text-accent-primary hover:bg-interactive-hover"
            >
                <Plus className="w-4 h-4" /> Create new character
            </button>
        </div>
    );
}
