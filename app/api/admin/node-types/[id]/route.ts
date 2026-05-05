import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
    try {
        const auth = await requireAdmin();
        if (auth.error) return auth.error;

        const { id } = params;
        const body = await req.json();
        const { display_name, icon_reference, parent_categories } = body;

        const { data, error } = await auth.supabase
            .from('node_types')
            .update({
                display_name,
                icon_reference,
                parent_categories
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

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

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('[Admin Node Types DELETE API] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
