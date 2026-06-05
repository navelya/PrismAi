// components/editor/ConvertToTemplateModal.tsx
'use client';
import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, ImagePlus, LayoutTemplate } from 'lucide-react';
import { adminTemplatesApi } from '@/lib/api/admin';
import { useAppStore } from '@/lib/store/app-store';
import { deriveNodesUsed } from '@/lib/templates/snapshot';
import { nodeChipsFor } from '@/lib/templates/node-chips';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string | null;
  defaultName: string;
}

const CATEGORIES = ['Product Photography', 'Branding', 'Video', 'Image Editing', 'Characters', 'Other'];

export function ConvertToTemplateModal({ isOpen, onClose, sessionId, defaultName }: Props) {
  const currentWorkflow = useAppStore((s) => s.currentWorkflow);
  const [name, setName] = useState(defaultName);
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [howItWorks, setHowItWorks] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [useCasesText, setUseCasesText] = useState('');
  const [publish, setPublish] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const chips = useMemo(
    () => nodeChipsFor(deriveNodesUsed(currentWorkflow as any)),
    [currentWorkflow],
  );
  const filePreview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  const submit = async () => {
    if (!sessionId || !name.trim()) { setError('A name is required.'); return; }
    setSaving(true); setError(null);
    try {
      const fd = new FormData();
      fd.set('session_id', sessionId);
      fd.set('name', name.trim());
      fd.set('description', description);
      fd.set('how_it_works', howItWorks);
      fd.set('category', category);
      fd.set('tags', JSON.stringify(tagsText.split(',').map((t) => t.trim()).filter(Boolean)));
      fd.set('use_cases', JSON.stringify(useCasesText.split('\n').map((t) => t.trim()).filter(Boolean)));
      fd.set('publish', String(publish));
      if (file) fd.set('thumbnail', file);
      await adminTemplatesApi.create(fd);
      setDone(true);
      setTimeout(() => { setDone(false); onClose(); }, 900);
    } catch (e: any) {
      setError(e.message || 'Failed to create template');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div className="fixed inset-0 z-[81] flex items-center justify-center p-6 pointer-events-none"
            initial={{ opacity: 0, scale: 0.96, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }} transition={{ type: 'spring', damping: 28, stiffness: 320 }}>
            <div className="relative w-full max-w-lg max-h-[86vh] overflow-y-auto bg-surface-elevated border border-stroke-subtle rounded-2xl shadow-2xl pointer-events-auto"
              onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b border-stroke-subtle">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-accent-primary/10 border border-accent-primary/20 flex items-center justify-center">
                    <LayoutTemplate className="w-4 h-4 text-accent-primary" />
                  </div>
                  <div>
                    <h2 className="font-bold text-content-primary text-base">Convert to template</h2>
                    <p className="text-xs text-content-tertiary">Publish this workflow as a reusable template</p>
                  </div>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-surface-tertiary rounded-lg transition-colors">
                  <X className="w-4 h-4 text-content-tertiary" />
                </button>
              </div>

              {/* Body */}
              <div className="p-5 space-y-4">
                {/* Thumbnail */}
                <div>
                  <label className="block text-xs font-semibold text-content-secondary mb-1.5">Thumbnail</label>
                  <label className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-stroke-subtle hover:border-accent-primary/50 cursor-pointer transition-colors">
                    {filePreview
                      ? <img src={filePreview} alt="" className="w-16 h-16 object-cover rounded-lg" />
                      : <div className="w-16 h-16 rounded-lg bg-surface-secondary flex items-center justify-center"><ImagePlus className="w-5 h-5 text-content-tertiary" /></div>}
                    <span className="text-xs text-content-tertiary">
                      {file ? file.name : 'Optional — defaults to the last generated image. Click to upload an override.'}
                    </span>
                    <input type="file" accept="image/*" className="hidden"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  </label>
                </div>

                <Field label="Name">
                  <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Category">
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Description">
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} />
                </Field>
                <Field label="How it works (markdown)">
                  <textarea value={howItWorks} onChange={(e) => setHowItWorks(e.target.value)} rows={3} className={inputCls} />
                </Field>
                <Field label="Tags (comma-separated)">
                  <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="ecommerce, lighting" className={inputCls} />
                </Field>
                <Field label="Use cases (one per line)">
                  <textarea value={useCasesText} onChange={(e) => setUseCasesText(e.target.value)} rows={3} className={inputCls} />
                </Field>

                {/* Nodes used (read-only) */}
                <div>
                  <label className="block text-xs font-semibold text-content-secondary mb-1.5">Nodes used</label>
                  <div className="flex flex-wrap gap-1.5">
                    {chips.length === 0
                      ? <span className="text-xs text-content-tertiary">No nodes detected</span>
                      : chips.map((c) => (
                        <span key={c.type} className="flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-full bg-surface-secondary text-content-secondary">
                          <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />{c.label}
                        </span>
                      ))}
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs text-content-secondary">
                  <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
                  Publish immediately
                </label>

                {error && <p className="text-xs text-accent-error">{error}</p>}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 p-5 border-t border-stroke-subtle">
                <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-content-secondary hover:bg-surface-tertiary transition-colors">Cancel</button>
                <button onClick={submit} disabled={saving || done}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white text-sm font-semibold hover:bg-accent-primary/90 transition-colors disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {done ? 'Saved' : 'Create template'}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

const inputCls = 'w-full bg-surface-primary border border-stroke-subtle rounded-lg px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-accent-primary/50 transition-colors';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-content-secondary mb-1.5">{label}</label>
      {children}
    </div>
  );
}
