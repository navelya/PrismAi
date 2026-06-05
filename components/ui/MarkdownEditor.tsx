'use client';

import React, { useRef, useState } from 'react';
import { Bold, Italic, Heading2, List, ListOrdered, Link2, Eye, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarkdownView } from './MarkdownView';

interface Props {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}

/**
 * A lightweight markdown editor: a formatting toolbar (bold/italic/heading/lists/
 * link) over a textarea, plus a live Preview tab rendered with the same markdown
 * renderer used elsewhere. Produces markdown — richer than a plain textarea, with
 * no extra dependencies.
 */
export function MarkdownEditor({ label, value, onChange, placeholder, rows = 6 }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<'write' | 'preview'>('write');

  const wrap = (before: string, after = before) => {
    const el = ref.current;
    if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    const sel = value.slice(s, e);
    const next = value.slice(0, s) + before + sel + after + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = s + before.length;
      el.selectionEnd = s + before.length + sel.length;
    });
  };

  const linePrefix = (prefix: string) => {
    const el = ref.current;
    if (!el) return;
    const s = el.selectionStart;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = s + prefix.length;
    });
  };

  return (
    <div className="space-y-2 flex-1">
      {label && (
        <label className="text-[10px] font-bold text-content-tertiary uppercase tracking-[0.1em] pl-1 opacity-80 block">{label}</label>
      )}
      <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden focus-within:border-accent-primary/50 focus-within:ring-4 focus-within:ring-accent-primary/10 transition-all">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-1.5 py-1 border-b border-white/10">
          <div className="flex items-center gap-0.5">
            <ToolBtn title="Bold" onClick={() => wrap('**')}><Bold className="w-3.5 h-3.5" /></ToolBtn>
            <ToolBtn title="Italic" onClick={() => wrap('*')}><Italic className="w-3.5 h-3.5" /></ToolBtn>
            <ToolBtn title="Heading" onClick={() => linePrefix('## ')}><Heading2 className="w-3.5 h-3.5" /></ToolBtn>
            <ToolBtn title="Bullet list" onClick={() => linePrefix('- ')}><List className="w-3.5 h-3.5" /></ToolBtn>
            <ToolBtn title="Numbered list" onClick={() => linePrefix('1. ')}><ListOrdered className="w-3.5 h-3.5" /></ToolBtn>
            <ToolBtn title="Link" onClick={() => wrap('[', '](url)')}><Link2 className="w-3.5 h-3.5" /></ToolBtn>
          </div>
          <div className="flex items-center gap-0.5">
            <TabBtn active={tab === 'write'} onClick={() => setTab('write')}><Pencil className="w-3 h-3" /> Write</TabBtn>
            <TabBtn active={tab === 'preview'} onClick={() => setTab('preview')}><Eye className="w-3 h-3" /> Preview</TabBtn>
          </div>
        </div>

        {tab === 'write' ? (
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={rows}
            placeholder={placeholder}
            className="w-full bg-transparent px-3 py-2.5 text-sm text-content-primary placeholder:text-content-tertiary/40 focus:outline-none resize-y min-h-[130px]"
          />
        ) : (
          <div className="px-3 py-2.5 min-h-[130px]">
            {value.trim()
              ? <MarkdownView content={value} />
              : <span className="text-sm text-content-tertiary/40">Nothing to preview</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={title} onClick={onClick}
      className="p-1.5 rounded-md text-content-tertiary hover:text-content-primary hover:bg-white/10 transition-colors">
      {children}
    </button>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn(
        'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors',
        active ? 'bg-white/10 text-content-primary' : 'text-content-tertiary hover:text-content-secondary'
      )}>
      {children}
    </button>
  );
}
