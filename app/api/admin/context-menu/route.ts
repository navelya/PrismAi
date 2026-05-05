import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAdmin } from '@/lib/api/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const auth = await requireAdmin();
        if (auth.error) return auth.error;
        const supabase = createServiceClient();
        const { data, error } = await supabase
            .from('context_menu_items')
            .select('*')
            .order('sort_order');
            
        if (error) throw error;
        return NextResponse.json(data);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const auth = await requireAdmin();
        if (auth.error) return auth.error;
        const item = await req.json();
        const supabase = createServiceClient();
        
        const { data, error } = await supabase
            .from('context_menu_items')
            .insert(item)
            .select();

        if (error) {
            console.error('[ContextMenu POST Error]', error);
            throw error;
        }

        if (!data || data.length === 0) {
            throw new Error('Insert succeeded but no data was returned. Check database constraints or RLS.');
        }

        return NextResponse.json({ item: data[0] });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
