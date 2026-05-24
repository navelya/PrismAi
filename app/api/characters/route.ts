import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

export const dynamic = 'force-dynamic';

const MAX_REFERENCE_IMAGES = 6;

interface RefImage { url: string; path: string; role?: 'face'; }

function sanitizeRefImages(raw: any): RefImage[] {
    if (!Array.isArray(raw)) return [];
    const out: RefImage[] = [];
    for (const item of raw) {
        const url = typeof item?.url === 'string' ? item.url : undefined;
        const path = typeof item?.path === 'string' ? item.path : '';
        if (!url) continue;
        out.push(item?.role === 'face' ? { url, path, role: 'face' } : { url, path });
        if (out.length >= MAX_REFERENCE_IMAGES) break;
    }
    return out;
}

/** GET /api/characters — list the user's non-deleted characters, most-recently-used first.
 *  Drafts are hidden unless ?includeDrafts=true (used only by the assets page). */
export async function GET(request: NextRequest) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const includeDrafts = request.nextUrl.searchParams.get('includeDrafts') === 'true';

    let query = supabase
        .from('characters')
        .select('id, name, description, reference_images, thumbnail_url, weight, created_at, updated_at, last_used_at, is_draft')
        .eq('user_id', user.id)
        .is('deleted_at', null);

    if (!includeDrafts) query = query.eq('is_draft', false);

    const { data, error } = await query
        .order('last_used_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ characters: data });
}

/** POST /api/characters — create a character */
export async function POST(request: NextRequest) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    let body: any;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

    const referenceImages = sanitizeRefImages(body?.referenceImages);
    if (referenceImages.length === 0) {
        return NextResponse.json({ error: 'At least one reference image is required' }, { status: 400 });
    }

    const description = typeof body?.description === 'string' ? body.description : null;
    const weightRaw = Number(body?.weight);
    const weight = Number.isFinite(weightRaw) ? Math.min(100, Math.max(0, Math.round(weightRaw))) : 70;
    const thumbnailUrl = typeof body?.thumbnailUrl === 'string' ? body.thumbnailUrl : referenceImages[0].url;

    const { data, error } = await supabase
        .from('characters')
        .insert({
            user_id: user.id,
            name,
            description,
            reference_images: referenceImages,
            thumbnail_url: thumbnailUrl,
            weight,
        })
        .select('id, name, description, reference_images, thumbnail_url, weight, created_at, updated_at, last_used_at')
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ character: data }, { status: 201 });
}
