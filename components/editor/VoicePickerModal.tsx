'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Search, Play, Pause, X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface VoiceRecord {
  id: string;
  external_voice_id: string;
  name: string;
  description?: string | null;
  gender?: string | null;
  accent?: string | null;
  language?: string | null;
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

const CATEGORY_FILTERS = ['', 'premade', 'professional', 'shared', 'cloned'];

export function VoicePickerModal({ open, onClose, selectedExternalId, onSelect }: VoicePickerModalProps) {
  const [voices, setVoices] = useState<VoiceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fetchVoices = useCallback(async (reset: boolean, explicitPage?: number) => {
    // Take the page explicitly when appending so "Load more" never races a
    // not-yet-applied setPage (a stale closure would re-fetch page 0).
    const targetPage = explicitPage ?? (reset ? 0 : page);
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (category) params.set('category', category);
      params.set('page', String(targetPage));
      params.set('page_size', '60');
      const res = await fetch(`/api/voices/list?${params.toString()}`);
      const data = await res.json();
      const next: VoiceRecord[] = data.voices || [];
      setVoices((prev) => {
        if (reset) return next;
        // Dedupe by id when appending — a voice could recur across pages if the
        // catalog shifts between requests, which would collide React keys.
        const seen = new Set(prev.map((v) => v.id));
        return [...prev, ...next.filter((v) => !seen.has(v.id))];
      });
      setHasMore(!!data.hasMore);
    } finally {
      setLoading(false);
    }
  }, [q, category, page]);

  // Reset + refetch when the search/filter changes (debounced for text).
  useEffect(() => {
    if (!open) return;
    setPage(0);
    const t = setTimeout(() => fetchVoices(true), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, category, open]);

  // Stop audio when the modal closes.
  useEffect(() => {
    if (!open && audioRef.current) {
      audioRef.current.pause();
      setPlayingId(null);
    }
  }, [open]);

  // Pause + release the audio element if the modal unmounts while still open
  // (e.g. parent route change), so playback doesn't leak past the component.
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[80vh] flex flex-col bg-surface-elevated border border-stroke-subtle rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-stroke-subtle">
          <Search className="w-4 h-4 text-content-tertiary" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search voices…"
            className="flex-1 bg-transparent text-sm text-content-primary placeholder:text-content-tertiary/50 focus:outline-none"
          />
          <button onClick={onClose} className="p-1 rounded-md hover:bg-white/10 text-content-tertiary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-stroke-subtle/60 overflow-x-auto">
          {CATEGORY_FILTERS.map((c) => (
            <button
              key={c || 'all'}
              onClick={() => setCategory(c)}
              className={cn(
                'px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors',
                category === c ? 'bg-accent-primary text-white' : 'bg-white/5 text-content-tertiary hover:bg-white/10'
              )}
            >
              {c === '' ? 'All' : c}
            </button>
          ))}
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {voices.map((voice) => {
            const isSelected = voice.external_voice_id === selectedExternalId;
            const isPlaying = playingId === voice.external_voice_id;
            return (
              <div
                key={voice.id}
                className={cn(
                  'relative flex flex-col gap-1 p-2.5 rounded-xl border cursor-pointer transition-all',
                  isSelected ? 'border-accent-primary bg-accent-primary/10' : 'border-white/10 bg-white/5 hover:bg-white/[0.08]'
                )}
                onClick={() => onSelect(voice)}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-content-primary truncate">{voice.name}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-accent-primary shrink-0" />}
                </div>
                <div className="flex flex-wrap gap-1">
                  {[voice.gender, voice.accent, voice.use_case].filter(Boolean).map((tag) => (
                    <span key={String(tag)} className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-content-tertiary uppercase tracking-wide">
                      {tag}
                    </span>
                  ))}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); togglePreview(voice); }}
                  disabled={!voice.preview_url}
                  className={cn(
                    'mt-1 inline-flex items-center gap-1 self-start px-2 py-0.5 rounded-md text-[10px] font-semibold',
                    voice.preview_url ? 'bg-white/10 hover:bg-white/20 text-content-secondary' : 'opacity-30 cursor-not-allowed text-content-tertiary'
                  )}
                >
                  {isPlaying ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
                  {isPlaying ? 'Stop' : 'Preview'}
                </button>
              </div>
            );
          })}
          {voices.length === 0 && !loading && (
            <div className="col-span-full text-center text-xs text-content-tertiary py-8">No voices found.</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-stroke-subtle/60 flex items-center justify-between">
          <span className="text-[11px] text-content-tertiary">{loading ? 'Loading…' : `${voices.length} voices`}</span>
          {hasMore && (
            <button onClick={loadMore} className="px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-content-secondary">
              Load more
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
