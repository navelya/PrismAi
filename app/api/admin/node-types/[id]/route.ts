import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { invalidateRegistryCache } from '@/lib/chat/registry-cache';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
    try {
        const auth = await requireAdmin();
        if (auth.error) return auth.error;

        const { id } = params;
        const body = await req.json();

        // Partial update — only touch the columns the caller actually sent, so a
        // description-only PATCH (e.g. the bulk AI-generate flow) never clobbers
        // display_name / icon / parent_categories.
        const patch: Record<string, any> = {};
        if ('display_name' in body) patch.display_name = body.display_name;
        if ('icon_reference' in body) patch.icon_reference = body.icon_reference;
        if ('parent_categories' in body) patch.parent_categories = body.parent_categories;
        if ('description' in body) patch.description = body.description ?? null;

        const { data, error } = await auth.supabase
            .from('node_types')
            .update(patch)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        invalidateRegistryCache();

        return NextResponse.json({ success: true, nodeType: data });
    } catch (err: any) {
        console.error('[Admin Node Types PATCH API] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
    try {
        const auth = await requireAdmin();
        if (auth.error) return auth.error;

        const { id } = params;

        const { error } = await auth.supabase
            .from('node_types')
            .delete()
            .eq('id', id);

        if (error) throw error;

        invalidateRegistryCache();

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('[Admin Node Types DELETE API] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
