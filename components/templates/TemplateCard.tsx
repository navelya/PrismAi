// components/templates/TemplateCard.tsx
'use client';
import React from 'react';
import { Sparkles, Users } from 'lucide-react';

export interface TemplateListItem {
  id: string; name: string; description: string | null; thumbnail_url: string | null;
  category: string | null; tags: string[]; source: 'official' | 'community';
  created_by_name: string | null; usage_count: number;
}

export function TemplateCard({ tpl, onOpen }: { tpl: TemplateListItem; onOpen: () => void }) {
  return (
    <button onClick={onOpen}
      className="group text-left bg-surface-secondary border border-stroke-subtle rounded-2xl overflow-hidden hover:border-accent-primary/40 hover:shadow-lg transition-all">
      <div className="aspect-[4/3] bg-surface-tertiary overflow-hidden">
        {tpl.thumbnail_url
          ? <img src={tpl.thumbnail_url} alt={tpl.name} className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300" />
          : <div className="w-full h-full flex items-center justify-center text-content-tertiary"><Sparkles className="w-6 h-6" /></div>}
      </div>
      <div className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-sm text-content-primary truncate">{tpl.name}</h3>
          {tpl.category && <span className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full bg-surface-tertiary text-content-tertiary">{tpl.category}</span>}
        </div>
        {tpl.description && <p className="text-xs text-content-secondary line-clamp-2">{tpl.description}</p>}
        <div className="flex items-center justify-between pt-1">
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-accent-primary">
            <Sparkles className="w-3 h-3" /> {tpl.source === 'official' ? 'Official' : tpl.created_by_name}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-content-tertiary"><Users className="w-3 h-3" />{tpl.usage_count}</span>
        </div>
      </div>
    </button>
  );
}
