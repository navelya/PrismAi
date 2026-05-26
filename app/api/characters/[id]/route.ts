import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, requireAdmin } from '@/lib/api/auth';

export const dynamic = 'force-dynamic';

const MAX_REFERENCE_IMAGES = 6;

function sanitizeRefImages(raw: any): { url: string; path: string; role?: 'face' }[] {
    if (!Array.isArray(raw)) return [];
    const out: { url: string; path: string; role?: 'face' }[] = [];
    for (const item of raw) {
        const url = typeof item?.url === 'string' ? item.url : undefined;
        const path = typeof item?.path === 'string' ? item.path : '';
        if (!url) continue;
        out.push(item?.role === 'face' ? { url, path, role: 'face' } : { url, path });
        if (out.length >= MAX_REFERENCE_IMAGES) break;
    }
    return out;
}

/** PATCH /api/characters/[id] — edit a character */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const id = params.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    let body: any;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

    const update: Record<string, any> = {};
    if (typeof body?.name === 'string') {
        const name = body.name.trim();
        if (!name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
        update.name = name;
    }
    if (typeof body?.description === 'string' || body?.description === null) {
        update.description = body.description;
    }
    if (body?.referenceImages !== undefined) {
        const imgs = sanitizeRefImages(body.referenceImages);
        if (imgs.length === 0) return NextResponse.json({ error: 'At least one reference image is required' }, { status: 400 });
        update.reference_images = imgs;
    }
    if (body?.weight !== undefined) {
        const w = Number(body.weight);
        if (Number.isFinite(w)) update.weight = Math.min(100, Math.max(0, Math.round(w)));
    }
    if (typeof body?.thumbnailUrl === 'string') update.thumbnail_url = body.thumbnailUrl;

    // Sharing is admin-only. Only run the admin check when the client is actually
    // changing the share flag, so ordinary owner edits stay non-admin.
    if (typeof body?.isShared === 'boolean') {
        const adminAuth = await requireAdmin();
        if (adminAuth.error) return adminAuth.error;
        update.is_shared = body.isShared;
    }

    if (Object.keys(update).length === 0) {
        return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
    }

    // Promote a draft to active only when this edit sets a (non-empty) name —
    // the editor's Save button always sends one, and the route validated it
    // above. This keeps the invariant "an active character has a non-empty
    // name" true even if a future partial PATCH omits the name.
    if (update.name) update.is_draft = false;

    const { data, error } = await supabase
        .from('characters')
        .update(update)
        .eq('id', id)
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .select('id, name, description, reference_images, thumbnail_url, weight, created_at, updated_at, last_used_at, is_draft, is_shared')
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    return NextResponse.json({ character: data });
}

/** DELETE /api/characters/[id] — hard delete: removes the row AND every
 *  reference image from storage so nothing is left behind. */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const id = params.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    // Fetch the character (owner-scoped) to collect its storage paths first.
    const { data: character, error: fetchErr } = await supabase
        .from('characters')
        .select('id, reference_images')
        .eq('id', id)
        .eq('user_id', user.id)
        .single();

    if (fetchErr || !character) {
        return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    }

    // Remove every reference image from storage. Best-effort: a missing/failed
    // object must not block deleting the row. Guard the path prefix so we only
    // ever touch the owner's own files.
    const refs = Array.isArray((character as any).reference_images) ? (character as any).reference_images : [];
    const paths: string[] = refs
        .map((img: any) => (typeof img === 'string' ? '' : img?.path))
        .filter((p: any): p is string => typeof p === 'string' && p.startsWith(`${user.id}/`));
    if (paths.length > 0) {
        const { error: rmErr } = await supabase.storage.from('chat-assets').remove(paths);
        if (rmErr) console.error('[characters/delete] storage cleanup failed:', rmErr.message);
    }

    // Hard delete the row — no ghost data.
    const { error: delErr } = await supabase
        .from('characters')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);

    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    return NextResponse.json({ success: true });
}
