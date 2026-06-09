'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Mic, ChevronDown, Play, Pause, Maximize2, User, Tag } from 'lucide-react';
import { VoicePickerModal, VoiceRecord } from '@/components/editor/VoicePickerModal';
import { FlagIcon } from '@/components/editor/FlagIcon';
import { languageFlag } from '@/lib/voices/language-flags';

interface VoicePickerControlProps {
  label: string;
  value: any;                 // the stored external_voice_id
  onChange: (val: string) => void;
}

function voiceLanguages(voice: VoiceRecord | null) {
  if (!voice) return [];
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

/**
 * Renders the SELECTED voice as a rich card (name, description, tags, flag row,
 * one-click preview) and opens the VoicePickerModal to change it. Stores only the
 * external_voice_id in control_values; the full record is resolved by querying
 * /api/voices/list?external_id=... so nothing extra leaks into the API payload.
 */
export function VoicePickerControl({ label, value, onChange }: VoicePickerControlProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<VoiceRecord | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Resolve the selected voice's full record from its stored id.
  useEffect(() => {
    let cancelled = false;
    if (!value) { setSelected(null); return; }
    if (selected?.external_voice_id === value) return;
    fetch(`/api/voices/list?external_id=${encodeURIComponent(String(value))}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setSelected((data.voices && data.voices[0]) || null); })
      .catch(() => { /* leave unresolved; card shows the id */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Release audio on unmount.
  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null; }, []);

  const togglePreview = () => {
    const url = selected?.preview_url;
    if (!url) return;
    if (!audioRef.current) audioRef.current = new Audio();
    const el = audioRef.current;
    if (playing) { el.pause(); setPlaying(false); return; }
    el.src = url;
    el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    el.onended = () => setPlaying(false);
  };

  const minimalLabelClass = 'text-[8px] font-bold text-content-tertiary uppercase tracking-[0.1em] pl-0.5 leading-none opacity-80';

  const langs = voiceLanguages(selected);
  const shownLangs = langs.slice(0, 3);
  const extraLangs = langs.length - shownLangs.length;
  const tags = selected
    ? ([
        selected.use_case ? { icon: Tag, text: selected.use_case } : null,
        selected.gender ? { icon: User, text: selected.gender } : null,
        selected.age ? { icon: User, text: selected.age } : null,
      ].filter(Boolean) as { icon: typeof Tag; text: string }[])
    : [];

  return (
    <div className="space-y-1">
      <label className={minimalLabelClass}>{label}</label>

      {selected || value ? (
        <div
          onClick={() => setOpen(true)}
          className="relative rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] hover:border-white/20 p-2.5 cursor-pointer space-y-2 transition-colors"
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-content-primary truncate leading-tight">
                {selected?.name || String(value)}
              </p>
              {selected?.description && (
                <p className="text-[10px] text-content-tertiary/80 leading-snug line-clamp-2 mt-1">{selected.description}</p>
              )}
            </div>
            {selected?.preview_url && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); togglePreview(); }}
                className="w-6 h-6 rounded-full bg-accent-primary/15 text-accent-primary flex items-center justify-center shrink-0 hover:bg-accent-primary/25 transition-colors"
                title={playing ? 'Stop' : 'Preview'}
              >
                {playing ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current ml-0.5" />}
              </button>
            )}
          </div>

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

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 min-w-0">
              {shownLangs.map((l) => (
                <FlagIcon key={l.code} country={l.country} code={l.code} title={l.label} className="w-4 h-4" />
              ))}
              {langs[0] && (
                <span className="text-[10px] font-semibold text-content-secondary truncate ml-0.5">{langs[0].label}</span>
              )}
              {extraLangs > 0 && (
                <span className="text-[10px] font-semibold text-content-tertiary">+{extraLangs}</span>
              )}
            </div>
            <Maximize2 className="w-3 h-3 text-content-tertiary shrink-0" />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full flex items-center justify-between gap-2 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-content-primary text-xs hover:bg-white/[0.08] transition-colors"
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <Mic className="w-3 h-3 text-accent-primary shrink-0" />
            <span className="truncate">Choose a voice…</span>
          </span>
          <ChevronDown className="w-3 h-3 text-content-tertiary shrink-0" />
        </button>
      )}

      <VoicePickerModal
        open={open}
        onClose={() => setOpen(false)}
        selectedExternalId={value ? String(value) : undefined}
        onSelect={(voice) => {
          setSelected(voice);
          onChange(voice.external_voice_id);
          setOpen(false);
        }}
      />
    </div>
  );
}
