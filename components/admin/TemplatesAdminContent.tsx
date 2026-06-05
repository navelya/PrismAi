// components/admin/TemplatesAdminContent.tsx
'use client';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2, Eye, EyeOff, Archive, ArrowLeft, Pencil } from 'lucide-react';
import { adminTemplatesApi } from '@/lib/api/admin';
import { ConfirmationModal } from '@/components/ui/ConfirmationModal';
import { useAppStore } from '@/lib/store/app-store';

export function TemplatesAdminContent({ onMobileBack }: { onMobileBack?: () => void }) {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // Admin mutations here also refresh the shared public cache so the gallery /
  // in-canvas modal reflect publish/unpublish/delete without a reload.
  const refreshPublic = useAppStore((s) => s.fetchTemplates);

  const load = () => {
    setLoading(true);
    adminTemplatesApi.list().then(setRows).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const setStatus = async (id: string, status: string) => {
    setBusyId(id);
    const fd = new FormData(); fd.set('status', status);
    try { await adminTemplatesApi.update(id, fd); load(); refreshPublic(true); } finally { setBusyId(null); }
  };
  const remove = async (id: string) => {
    setBusyId(id);
    try { await adminTemplatesApi.remove(id); setConfirmId(null); load(); refreshPublic(true); } finally { setBusyId(null); }
  };
  // Open the template on a real Studio canvas (metadata + graph edit) — see TemplateEditBar.
  const edit = async (id: string) => {
    setBusyId(id);
    try { const sid = await adminTemplatesApi.editSession(id); router.push(`/chat/${sid}?editTemplate=${id}`); }
    catch { setBusyId(null); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {onMobileBack && (
        <button onClick={onMobileBack} className="md:hidden flex items-center gap-1 text-sm text-content-secondary mb-4">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      )}
      <h2 className="text-lg font-bold text-content-primary mb-1">Templates</h2>
      <p className="text-sm text-content-secondary mb-6">Manage official templates. Create new ones from a workflow via the editor&apos;s &quot;Convert to template&quot; button.</p>

      {loading ? (
        <div className="h-40 flex items-center justify-center text-content-tertiary"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-content-tertiary">No templates yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((t) => (
            <div key={t.id} className="flex items-center gap-3 p-3 rounded-xl border border-stroke-subtle bg-surface-secondary">
              <div className="w-14 h-14 rounded-lg bg-surface-tertiary overflow-hidden shrink-0">
                {t.thumbnail_url && <img src={t.thumbnail_url} alt="" className="w-full h-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-content-primary truncate">{t.name}</div>
                <div className="text-xs text-content-tertiary">
                  {t.source} · {t.status} · {t.category || 'Uncategorized'} · {t.usage_count} uses
                </div>
              </div>
              <div className="flex items-center gap-1">
                <IconBtn title="Edit" busy={busyId === t.id} onClick={() => edit(t.id)}><Pencil className="w-4 h-4" /></IconBtn>
                {t.status !== 'published' && (
                  <IconBtn title="Publish" busy={busyId === t.id} onClick={() => setStatus(t.id, 'published')}><Eye className="w-4 h-4" /></IconBtn>
                )}
                {t.status === 'published' && (
                  <IconBtn title="Unpublish" busy={busyId === t.id} onClick={() => setStatus(t.id, 'draft')}><EyeOff className="w-4 h-4" /></IconBtn>
                )}
                <IconBtn title="Archive" busy={busyId === t.id} onClick={() => setStatus(t.id, 'archived')}><Archive className="w-4 h-4" /></IconBtn>
                <IconBtn title="Delete" busy={busyId === t.id} onClick={() => setConfirmId(t.id)}><Trash2 className="w-4 h-4 text-accent-error" /></IconBtn>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmationModal
        isOpen={!!confirmId}
        title="Delete template?"
        message="This permanently removes the template and its thumbnail. Existing clones are unaffected."
        confirmText="Delete"
        variant="danger"
        onConfirm={() => confirmId && remove(confirmId)}
        onClose={() => setConfirmId(null)}
      />
    </div>
  );
}

function IconBtn({ title, onClick, busy, children }: { title: string; onClick: () => void; busy?: boolean; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick} disabled={busy}
      className="p-2 rounded-lg hover:bg-surface-tertiary text-content-secondary hover:text-content-primary transition-colors disabled:opacity-50">
      {children}
    </button>
  );
}
