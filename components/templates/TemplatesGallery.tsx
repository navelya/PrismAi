// components/templates/TemplatesGallery.tsx
'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { Search, Loader2, LayoutGrid, X } from 'lucide-react';
import { useAppStore } from '@/lib/store/app-store';
import { TemplateCard, TemplateListItem } from './TemplateCard';
import { TemplatePreviewModal } from './TemplatePreviewModal';

type SortMode = 'popular' | 'new';

export function TemplatesGallery() {
  // Templates are preloaded on app open and shared via the store, so navigating
  // to this page shows them instantly (no per-visit refetch).
  const items = useAppStore((s) => s.templates) as TemplateListItem[];
  const loading = useAppStore((s) => s.isTemplatesLoading);
  const fetchTemplates = useAppStore((s) => s.fetchTemplates);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>('popular');
  const [previewId, setPreviewId] = useState<string | null>(null);

  // No-op if already loaded; covers a cold deep-link straight to /templates.
  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  // One representative thumbnail per category drives the use-case row.
  const categoryCards = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const t of items) {
      if (!t.category) continue;
      if (!map.has(t.category) || (!map.get(t.category) && t.thumbnail_url)) map.set(t.category, t.thumbnail_url);
    }
    return Array.from(map.entries()).map(([name, thumb]) => ({ name, thumb }));
  }, [items]);

  // "Popular" = the most-cloned third of templates that have at least one use.
  const popularIds = useMemo(() => {
    const used = items.filter((t) => (t.usage_count ?? 0) > 0).sort((a, b) => b.usage_count - a.usage_count);
    const take = Math.max(3, Math.ceil(used.length * 0.3));
    return new Set(used.slice(0, take).map((t) => t.id));
  }, [items]);

  const visible = useMemo(() => {
    const list = items.filter((t) =>
      (!category || t.category === category) &&
      (!search || t.name.toLowerCase().includes(search.toLowerCase()) ||
        (t.tags || []).some((g) => g.toLowerCase().includes(search.toLowerCase())))
    );
    return [...list].sort((a, b) =>
      sort === 'popular'
        ? (b.usage_count - a.usage_count) || a.name.localeCompare(b.name)
        : new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [items, category, search, sort]);

  return (
    <div className="h-full overflow-y-auto bg-surface-primary mesh-gradient">
      <div className="max-w-6xl mx-auto px-6 py-10">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <div className="text-center py-10 mb-4">
          <h1 className="text-3xl font-bold text-content-primary tracking-tight">Find your use case. Start building.</h1>
          <p className="text-sm text-content-secondary mt-2">Open a template on a real canvas, then make it yours in one click.</p>
        </div>

        {/* ── Use cases ────────────────────────────────────────────────── */}
        {categoryCards.length > 0 && (
          <section className="mb-12">
            <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-content-tertiary/80 mb-4">Use cases</h2>
            <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {categoryCards.map((c) => {
                const active = category === c.name;
                return (
                  <button key={c.name} onClick={() => setCategory(active ? null : c.name)}
                    className={`group relative shrink-0 w-44 h-28 rounded-2xl overflow-hidden border transition-all ${active ? 'border-accent-primary ring-2 ring-accent-primary/30' : 'border-stroke-subtle/70 hover:border-accent-primary/40'}`}>
                    {c.thumb
                      ? <img src={c.thumb} alt={c.name} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      : <div className="absolute inset-0 bg-surface-tertiary" />}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                    <span className="absolute bottom-2.5 left-3 right-3 text-left text-sm font-semibold text-white drop-shadow truncate">{c.name}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Browse ───────────────────────────────────────────────────── */}
        <section>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-content-primary">Browse templates</h2>
              {category && (
                <button onClick={() => setCategory(null)}
                  className="flex items-center gap-1 text-xs font-medium text-content-secondary bg-surface-secondary border border-stroke-subtle/60 rounded-full pl-2.5 pr-2 py-1 hover:text-content-primary transition-colors">
                  {category} <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              {/* New / Popular segmented toggle */}
              <div className="flex items-center p-1 rounded-xl bg-white/5 border border-white/10">
                {(['popular', 'new'] as SortMode[]).map((m) => (
                  <button key={m} onClick={() => setSort(m)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${sort === m ? 'bg-surface-elevated text-content-primary shadow-sm' : 'text-content-tertiary hover:text-content-secondary'}`}>
                    {m}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-content-tertiary pointer-events-none" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
                  className="w-44 sm:w-52 h-9 bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 text-sm text-content-primary placeholder:text-content-tertiary/40 focus:outline-none focus:border-accent-primary/50 focus:ring-4 focus:ring-accent-primary/10 transition-all" />
              </div>
            </div>
          </div>

          {loading && items.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-content-tertiary"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : visible.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center gap-3 text-content-tertiary/70">
              <LayoutGrid className="w-7 h-7 opacity-40" />
              <p className="text-sm">{search || category ? 'No templates match your filters' : 'No templates yet'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {visible.map((t) => (
                <TemplateCard key={t.id} tpl={t} popular={popularIds.has(t.id)} onOpen={() => setPreviewId(t.id)} />
              ))}
            </div>
          )}
        </section>
      </div>

      <TemplatePreviewModal id={previewId} onClose={() => setPreviewId(null)} />
    </div>
  );
}
