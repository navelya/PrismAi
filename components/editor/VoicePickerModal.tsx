'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, Play, Pause, X, Check, User, Globe, Tag, Mic } from 'lucide-react';
import { cn } from '@/lib/utils';
import { languageFlag, KNOWN_LANGUAGES } from '@/lib/voices/language-flags';

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
}

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

const GENDER_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Any' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
];

// De-duplicate the language dropdown by display label (fil/tl, no/nb collapse).
const LANGUAGE_OPTIONS = (() => {
  const seen = new Set<string>();
  return KNOWN_LANGUAGES.filter((l) => {
    if (seen.has(l.label)) return false;
    seen.add(l.label);
    return true;
  });
})();

function voiceLanguages(voice: VoiceRecord) {
  const seen = new Set<string>();
  const out: { code: string; flag: string; label: string }[] = [];
  for (const raw of voice.language_codes || []) {
    const lf = languageFlag(raw);
    if (seen.has(lf.code)) continue;
    seen.add(lf.code);
    out.push(lf);
  }
  return out;
}

export function VoicePickerModal({ open, onClose, selectedExternalId, onSelect }: VoicePickerModalProps) {
  const [voices, setVoices] = useState<VoiceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [gender, setGender] = useState('');
  const [language, setLanguage] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fetchVoices = useCallback(async (reset: boolean, explicitPage?: number) => {
    const targetPage = explicitPage ?? (reset ? 0 : page);
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (category) params.set('category', category);
      if (gender) params.set('gender', gender);
      if (language) params.set('language', language);
      params.set('page', String(targetPage));
      params.set('page_size', '60');
      const res = await fetch(`/api/voices/list?${params.toString()}`);
      const data = await res.json();
      const next: VoiceRecord[] = data.voices || [];
      setVoices((prev) => {
        if (reset) return next;
        const seen = new Set(prev.map((v) => v.id));
        return [...prev, ...next.filter((v) => !seen.has(v.id))];
      });
      setHasMore(!!data.hasMore);
    } finally {
      setLoading(false);
    }
  }, [q, category, gender, language, page]);

  // Reset + refetch when any filter changes (debounced so typing isn't chatty).
  useEffect(() => {
    if (!open) return;
    setPage(0);
    const t = setTimeout(() => fetchVoices(true), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, category, gender, language, open]);

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

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchVoices(false, nextPage);
  };

  // Render via a portal to <body> so the fixed overlay escapes the properties
  // panel's backdrop-filter ancestor (which would otherwise trap `position:fixed`).
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[85vh] flex flex-col bg-surface-elevated border border-stroke-subtle rounded-3xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-stroke-subtle/70">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-accent-primary/15 flex items-center justify-center">
                <Mic className="w-4 h-4 text-accent-primary" />
              </div>
              <div>
                <h3 className="text-sm font-black text-content-primary tracking-tight">Choose a voice</h3>
                <p className="text-[10px] text-content-tertiary">Click ▶ to hear any voice in one click</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-content-tertiary transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
            <Search className="w-4 h-4 text-content-tertiary shrink-0" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search voices by name…"
              className="flex-1 bg-transparent text-sm text-content-primary placeholder:text-content-tertiary/50 focus:outline-none"
            />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3">
            <div className="flex items-center gap-1">
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
            <div className="flex items-center gap-1">
              {GENDER_FILTERS.map((g) => (
                <button
                  key={g.value || 'any'}
                  onClick={() => setGender(g.value)}
                  className={cn(
                    'px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors',
                    gender === g.value ? 'bg-content-primary text-surface-primary' : 'bg-white/5 text-content-tertiary hover:bg-white/10'
                  )}
                >
                  {g.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 ml-auto">
              <Globe className="w-3.5 h-3.5 text-content-tertiary" />
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-lg text-xs text-content-primary px-2 py-1 focus:outline-none focus:border-accent-primary/50 cursor-pointer"
              >
                <option value="">All languages</option>
                {LANGUAGE_OPTIONS.map((l) => (
                  <option key={l.code} value={l.code}>{l.flag} {l.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 content-start">
          {voices.map((voice) => {
            const isSelected = voice.external_voice_id === selectedExternalId;
            const isPlaying = playingId === voice.external_voice_id;
            const langs = voiceLanguages(voice);
            const shownLangs = langs.slice(0, 8);
            const extraLangs = langs.length - shownLangs.length;
            const tags = [
              voice.gender ? { icon: User, text: voice.gender } : null,
              voice.accent ? { icon: Globe, text: voice.accent } : null,
              voice.use_case ? { icon: Tag, text: voice.use_case } : null,
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
                  <div className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-accent-primary flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}

                <div className="flex items-center gap-2.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); togglePreview(voice); }}
                    disabled={!voice.preview_url}
                    className={cn(
                      'w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all',
                      voice.preview_url
                        ? 'bg-accent-primary text-white hover:scale-105 active:scale-95 shadow-md shadow-accent-primary/30'
                        : 'bg-white/5 text-content-tertiary/40 cursor-not-allowed'
                    )}
                    title={voice.preview_url ? (isPlaying ? 'Stop' : 'Play preview') : 'No preview available'}
                  >
                    {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-content-primary truncate leading-tight">{voice.name}</p>
                    {voice.category && (
                      <span className="text-[9px] font-bold uppercase tracking-wider text-content-tertiary/70">{voice.category}</span>
                    )}
                  </div>
                </div>

                {/* Language flags */}
                {shownLangs.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    {shownLangs.map((l) => (
                      <span key={l.code} title={l.label} className="text-sm leading-none cursor-default">{l.flag}</span>
                    ))}
                    {extraLangs > 0 && (
                      <span className="text-[10px] font-semibold text-content-tertiary">+{extraLangs}</span>
                    )}
                  </div>
                )}

                {/* Tags */}
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {tags.map((t, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md bg-white/8 text-content-tertiary uppercase tracking-wide">
                        <t.icon className="w-2.5 h-2.5" />
                        {t.text}
                      </span>
                    ))}
                  </div>
                )}

                {voice.description && (
                  <p className="text-[11px] text-content-tertiary/80 leading-snug line-clamp-2">{voice.description}</p>
                )}
              </div>
            );
          })}
          {voices.length === 0 && !loading && (
            <div className="col-span-full text-center text-sm text-content-tertiary py-12">No voices match these filters.</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-stroke-subtle/70 flex items-center justify-between">
          <span className="text-[11px] text-content-tertiary">{loading ? 'Loading…' : `${voices.length} voices`}</span>
          {hasMore && (
            <button onClick={loadMore} className="px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-content-secondary transition-colors">
              Load more
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
