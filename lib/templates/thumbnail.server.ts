// lib/templates/thumbnail.server.ts
// Resolve a template hero image from a session's most recent successful IMAGE output,
// copying it into the template-thumbnails bucket so it survives output GC.
// Returns the public URL, or null if no image output exists (caller then requires an upload).
import { v4 as uuidv4 } from 'uuid';

export async function resolveThumbnailFromSession(
  supabase: any,
  templateId: string,
  sessionId: string,
): Promise<string | null> {
  // Latest successful image result for this session.
  const { data: rows } = await supabase
    .from('node_results')
    .select('result_type, result_data, created_at')
    .eq('session_id', sessionId)
    .eq('status', 'success')
    .eq('result_type', 'image')
    .order('created_at', { ascending: false })
    .limit(5);

  const url = firstImageUrl(rows ?? []);
  if (!url) return null;
  return copyImageUrlToBucket(supabase, templateId, url);
}

/**
 * Fetch an image at `url` and copy it into the template-thumbnails bucket so it
 * survives output GC. Returns the public URL, or null on any failure.
 */
export async function copyImageUrlToBucket(
  supabase: any,
  templateId: string,
  url: string,
): Promise<string | null> {
  if (!url || !/^https?:\/\//.test(url)) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/png';
    const ext = contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : 'png';
    const buf = Buffer.from(await res.arrayBuffer());
    const path = `templates/${templateId}/${uuidv4()}.${ext}`;
    const { error } = await supabase.storage
      .from('template-thumbnails')
      .upload(path, buf, { contentType, upsert: true });
    if (error) return null;
    const { data } = supabase.storage.from('template-thumbnails').getPublicUrl(path);
    return data.publicUrl;
  } catch {
    return null;
  }
}

/** result_data is a JSONB array of items; pull the first usable image URL. */
function firstImageUrl(rows: any[]): string | null {
  for (const r of rows) {
    const items = Array.isArray(r.result_data) ? r.result_data : [];
    for (const item of items) {
      const u = typeof item === 'string' ? item : item?.url ?? item?.publicUrl ?? item?.src;
      if (typeof u === 'string' && /^https?:\/\//.test(u)) return u;
    }
  }
  return null;
}

/** Upload an admin-provided File to the template-thumbnails bucket; returns its public URL. */
export async function uploadTemplateThumbnail(
  supabase: any,
  templateId: string,
  file: File,
): Promise<string> {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `templates/${templateId}/${uuidv4()}.${ext}`;
  const { error } = await supabase.storage
    .from('template-thumbnails')
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) throw error;
  const { data } = supabase.storage.from('template-thumbnails').getPublicUrl(path);
  return data.publicUrl;
}
