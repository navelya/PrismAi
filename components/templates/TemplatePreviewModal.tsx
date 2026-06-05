// components/templates/TemplatePreviewModal.tsx
'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Loader2, User } from 'lucide-react';
import { templatesApi } from '@/lib/api/client';
import { nodeChipsFor, workflowNodeChips } from '@/lib/templates/node-chips';
import { useAppStore } from '@/lib/store/app-store';
import { Logo } from '@/components/ui/Logo';
import { TemplateCanvasPreview } from './TemplateCanvasPreview';

export function TemplatePreviewModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const router = useRouter();
  const models = useAppStore((s) => s.models);
  const categories = useAppStore((s) => s.categories);
  const [tpl, setTpl] = useState<any | null>(null);
  const [using, setUsing] = useState(false);

  useEffect(() => {
    if (!id) { setTpl(null); return; }
    let alive = true;
    templatesApi.get(id).then(({ template }) => { if (alive) setTpl(template); }).catch(() => {});
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (id) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [id, onClose]);

  const openInStudio = async () => {
    if (!id) return;
    setUsing(true);
    try { const { session_id } = await templatesApi.use(id); router.push(`/chat/${session_id}`); }
    catch { setUsing(false); }
  };

  // AI-model nodes show their category (+ icon); other nodes keep their own.
  // Older templates without a stored graph fall back to the saved node-type list.
  const chips = useMemo(() => {
    if (!tpl) return [];
    const nodes = tpl.workflow?.nodes ?? [];
    return nodes.length ? workflowNodeChips(nodes, models, categories) : nodeChipsFor(tpl.nodes_used || []);
  }, [tpl, models, categories]);
  const isOfficial = tpl?.source === 'official';

  return (
    <AnimatePresence>
      {id && (
        <>
          <motion.div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-md"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div className="fixed inset-0 z-[81] flex items-center justify-center p-4 sm:p-8 pointer-events-none"
            initial={{ opacity: 0, scale: 0.97, y: 18 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 18 }} transition={{ type: 'spring', damping: 30, stiffness: 320 }}>
            <div className="relative w-full max-w-6xl h-[86vh] bg-surface-elevated border border-stroke-subtle rounded-3xl shadow-2xl pointer-events-auto flex flex-col md:flex-row overflow-hidden"
              onClick={(e) => e.stopPropagation()}>

              {!tpl ? (
                <div className="flex-1 flex items-center justify-center text-content-tertiary">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : (
                <>
                  {/* ── Left column · meta ──────────────────────────────── */}
                  <div className="md:w-[330px] shrink-0 md:border-r border-stroke-subtle/70 flex flex-col p-6 md:p-7 overflow-y-auto">
                    <button onClick={onClose}
                      className="self-start flex items-center gap-1.5 pl-2 pr-3 py-1.5 rounded-full text-sm text-content-secondary hover:text-content-primary hover:bg-white/5 transition-colors mb-8">
                      <ChevronLeft className="w-4 h-4" /> Back
                    </button>

                    <h1 className="text-3xl font-bold text-content-primary leading-tight tracking-tight mb-7">{tpl.name}</h1>

                    <button onClick={openInStudio} disabled={using}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-accent-primary text-white text-sm font-semibold hover:bg-accent-primary/90 transition-colors disabled:opacity-50 shadow-sm shadow-accent-primary/20">
                      {using ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Open in Studio
                    </button>

                    {/* Created by */}
                    <div className="mt-8">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-content-tertiary/70 mb-3">Created by</p>
                      <div className="flex items-center gap-2.5">
                        {isOfficial ? (
                          <>
                            <Logo variant="mark" className="w-5 h-5" />
                            <span className="text-sm font-medium text-content-primary">Prisfol</span>
                          </>
                        ) : (
                          <>
                            <span className="w-6 h-6 rounded-full bg-surface-tertiary border border-stroke-subtle flex items-center justify-center">
                              <User className="w-3.5 h-3.5 text-content-tertiary" />
                            </span>
                            <span className="text-sm font-medium text-content-primary">{tpl.created_by_name || 'Community'}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Nodes used */}
                    {chips.length > 0 && (
                      <div className="mt-7">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-content-tertiary/70 mb-3">Nodes used</p>
                        <ul className="space-y-2.5">
                          {chips.map((c) => (
                            <li key={c.type} className="flex items-center gap-2.5 text-sm text-content-secondary">
                              <span className="w-6 h-6 rounded-md bg-surface-secondary border border-stroke-subtle/60 flex items-center justify-center shrink-0">
                                <c.Icon className="w-3.5 h-3.5" />
                              </span>
                              {c.label}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Tags */}
                    {tpl.tags?.length > 0 && (
                      <div className="mt-7">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-content-tertiary/70 mb-3">Tags</p>
                        <div className="flex flex-wrap gap-1.5">
                          {tpl.tags.map((t: string) => (
                            <span key={t} className="text-[11px] px-2.5 py-1 rounded-full bg-surface-secondary border border-stroke-subtle/50 text-content-tertiary">{t}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── Right column · canvas + description ─────────────── */}
                  <div className="flex-1 min-w-0 flex flex-col gap-5 p-6 md:p-7">
                    <div className="relative flex-1 min-h-[240px] rounded-2xl border border-stroke-subtle bg-surface-secondary overflow-hidden">
                      {(tpl.workflow?.nodes?.length) ? (
                        <TemplateCanvasPreview nodes={tpl.workflow.nodes} edges={tpl.workflow?.edges ?? []} className="w-full h-full" />
                      ) : tpl.thumbnail_url ? (
                        <img src={tpl.thumbnail_url} alt={tpl.name} className="w-full h-full object-contain" />
                      ) : null}
                      {(tpl.workflow?.nodes?.length) ? (
                        <div className="absolute bottom-3 right-3 text-[10px] text-content-tertiary/80 bg-surface-elevated/80 backdrop-blur px-2 py-1 rounded-full border border-stroke-subtle/50 pointer-events-none">
                          Drag to pan · scroll to zoom
                        </div>
                      ) : null}
                    </div>

                    <div className="shrink-0 max-h-[34%] overflow-y-auto pr-1 space-y-3">
                      {tpl.description && (
                        <p className="text-[15px] font-semibold text-content-primary leading-snug">{tpl.description}</p>
                      )}
                      {tpl.how_it_works && (
                        <p className="text-sm text-content-secondary leading-relaxed whitespace-pre-wrap">{tpl.how_it_works}</p>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
