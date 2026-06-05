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
import { MarkdownView } from '@/components/ui/MarkdownView';
import { TemplateCanvasPreview } from './TemplateCanvasPreview';

export function TemplatePreviewModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const router = useRouter();
  const models = useAppStore((s) => s.models);
  const categories = useAppStore((s) => s.categories);
  const templates = useAppStore((s) => s.templates);
  const fetchTemplateWorkflow = useAppStore((s) => s.fetchTemplateWorkflow);
  const [using, setUsing] = useState(false);

  // Metadata is already in the preloaded list cache → instant, no fetch.
  const meta = useMemo(() => (id ? templates.find((t: any) => t.id === id) ?? null : null), [templates, id]);
  // The graph is fetched once on first open and cached per id (re-open is instant).
  const workflow = useAppStore((s) => (id ? s.templateWorkflows[id] : undefined));
  const workflowLoading = useAppStore((s) => (id ? !!s.templateWorkflowLoading[id] : false));

  useEffect(() => { if (id) fetchTemplateWorkflow(id); }, [id, fetchTemplateWorkflow]);

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

  // Nodes used come from the graph (AI nodes → category + icon). Loads with the
  // workflow on first open; older templates without a graph fall back to the
  // saved node-type list once the (empty) graph has resolved.
  const chips = useMemo(() => {
    if (workflow?.nodes?.length) return workflowNodeChips(workflow.nodes, models, categories);
    if (workflow && meta?.nodes_used?.length) return nodeChipsFor(meta.nodes_used);
    return [];
  }, [workflow, meta, models, categories]);

  const isOfficial = meta?.source === 'official';

  return (
    <AnimatePresence>
      {id && (
        <>
          <motion.div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-md"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div className="fixed inset-0 z-[81] flex items-center justify-center p-4 sm:p-8 pointer-events-none"
            initial={{ opacity: 0, scale: 0.97, y: 18 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 18 }} transition={{ type: 'spring', damping: 30, stiffness: 320 }}>
            <div className="relative w-full max-w-6xl h-[86vh] bg-surface-elevated border border-stroke-subtle rounded-lg shadow-2xl pointer-events-auto flex flex-col md:flex-row overflow-hidden"
              onClick={(e) => e.stopPropagation()}>

              {!meta ? (
                <div className="flex-1 flex items-center justify-center text-content-tertiary">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : (
                <>
                  {/* ── Left column · meta (instant) ────────────────────── */}
                  <div className="md:w-[330px] shrink-0 md:border-r border-stroke-subtle/70 flex flex-col p-6 md:p-7 overflow-y-auto">
                    <button onClick={onClose}
                      className="self-start flex items-center gap-1.5 pl-2 pr-3 py-1.5 rounded-lg text-sm text-content-secondary hover:text-content-primary hover:bg-white/5 transition-colors mb-8">
                      <ChevronLeft className="w-4 h-4" /> Back
                    </button>

                    <h1 className="text-3xl font-bold text-content-primary leading-tight tracking-tight mb-7">{meta.name}</h1>

                    <button onClick={openInStudio} disabled={using}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-accent-primary text-white text-sm font-semibold hover:bg-accent-primary/90 transition-colors disabled:opacity-50 shadow-sm shadow-accent-primary/20">
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
                            <span className="w-6 h-6 rounded-lg bg-surface-tertiary border border-stroke-subtle flex items-center justify-center">
                              <User className="w-3.5 h-3.5 text-content-tertiary" />
                            </span>
                            <span className="text-sm font-medium text-content-primary">{meta.created_by_name || 'Community'}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Nodes used (loads with the graph on first open) */}
                    {chips.length > 0 && (
                      <div className="mt-7">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-content-tertiary/70 mb-3">Nodes used</p>
                        <ul className="space-y-2.5">
                          {chips.map((c) => (
                            <li key={c.type} className="flex items-center gap-2.5 text-sm text-content-secondary">
                              <span className="w-6 h-6 rounded-lg bg-surface-secondary border border-stroke-subtle/60 flex items-center justify-center shrink-0">
                                <c.Icon className="w-3.5 h-3.5" />
                              </span>
                              {c.label}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Tags */}
                    {meta.tags?.length > 0 && (
                      <div className="mt-7">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-content-tertiary/70 mb-3">Tags</p>
                        <div className="flex flex-wrap gap-1.5">
                          {meta.tags.map((t: string) => (
                            <span key={t} className="text-[11px] px-2.5 py-1 rounded-lg bg-surface-secondary border border-stroke-subtle/50 text-content-tertiary">{t}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── Right column · canvas + description ─────────────── */}
                  <div className="flex-1 min-w-0 flex flex-col gap-5 p-6 md:p-7">
                    <div className="relative flex-1 min-h-[240px] rounded-lg border border-stroke-subtle bg-surface-secondary overflow-hidden">
                      {workflow?.nodes?.length ? (
                        <TemplateCanvasPreview nodes={workflow.nodes} edges={workflow.edges ?? []} className="w-full h-full" />
                      ) : workflowLoading ? (
                        <div className="w-full h-full flex items-center justify-center text-content-tertiary"><Loader2 className="w-5 h-5 animate-spin" /></div>
                      ) : meta.thumbnail_url ? (
                        <img src={meta.thumbnail_url} alt={meta.name} className="w-full h-full object-contain" />
                      ) : null}
                    </div>

                    <div className="shrink-0 max-h-[34%] overflow-y-auto pr-1 space-y-3">
                      {meta.description && (
                        <p className="text-[15px] font-semibold text-content-primary leading-snug">{meta.description}</p>
                      )}
                      {meta.how_it_works && <MarkdownView content={meta.how_it_works} />}
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
