import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

const MAX_PAGE_SIZE = 100;
const BUCKET = 'chat-assets';

interface AssetItem {
    name: string;
    path: string;
    size: number;
    mime_type: string | null;
    created_at: string | null;
    updated_at: string | null;
    url: string;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const id = params.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const url = req.nextUrl;
    const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '24', 10) || 24));

    try {
        const service = createServiceClient();

        const { data: list, error } = await service.storage
            .from(BUCKET)
            .list(id, {
                limit: 1000,
                sortBy: { column: 'created_at', order: 'desc' },
            });

        if (error) {
            if ((error as any).statusCode === '404' || /not.found/i.test(error.message)) {
                return NextResponse.json({ rows: [], total: 0, page, pageSize });
            }
            throw error;
        }

        const objects = (list ?? []).filter(item => item.name && !item.name.endsWith('/'));
        const total = objects.length;
        const start = page * pageSize;
        const slice = objects.slice(start, start + pageSize);

        const rows: AssetItem[] = slice.map(item => {
            const path = `${id}/${item.name}`;
            const { data: urlData } = service.storage.from(BUCKET).getPublicUrl(path);
            return {
                name: item.name,
                path,
                size: Number((item.metadata as any)?.size ?? 0),
                mime_type: (item.metadata as any)?.mimetype ?? null,
                created_at: item.created_at ?? null,
                updated_at: item.updated_at ?? null,
                url: urlData.publicUrl,
            };
        });

        return NextResponse.json({ rows, total, page, pageSize });
    } catch (err: any) {
        console.error('[Admin Users API] assets error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
