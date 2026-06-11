'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, X, Check, User, Tag, Mic, Heart, Flame, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { languageFlag, KNOWN_LANGUAGES } from '@/lib/voices/language-flags';
import { FlagIcon } from '@/components/editor/FlagIcon';
import { cacheVoices } from '@/lib/voices/voice-cache';

export interface VoiceRecord {
  id: string;
  external_voice_id: string;
  name: string;
  description?: string | null;
  gender?: string | null;
  age?: string | null;
  accent?: string | null;
  language?: string | null;
  language_codes?: string[] | null;
  use_case?: string | null;
  category?: string | null;
  preview_url?: string | null;
  popularity?: number | null;
  featured?: boolean | null;
}

type Tab = 'popular' | 'all' | 'favorites';

interface VoicePickerModalProps {
  open: boolean;
  onClose: () => void;
  selectedExternalId?: string;
  onSelect: (voice: VoiceRecord) => void;
}

const CATEGORY_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'premade', label: 'Premade' },
  { value: 'professional', label: 'Professional' },
  { value: 'cloned', label: 'Cloned' },
  { value: 'shared', label: 'Community' },
];

const GENDER_OPTIONS = [
  { id: 'any', display_name: 'Any gender' },
  { id: 'female', display_name: 'Female' },
  { id: 'male', display_name: 'Male' },
  { id: 'neutral', display_name: 'Neutral' },
];

const AGE_OPTIONS = [
  { id: 'any', display_name: 'Any age' },
  { id: 'young', display_name: 'Young' },
  { id: 'middle_aged', display_name: 'Middle-aged' },
  { id: 'old', display_name: 'Old' },
];

// De-duplicate the language dropdown by display label (fil/tl, no/nb collapse),
// each option carrying its image flag.
const LANGUAGE_OPTIONS = (() => {
  const seen = new Set<string>();
  const opts = [{ id: 'all', display_name: 'All languages' } as any];
  for (const l of KNOWN_LANGUAGES) {
    if (seen.has(l.label)) continue;
    seen.add(l.label);
    opts.push({
      id: l.code,
      display_name: l.label,
      icon: <FlagIcon country={l.country} code={l.code} title={l.label} className="w-full h-full rounded-none" />,
    });
  }
  return opts;
})();

function voiceLanguages(voice: VoiceRecord) {
  const seen = new Set<string>();
  const out: { code: string; country: string; label: string }[] = [];
  for (const raw of voice.language_codes || []) {
    const lf = languageFlag(raw);
    if (seen.has(lf.code)) continue;
    seen.add(lf.code);
    out.push({ code: lf.code, country: lf.country, label: lf.label });
  }
  return out;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

// Module-level caches so reopening the picker (or switching tabs back) within a
// session is instant — no refetch, no skeleton flash.
interface CacheEntry { voices: VoiceRecord[]; page: number; hasMore: boolean; }
const sessionCache = new Map<string, CacheEntry>();
let favoritesCache: Set<string> | null = null;

const PAGE_SIZE = 60;

export function VoicePickerModal({ open, onClose, selectedExternalId, onSelect }: VoicePickerModalProps) {
  const [tab, setTab] = useState<Tab>('popular');
  const [voices, setVoices] = useState<VoiceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [gender, setGender] = useState('');
  const [age, setAge] = useState('');
  const [language, setLanguage] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(() => favoritesCache ?? new Set());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Favorites tab ignores the search/filter controls (favorite lists are small).
  const isFav = tab === 'favorites';
  const cacheKey = isFav ? 'favorites' : `${tab}|${q}|${category}|${gender}|${age}|${language}`;

  // Keep the latest paging flags reachable from the (stable) scroll observer.
  const stateRef = useRef({ hasMore, loading, page, tab });
  stateRef.current = { hasMore, loading, page, tab };

  const fetchPage = useCallback(async (reset: boolean, explicitPage: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (isFav) {
        params.set('favorites', '1');
      } else {
        if (q) params.set('q', q);
        if (category) params.set('category', category);
        if (gender) params.set('gender', gender);
        if (age) params.set('age', age);
        if (language) params.set('language', language);
        if (tab === 'popular') params.set('sort', 'popular');
        params.set('page', String(explicitPage));
        params.set('page_size', String(PAGE_SIZE));
      }
      const res = await fetch(`/api/voices/list?${params.toString()}`);
      const data = await res.json();
      const next: VoiceRecord[] = data.voices || [];
      cacheVoices(next);
      const merged = await new Promise<VoiceRecord[]>((resolve) => {
        setVoices((prev) => {
          const result = reset
            ? next
            : (() => {
                const seen = new Set(prev.map((v) => v.id));
                return [...prev, ...next.filter((v) => !seen.has(v.id))];
              })();
          resolve(result);
          return result;
        });
      });
      const more = isFav ? false : !!data.hasMore;
      setHasMore(more);
      sessionCache.set(cacheKey, { voices: merged, page: explicitPage, hasMore: more });
    } finally {
      setLoading(false);
    }
  }, [isFav, q, category, gender, age, language, tab, cacheKey]);

  // Load favorites once per session when the modal first opens.
  useEffect(() => {
    if (!open || favoritesCache) return;
    fetch('/api/voices/favorites')
      .then((r) => r.json())
      .then((data) => {
        favoritesCache = new Set<string>(data.external_ids || []);
        setFavorites(new Set(favoritesCache));
      })
      .catch(() => { favoritesCache = new Set(); });
  }, [open]);

  // Load the active tab/filter view. Serve from the session cache instantly when
  // present; otherwise fetch page 0 (debounced so typing isn't chatty).
  useEffect(() => {
    if (!open) return;
    const cached = sessionCache.get(cacheKey);
    if (cached) {
      setVoices(cached.voices);
      setPage(cached.page);
      setHasMore(cached.hasMore);
      return;
    }
    setVoices([]);
    setPage(0);
    setHasMore(false);
    const t = setTimeout(() => fetchPage(true, 0), q ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cacheKey]);

  // Stop audio when the modal closes.
  useEffect(() => {
    if (!open && audioRef.current) {
      audioRef.current.pause();
      setPlayingId(null);
    }
  }, [open]);

  // Pause + release the audio element on unmount so playback never leaks.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const loadMore = useCallback(() => {
    const s = stateRef.current;
    if (!s.hasMore || s.loading || s.tab === 'favorites') return;
    const nextPage = s.page + 1;
    setPage(nextPage);
    fetchPage(false, nextPage);
  }, [fetchPage]);

  // Infinite scroll: load the next page as the sentinel nears the viewport bottom.
  useEffect(() => {
    if (!open) return;
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore(); },
      { root, rootMargin: '250px' }
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [open, loadMore]);

  const togglePreview = (voice: VoiceRecord) => {
    if (!voice.preview_url) return;
    if (!audioRef.current) audioRef.current = new Audio();
    const el = audioRef.current;
    if (playingId === voice.external_voice_id) {
      el.pause();
      setPlayingId(null);
      return;
    }
    el.src = voice.preview_url;
    el.play().then(() => setPlayingId(voice.external_voice_id)).catch(() => setPlayingId(null));
    el.onended = () => setPlayingId(null);
  };

  const toggleFavorite = async (voice: VoiceRecord) => {
    const id = voice.external_voice_id;
    const wasFav = favorites.has(id);
    // Optimistic update of the shared set.
    const nextSet = new Set(favorites);
    if (wasFav) nextSet.delete(id); else nextSet.add(id);
    setFavorites(nextSet);
    favoritesCache = new Set(nextSet);
    // On the favorites tab, drop the card immediately when unfavoriting.
    if (isFav && wasFav) {
      setVoices((prev) => {
        const result = prev.filter((v) => v.external_voice_id !== id);
        sessionCache.set('favorites', { voices: result, page: 0, hasMore: false });
        return result;
      });
    } else {
      // A new favorite invalidates the cached favorites list so it refetches next open.
      sessionCache.delete('favorites');
    }
    try {
      if (wasFav) {
        await fetch(`/api/voices/favorites?external_id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      } else {
        await fetch('/api/voices/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ external_voice_id: id }),
        });
      }
    } catch {
      /* leave the optimistic state; a refresh will reconcile */
    }
  };

  const TABS: { id: Tab; label: string; icon: typeof Flame }[] = [
    { id: 'popular', label: 'Popular', icon: Flame },
    { id: 'all', label: 'All voices', icon: Mic },
    { id: 'favorites', label: 'Favorites', icon: Heart },
  ];

  const showSkeletons = loading && voices.length === 0;

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      size="full"
      contentClassName="max-w-4xl h-[85vh] flex flex-col overflow-hidden"
      showClose={false}
      srTitle="Find the right voice"
    >
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-stroke-subtle/70 space-y-4 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-accent-primary/15 flex items-center justify-center">
                <Mic className="w-4.5 h-4.5 text-accent-primary" />
              </div>
              <div>
                <h3 className="text-base font-black text-content-primary tracking-tight leading-none">Find the right voice</h3>
                <p className="text-[10px] text-content-tertiary mt-1">Click ▶ to hear any voice in one click · ♥ to save</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-content-tertiary transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/5 w-fit">
            {TABS.map((t) => {
              const active = tab === t.id;
              const count = t.id === 'favorites' ? favorites.size : 0;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                    active ? 'bg-accent-primary text-white shadow-sm' : 'text-content-tertiary hover:text-content-secondary hover:bg-white/5'
                  )}
                >
                  <t.icon className={cn('w-3.5 h-3.5', t.id === 'favorites' && (active || count > 0) && 'fill-current')} />
                  {t.label}
                  {t.id === 'favorites' && count > 0 && (
                    <span className={cn('text-[10px] tabular-nums', active ? 'text-white/80' : 'text-content-tertiary')}>{count}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Search + filters (hidden on the favorites tab) */}
          {!isFav && (
            <>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search voices by name…" />

              <div className="flex items-center gap-1 flex-wrap">
                {CATEGORY_FILTERS.map((c) => (
                  <button
                    key={c.value || 'all'}
                    onClick={() => setCategory(c.value)}
                    className={cn(
                      'px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors',
                      category === c.value ? 'bg-accent-primary text-white' : 'bg-white/5 text-content-tertiary hover:bg-white/10'
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Select
                  label="Language"
                  variant="minimal"
                  value={language || 'all'}
                  onChange={(e) => setLanguage(e.target.value === 'all' ? '' : e.target.value)}
                  options={LANGUAGE_OPTIONS}
                />
                <Select
                  label="Gender"
                  variant="minimal"
                  value={gender || 'any'}
                  onChange={(e) => setGender(e.target.value === 'any' ? '' : e.target.value)}
                  options={GENDER_OPTIONS}
                />
                <Select
                  label="Age"
                  variant="minimal"
                  value={age || 'any'}
                  onChange={(e) => setAge(e.target.value === 'any' ? '' : e.target.value)}
                  options={AGE_OPTIONS}
                />
              </div>
            </>
          )}
        </div>

        {/* Grid */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 content-start">
            {showSkeletons &&
              Array.from({ length: 9 }).map((_, i) => (
                <div key={`sk-${i}`} className="h-[132px] rounded-2xl border border-white/10 bg-white/[0.03] p-3 animate-pulse">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-white/10" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-2/3 rounded bg-white/10" />
                      <div className="h-2 w-1/3 rounded bg-white/5" />
                    </div>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    <div className="h-2 w-full rounded bg-white/5" />
                    <div className="h-2 w-4/5 rounded bg-white/5" />
                  </div>
                  <div className="mt-4 flex gap-1">
                    <div className="w-4 h-4 rounded-full bg-white/10" />
                    <div className="w-4 h-4 rounded-full bg-white/10" />
                    <div className="w-4 h-4 rounded-full bg-white/10" />
                  </div>
                </div>
              ))}

            {!showSkeletons &&
              voices.map((voice) => {
                const isSelected = voice.external_voice_id === selectedExternalId;
                const isPlaying = playingId === voice.external_voice_id;
                const isFavorited = favorites.has(voice.external_voice_id);
                const langs = voiceLanguages(voice);
                const shownLangs = langs.slice(0, 3);
                const extraLangs = langs.length - shownLangs.length;
                const pop = Number(voice.popularity || 0);
                const tags = [
                  voice.use_case ? { icon: Tag, text: voice.use_case } : null,
                  voice.gender ? { icon: User, text: voice.gender } : null,
                  voice.age ? { icon: User, text: voice.age } : null,
                ].filter(Boolean) as { icon: typeof User; text: string }[];
                return (
                  <div
                    key={voice.id}
                    onClick={() => onSelect(voice)}
                    className={cn(
                      'group relative flex flex-col gap-2 p-3 rounded-2xl border cursor-pointer transition-all',
                      isSelected
                        ? 'border-accent-primary bg-accent-primary/10 ring-1 ring-accent-primary/40'
                        : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/20'
                    )}
                  >
                    {isSelected && (
                      <div className="absolute -top-1.5 -left-1.5 z-10 w-5 h-5 rounded-full bg-accent-primary flex items-center justify-center ring-2 ring-surface-elevated">
                        <Check className="w-3 h-3 text-white" strokeWidth={3} />
                      </div>
                    )}

                    {/* Favorite heart — visible on hover, or always when favorited */}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(voice); }}
                      className={cn(
                        'absolute top-2 right-2 z-10 w-6 h-6 rounded-full flex items-center justify-center transition-all',
                        isFavorited
                          ? 'text-rose-400 opacity-100'
                          : 'text-content-tertiary opacity-0 group-hover:opacity-100 hover:text-rose-400 hover:bg-white/10'
                      )}
                      title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      <Heart className={cn('w-4 h-4', isFavorited && 'fill-current')} />
                    </button>

                    <div className="flex items-center gap-2.5 pr-6">
                      {/* Compact preview button — mirrors the properties-panel card */}
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePreview(voice); }}
                        disabled={!voice.preview_url}
                        className={cn(
                          'w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-colors',
                          voice.preview_url
                            ? 'bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25'
                            : 'bg-white/5 text-content-tertiary/40 cursor-not-allowed'
                        )}
                        title={voice.preview_url ? (isPlaying ? 'Stop' : 'Play preview') : 'No preview available'}
                      >
                        {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-content-primary truncate leading-tight">{voice.name}</p>
                        {voice.category && (
                          <span className="text-[9px] font-bold uppercase tracking-wider text-content-tertiary/70">{voice.category}</span>
                        )}
                      </div>
                    </div>

                    {/* Tags */}
                    {tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {tags.map((t, i) => (
                          <span key={i} className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md bg-white/8 text-content-secondary uppercase tracking-wide">
                            <t.icon className="w-2.5 h-2.5" />
                            {t.text}
                          </span>
                        ))}
                      </div>
                    )}

                    {voice.description && (
                      <p className="text-[11px] text-content-secondary/90 leading-snug line-clamp-2">{voice.description}</p>
                    )}

                    {/* Bottom row: overlapping language flags (left) + popularity (right) */}
                    <div className="mt-auto flex items-center justify-between gap-2 pt-0.5">
                      {shownLangs.length > 0 ? (
                        <div className="flex items-center">
                          {shownLangs.map((l) => (
                            <FlagIcon
                              key={l.code}
                              country={l.country}
                              code={l.code}
                              title={l.label}
                              className="w-5 h-5 -ml-1.5 first:ml-0 ring-2 ring-surface-elevated"
                            />
                          ))}
                          {extraLangs > 0 && (
                            <span className="ml-1 text-[10px] font-semibold text-content-tertiary">+{extraLangs}</span>
                          )}
                        </div>
                      ) : <span />}

                      {voice.featured ? (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-amber-400/15 text-amber-300">
                          <Star className="w-2.5 h-2.5 fill-current" />
                          Popular
                        </span>
                      ) : pop > 0 ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-content-tertiary" title={`Added by ${pop.toLocaleString()} users`}>
                          <Flame className="w-3 h-3 text-orange-400" />
                          {formatCount(pop)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}

            {/* Sentinel for infinite scroll (kept in the flow so the observer fires) */}
            <div ref={sentinelRef} className="col-span-full h-1" />

            {!showSkeletons && voices.length === 0 && (
              <div className="col-span-full text-center text-sm text-content-tertiary py-12">
                {isFav ? 'No favorites yet — tap the ♥ on any voice to save it here.' : 'No voices match these filters.'}
              </div>
            )}
          </div>

          {/* Inline loader while appending more pages */}
          {loading && voices.length > 0 && (
            <div className="py-4 text-center text-[11px] text-content-tertiary">Loading more…</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-stroke-subtle/70 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-content-tertiary">
            {loading && voices.length === 0 ? 'Loading…' : `${voices.length} voice${voices.length === 1 ? '' : 's'}${hasMore ? '+' : ''}`}
          </span>
        </div>
    </Modal>
  );
}
