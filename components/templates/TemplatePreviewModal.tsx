// components/templates/TemplatePreviewModal.tsx
'use client';
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { X, Loader2, Sparkles } from 'lucide-react';
import { templatesApi } from '@/lib/api/client';
import { nodeChipsFor } from '@/lib/templates/node-chips';

export function TemplatePreviewModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const router = useRouter();
  const [tpl, setTpl] = useState<any | null>(null);
  const [using, setUsing] = useState(false);

  useEffect(() => {
    if (!id) { setTpl(null); return; }
    let alive = true;
    templatesApi.get(id).then(({ template }) => { if (alive) setTpl(template); }).catch(() => {});
    return () => { alive = false; };
  }, [id]);

  const useTemplate = async () => {
    if (!id) return;
    setUsing(true);
    try { const { session_id } = await templatesApi.use(id); router.push(`/chat/${session_id}`); }
    catch { setUsing(false); }
  };

  const chips = tpl ? nodeChipsFor(tpl.nodes_used || []) : [];

  return (
    <AnimatePresence>
      {id && (
        <>
          <motion.div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div className="fixed inset-0 z-[81] flex items-center justify-center p-6 pointer-events-none"
            initial={{ opacity: 0, scale: 0.96, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }} transition={{ type: 'spring', damping: 28, stiffness: 320 }}>
            <div className="relative w-full max-w-2xl max-h-[88vh] overflow-y-auto bg-surface-elevated border border-stroke-subtle rounded-2xl shadow-2xl pointer-events-auto"
              onClick={(e) => e.stopPropagation()}>
              <button onClick={onClose} className="absolute top-4 right-4 z-10 p-2 bg-black/30 hover:bg-black/50 rounded-lg transition-colors">
                <X className="w-4 h-4 text-white" />
              </button>
              {!tpl ? (
                <div className="h-64 flex items-center justify-center text-content-tertiary"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : (
                <>
                  <div className="aspect-[16/9] bg-surface-tertiary overflow-hidden">
                    {tpl.thumbnail_url
                      ? <img src={tpl.thumbnail_url} alt={tpl.name} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-content-tertiary"><Sparkles className="w-8 h-8" /></div>}
                  </div>
                  <div className="p-6 space-y-5">
                    <div>
                      <h2 className="text-xl font-bold text-content-primary">{tpl.name}</h2>
                      <p className="text-xs text-accent-primary font-semibold uppercase tracking-wide mt-1">
                        {tpl.source === 'official' ? 'Official template' : `by ${tpl.created_by_name}`}
                        {tpl.category ? ` · ${tpl.category}` : ''}
                      </p>
                    </div>
                    {tpl.description && <p className="text-sm text-content-secondary">{tpl.description}</p>}
                    {tpl.how_it_works && (
                      <Section title="How it works">
                        <p className="text-sm text-content-secondary whitespace-pre-wrap">{tpl.how_it_works}</p>
                      </Section>
                    )}
                    {tpl.use_cases?.length > 0 && (
                      <Section title="Use cases">
                        <ul className="list-disc list-inside text-sm text-content-secondary space-y-1">
                          {tpl.use_cases.map((u: string, i: number) => <li key={i}>{u}</li>)}
                        </ul>
                      </Section>
                    )}
                    {chips.length > 0 && (
                      <Section title="Nodes used">
                        <div className="flex flex-wrap gap-1.5">
                          {chips.map((c) => (
                            <span key={c.type} className="flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-full bg-surface-secondary text-content-secondary">
                              <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />{c.label}
                            </span>
                          ))}
                        </div>
                      </Section>
                    )}
                    {tpl.tags?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {tpl.tags.map((t: string) => (
                          <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-surface-tertiary text-content-tertiary">#{t}</span>
                        ))}
                      </div>
                    )}
                    <button onClick={useTemplate} disabled={using}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-accent-primary text-white text-sm font-semibold hover:bg-accent-primary/90 transition-colors disabled:opacity-50">
                      {using ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Use this template
                    </button>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wide text-content-tertiary mb-2">{title}</h3>
      {children}
    </div>
  );
}
