// components/templates/TemplateCard.tsx
'use client';
import React from 'react';
import { ImageIcon, User } from 'lucide-react';
import { Logo } from '@/components/ui/Logo';

export interface TemplateListItem {
  id: string; name: string; description: string | null; thumbnail_url: string | null;
  category: string | null; tags: string[]; source: 'official' | 'community';
  created_by_name: string | null; usage_count: number; created_at: string;
}

export function TemplateCard({ tpl, onOpen, popular }: { tpl: TemplateListItem; onOpen: () => void; popular?: boolean }) {
  const isOfficial = tpl.source === 'official';
  return (
    <button onClick={onOpen}
      className="group relative text-left bg-surface-secondary/70 border border-stroke-subtle/70 rounded-2xl overflow-hidden hover:border-accent-primary/40 hover:shadow-xl hover:shadow-black/5 transition-all duration-200">
      {popular && (
        <span className="absolute top-3 right-3 z-10 text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full bg-accent-primary text-white shadow-sm">
          Popular
        </span>
      )}
      <div className="aspect-[4/3] bg-surface-tertiary overflow-hidden">
        {tpl.thumbnail_url
          ? <img src={tpl.thumbnail_url} alt={tpl.name} className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300" />
          : <div className="w-full h-full flex items-center justify-center text-content-tertiary/50"><ImageIcon className="w-6 h-6" /></div>}
      </div>
      <div className="p-4 space-y-1.5">
        <h3 className="font-semibold text-sm text-content-primary truncate">{tpl.name}</h3>
        {tpl.description && <p className="text-xs text-content-secondary line-clamp-2 leading-relaxed">{tpl.description}</p>}
        <div className="flex items-center gap-1.5 pt-1.5 text-[11px] text-content-tertiary">
          {isOfficial ? (
            <><Logo variant="mark" className="w-3.5 h-3.5" /><span className="font-medium">Prisfol</span></>
          ) : (
            <><User className="w-3 h-3" /><span className="font-medium truncate">{tpl.created_by_name || 'Community'}</span></>
          )}
        </div>
      </div>
    </button>
  );
}
