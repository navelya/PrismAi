// components/templates/TemplateCard.tsx
'use client';
import React from 'react';
import { ImageIcon, Flame, Sparkles } from 'lucide-react';

export interface TemplateListItem {
  id: string; name: string; description: string | null; thumbnail_url: string | null;
  category: string | null; tags: string[]; source: 'official' | 'community';
  created_by_name: string | null; usage_count: number; created_at: string;
  /** Top-10 most-cloned in the last two weeks (server-computed). */
  is_popular?: boolean;
}

/** Created within the last month. */
export function isNewTemplate(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() < 30 * 24 * 60 * 60 * 1000;
}

export function TemplateCard({ tpl, onOpen }: { tpl: TemplateListItem; onOpen: () => void }) {
  const popular = !!tpl.is_popular;
  const isNew = isNewTemplate(tpl.created_at);

  return (
    <button onClick={onOpen}
      className="group relative text-left bg-surface-secondary/70 border border-stroke-subtle/70 rounded-2xl overflow-hidden hover:border-accent-primary/40 hover:shadow-xl hover:shadow-black/5 transition-all duration-200">
      {(popular || isNew) && (
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
          {popular && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full bg-accent-primary text-white shadow-sm">
              <Flame className="w-2.5 h-2.5" /> Popular
            </span>
          )}
          {isNew && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full bg-surface-elevated/90 backdrop-blur-sm border border-stroke-subtle/60 text-content-primary shadow-sm">
              <Sparkles className="w-2.5 h-2.5" /> New
            </span>
          )}
        </div>
      )}
      <div className="aspect-[4/3] bg-surface-tertiary overflow-hidden">
        {tpl.thumbnail_url
          ? <img src={tpl.thumbnail_url} alt={tpl.name} className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300" />
          : <div className="w-full h-full flex items-center justify-center text-content-tertiary/50"><ImageIcon className="w-6 h-6" /></div>}
      </div>
      <div className="p-4 space-y-1.5">
        <h3 className="font-semibold text-sm text-content-primary truncate">{tpl.name}</h3>
        {tpl.description && <p className="text-xs text-content-secondary line-clamp-2 leading-relaxed">{tpl.description}</p>}
      </div>
    </button>
  );
}
