// components/editor/TemplateEditModal.tsx
'use client';
import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, ImagePlus, LayoutTemplate } from 'lucide-react';
import { adminTemplatesApi } from '@/lib/api/admin';
import { useAppStore } from '@/lib/store/app-store';
import { workflowNodeChips } from '@/lib/templates/node-chips';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { Checkbox } from '@/components/ui/Checkbox';
import { MarkdownEditor } from '@/components/ui/MarkdownEditor';

interface Props {
  template: any; // full workflow_templates row (id + metadata + thumbnail_url)
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

const CATEGORIES = ['Product Photography', 'Branding', 'Video', 'Image Editing', 'Characters', 'Other'];

/**
 * Edit an existing template's details AND graph in one save. The metadata fields
 * are prefilled from the row; the workflow graph is taken live from the canvas
 * (the current edit session's currentWorkflow) so "Save" persists both.
 */
export function TemplateEditModal({ template, isOpen, onClose, onSaved }: Props) {
  const models = useAppStore((s) => s.models);
  const categories = useAppStore((s) => s.categories);
  const currentWorkflow = useAppStore((s) => s.currentWorkflow);

  const [name, setName] = useState(template.name ?? '');
  const [category, setCategory] = useState(template.category ?? CATEGORIES[0]);
  const [description, setDescription] = useState(template.description ?? '');
  const [howItWorks, setHowItWorks] = useState(template.how_it_works ?? '');
  const [tagsText, setTagsText] = useState((template.tags ?? []).join(', '));
  const [useCasesText, setUseCasesText] = useState((template.use_cases ?? []).join('\n'));
  const [publish, setPublish] = useState(template.status === 'published');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Include the row's own category even if it's outside the canned list.
  const categoryOptions = useMemo(() => {
    const list = [...CATEGORIES];
    if (template.category && !list.includes(template.category)) list.unshift(template.category);
    return list.map((c) => ({ id: c, display_name: c }));
  }, [template.category]);

  const chips = useMemo(
    () => workflowNodeChips((currentWorkflow as any)?.nodes ?? [], models, categories),
    [currentWorkflow, models, categories],
  );

  const filePreview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  const previewUrl = filePreview || template.thumbnail_url || null;

  const submit = async () => {
    if (!name.trim()) { setError('A name is required.'); return; }
    setSaving(true); setError(null);
    try {
      const wf = useAppStore.getState().currentWorkflow;
      const fd = new FormData();
      fd.set('name', name.trim());
      fd.set('description', description);
      fd.set('how_it_works', howItWorks);
      fd.set('category', category);
      fd.set('tags', JSON.stringify(tagsText.split(',').map((t: string) => t.trim()).filter(Boolean)));
      fd.set('use_cases', JSON.stringify(useCasesText.split('\n').map((t: string) => t.trim()).filter(Boolean)));
      fd.set('status', publish ? 'published' : 'draft');
      if (wf) fd.set('workflow', JSON.stringify({ nodes: (wf as any).nodes ?? [], edges: (wf as any).edges ?? [] }));
      if (file) fd.set('thumbnail', file);
      await adminTemplatesApi.update(template.id, fd);
      // Refresh the shared caches so the gallery / preview reflect the edit.
      useAppStore.getState().fetchTemplates(true);
      useAppStore.getState().invalidateTemplateWorkflow(template.id);
      setDone(true);
      setTimeout(() => { setDone(false); onSaved?.(); onClose(); }, 900);
    } catch (e: any) {
      setError(e.message || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div className="fixed inset-0 z-[91] flex items-center justify-center p-6 pointer-events-none"
            initial={{ opacity: 0, scale: 0.96, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }} transition={{ type: 'spring', damping: 28, stiffness: 320 }}>
            <div className="relative w-full max-w-lg max-h-[86vh] overflow-y-auto bg-surface-elevated border border-stroke-subtle rounded-lg shadow-2xl pointer-events-auto"
              onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b border-stroke-subtle">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-accent-primary/10 border border-accent-primary/20 flex items-center justify-center">
                    <LayoutTemplate className="w-4 h-4 text-accent-primary" />
                  </div>
                  <div>
                    <h2 className="font-bold text-content-primary text-base">Edit template</h2>
                    <p className="text-xs text-content-tertiary">Saving updates the template details and its canvas</p>
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
                  <label className="text-[10px] font-bold text-content-tertiary uppercase tracking-[0.1em] pl-1 opacity-80 block mb-1.5">Thumbnail</label>
                  <label className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-white/10 hover:border-accent-primary/50 cursor-pointer transition-colors">
                    {previewUrl
                      ? <img src={previewUrl} alt="" className="w-16 h-16 object-cover rounded-lg shrink-0" />
                      : <div className="w-16 h-16 rounded-lg bg-white/5 flex items-center justify-center shrink-0"><ImagePlus className="w-5 h-5 text-content-tertiary" /></div>}
                    <span className="text-xs text-content-tertiary">
                      {file ? file.name : previewUrl ? 'Click to replace the thumbnail.' : 'Click to upload a thumbnail.'}
                    </span>
                    <input type="file" accept="image/*" className="hidden"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  </label>
                </div>

                <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
                <Select label="Category" options={categoryOptions} value={category} onChange={(e) => setCategory(e.target.value)} />
                <Textarea label="Description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
                <MarkdownEditor label="How it works" value={howItWorks} onChange={setHowItWorks} rows={6}
                  placeholder="Explain what this template does, step by step." />
                <Input label="Tags (comma-separated)" placeholder="ecommerce, lighting" value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
                <Textarea label="Use cases (one per line)" rows={3} value={useCasesText} onChange={(e) => setUseCasesText(e.target.value)} />

                {/* Nodes used (read-only, live from the canvas) */}
                <div>
                  <label className="text-[10px] font-bold text-content-tertiary uppercase tracking-[0.1em] pl-1 opacity-80 block mb-1.5">Nodes used</label>
                  <div className="flex flex-wrap gap-1.5">
                    {chips.length === 0
                      ? <span className="text-xs text-content-tertiary">No nodes detected</span>
                      : chips.map((c) => (
                        <span key={c.type} className="flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-lg bg-surface-secondary text-content-secondary">
                          <c.Icon className="w-3 h-3" />{c.label}
                        </span>
                      ))}
                  </div>
                </div>

                <Checkbox label="Published" checked={publish} onCheckedChange={setPublish} />

                {error && <p className="text-xs text-accent-error">{error}</p>}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 p-5 border-t border-stroke-subtle">
                <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-content-secondary hover:bg-surface-tertiary transition-colors">Cancel</button>
                <button onClick={submit} disabled={saving || done}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white text-sm font-semibold hover:bg-accent-primary/90 transition-colors disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {done ? 'Saved' : 'Save template'}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
