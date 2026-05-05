import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';

export async function GET() {
    try {
        const auth = await requireAdmin();
        if (auth.error) return auth.error;

        const { data, error } = await auth.supabase
            .from('node_types')
            .select('*')
            .order('display_name');

        if (error) throw error;
        return NextResponse.json(data);
    } catch (err: any) {
        console.error('[Admin Node Types API] Error fetching:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const auth = await requireAdmin();
        if (auth.error) return auth.error;

        const body = await req.json();
        const { id, display_name, icon_reference, parent_categories } = body;

        // Basic validation
        if (!id || !display_name) {
            return NextResponse.json({ error: 'Missing required fields (id, display_name)' }, { status: 400 });
        }

        const { data, error } = await auth.supabase
            .from('node_types')
            .insert({
                id,
                display_name,
                icon_reference: icon_reference || 'Boxes', // Fallback icon
                parent_categories: parent_categories || []
            })
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ success: true, nodeType: data });
    } catch (err: any) {
        console.error('[Admin Node Types API] Error creating:', err);
        return NextResponse.json(
            { error: err.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
