'use client';

import React, { useEffect, useState } from 'react';
import { Mic, ChevronDown } from 'lucide-react';
import { VoicePickerModal, VoiceRecord } from '@/components/editor/VoicePickerModal';

interface VoicePickerControlProps {
  label: string;
  value: any;                 // the stored external_voice_id
  onChange: (val: string) => void;
}

/**
 * Renders a button showing the selected voice's name and opens the
 * VoicePickerModal. Stores only the external_voice_id in control_values; the
 * display name is resolved by querying /api/voices/list?external_id=... so no
 * extra fields leak into the API payload.
 */
export function VoicePickerControl({ label, value, onChange }: VoicePickerControlProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<VoiceRecord | null>(null);

  // Resolve the selected voice's display name from its stored id.
  useEffect(() => {
    let cancelled = false;
    if (!value) { setSelected(null); return; }
    if (selected?.external_voice_id === value) return;
    fetch(`/api/voices/list?external_id=${encodeURIComponent(String(value))}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setSelected((data.voices && data.voices[0]) || null); })
      .catch(() => { /* leave name unresolved; button shows the id */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const minimalLabelClass = 'text-[8px] font-bold text-content-tertiary uppercase tracking-[0.1em] pl-0.5 leading-none opacity-80';

  return (
    <div className="space-y-1">
      <label className={minimalLabelClass}>{label}</label>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-between gap-2 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-content-primary text-xs hover:bg-white/[0.08] transition-colors"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <Mic className="w-3 h-3 text-accent-primary shrink-0" />
          <span className="truncate">{selected?.name || (value ? String(value) : 'Choose a voice…')}</span>
        </span>
        <ChevronDown className="w-3 h-3 text-content-tertiary shrink-0" />
      </button>
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
