// components/editor/TemplateEditBar.tsx
'use client';
import React, { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { LayoutTemplate, X } from 'lucide-react';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { adminTemplatesApi } from '@/lib/api/admin';
import { TemplateEditModal } from './TemplateEditModal';

/**
 * Shown when an admin opens a template's edit session (?editTemplate=<id>). It
 * floats a "Editing template" bar over the canvas with Save (opens the details +
 * graph save modal) and Exit. Renders nothing for non-admins / regular sessions.
 */
export function TemplateEditBar() {
  const isAdmin = useIsAdmin();
  const params = useSearchParams();
  const router = useRouter();
  const templateId = params.get('editTemplate');
  const [tpl, setTpl] = useState<any>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    if (isAdmin && templateId) {
      adminTemplatesApi.get(templateId).then((t) => { if (alive) setTpl(t); }).catch(() => { if (alive) setTpl(null); });
    } else {
      setTpl(null);
    }
    return () => { alive = false; };
  }, [isAdmin, templateId]);

  if (!isAdmin || !templateId || !tpl) return null;

  return (
    <>
      <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 pl-3.5 pr-2 py-2 rounded-lg bg-surface-elevated/95 backdrop-blur-md border border-stroke-subtle shadow-xl shadow-black/30">
        <span className="flex items-center gap-2 text-sm">
          <LayoutTemplate className="w-4 h-4 text-accent-primary shrink-0" />
          <span className="text-content-tertiary">Editing template</span>
          <span className="font-semibold text-content-primary max-w-[220px] truncate">{tpl.name}</span>
        </span>
        <button onClick={() => setOpen(true)}
          className="px-3 py-1.5 rounded-lg bg-accent-primary text-white text-sm font-semibold hover:bg-accent-primary/90 transition-colors">
          Save changes
        </button>
        <button onClick={() => router.push('/admin?section=templates')} title="Exit editing"
          className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <TemplateEditModal
        template={tpl}
        isOpen={open}
        onClose={() => setOpen(false)}
        onSaved={() => { if (templateId) adminTemplatesApi.get(templateId).then(setTpl).catch(() => {}); }}
      />
    </>
  );
}
