// components/templates/TemplatesGallery.tsx
'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { Search, Loader2, Sparkles } from 'lucide-react';
import { templatesApi } from '@/lib/api/client';
import { TemplateCard, TemplateListItem } from './TemplateCard';
import { TemplatePreviewModal } from './TemplatePreviewModal';

export function TemplatesGallery() {
  const [items, setItems] = useState<TemplateListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    templatesApi.list()
      .then(({ templates }) => { if (alive) setItems(templates as TemplateListItem[]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const categories = useMemo(
    () => Array.from(new Set(items.map((t) => t.category).filter(Boolean))) as string[],
    [items],
  );
  const filtered = useMemo(() => items.filter((t) =>
    (!category || t.category === category) &&
    (!search || t.name.toLowerCase().includes(search.toLowerCase()))
  ), [items, category, search]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-content-primary">Templates</h1>
          <p className="text-sm text-content-secondary mt-1">Start from a proven workflow — preview it, then make it yours.</p>
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-content-tertiary" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates…"
              className="w-full bg-surface-secondary border border-stroke-subtle rounded-lg pl-9 pr-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-accent-primary/50" />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto">
            <Pill active={!category} onClick={() => setCategory(null)}>All</Pill>
            {categories.map((c) => <Pill key={c} active={category === c} onClick={() => setCategory(c)}>{c}</Pill>)}
          </div>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="h-64 flex items-center justify-center text-content-tertiary"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center gap-3 text-content-tertiary">
            <Sparkles className="w-7 h-7 opacity-40" />
            <p className="text-sm">No templates yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((t) => <TemplateCard key={t.id} tpl={t} onOpen={() => setPreviewId(t.id)} />)}
          </div>
        )}
      </div>
      <TemplatePreviewModal id={previewId} onClose={() => setPreviewId(null)} />
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${active ? 'bg-accent-primary text-white' : 'bg-surface-secondary text-content-secondary hover:text-content-primary'}`}>
      {children}
    </button>
  );
}
