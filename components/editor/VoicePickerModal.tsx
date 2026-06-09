'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Play, Pause, X, Check, User, Globe, Tag, Mic } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { languageFlag, KNOWN_LANGUAGES } from '@/lib/voices/language-flags';
import { FlagIcon } from '@/components/editor/FlagIcon';

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

export function VoicePickerModal({ open, onClose, selectedExternalId, onSelect }: VoicePickerModalProps) {
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
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fetchVoices = useCallback(async (reset: boolean, explicitPage?: number) => {
    const targetPage = explicitPage ?? (reset ? 0 : page);
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (category) params.set('category', category);
      if (gender) params.set('gender', gender);
      if (age) params.set('age', age);
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
  }, [q, category, gender, age, language, page]);

  // Reset + refetch when any filter changes (debounced so typing isn't chatty).
  useEffect(() => {
    if (!open) return;
    setPage(0);
    const t = setTimeout(() => fetchVoices(true), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, category, gender, age, language, open]);

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
        <div className="px-5 pt-5 pb-4 border-b border-stroke-subtle/70 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-accent-primary/15 flex items-center justify-center">
                <Mic className="w-4.5 h-4.5 text-accent-primary" />
              </div>
              <div>
                <h3 className="text-base font-black text-content-primary tracking-tight leading-none">Find the right voice</h3>
                <p className="text-[10px] text-content-tertiary mt-1">Click ▶ to hear any voice in one click</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-content-tertiary transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Search (custom Input) */}
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search voices by name…"
          />

          {/* Category chips */}
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

          {/* Dropdown filters (custom Select) */}
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
                  <div className="min-w-0 flex-1 pr-5">
                    <p className="text-sm font-bold text-content-primary truncate leading-tight">{voice.name}</p>
                    {voice.category && (
                      <span className="text-[9px] font-bold uppercase tracking-wider text-content-tertiary/70">{voice.category}</span>
                    )}
                  </div>
                </div>

                {/* Language flags (images) */}
                {shownLangs.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    {shownLangs.map((l) => (
                      <FlagIcon key={l.code} country={l.country} code={l.code} title={l.label} className="w-4 h-4" />
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
