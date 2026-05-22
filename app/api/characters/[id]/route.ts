import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

export const dynamic = 'force-dynamic';

const MAX_REFERENCE_IMAGES = 5;

function sanitizeRefImages(raw: any): { url: string; path: string }[] {
    if (!Array.isArray(raw)) return [];
    const out: { url: string; path: string }[] = [];
    for (const item of raw) {
        const url = typeof item?.url === 'string' ? item.url : undefined;
        const path = typeof item?.path === 'string' ? item.path : '';
        if (!url) continue;
        out.push({ url, path });
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

    if (Object.keys(update).length === 0) {
        return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
    }

    const { data, error } = await supabase
        .from('characters')
        .update(update)
        .eq('id', id)
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .select('id, name, description, reference_images, thumbnail_url, weight, created_at, updated_at, last_used_at')
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    return NextResponse.json({ character: data });
}

/** DELETE /api/characters/[id] — soft delete */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const id = params.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const { error } = await supabase
        .from('characters')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', user.id)
        .is('deleted_at', null);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
}
