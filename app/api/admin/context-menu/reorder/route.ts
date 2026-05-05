import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAdmin } from '@/lib/api/auth';

export async function POST(req: Request) {
    try {
        const auth = await requireAdmin();
        if (auth.error) return auth.error;
        const { items } = await req.json(); // Array of { id, sort_order }
        
        if (!items || !Array.isArray(items)) {
            return NextResponse.json({ error: 'Invalid items array' }, { status: 400 });
        }

        const supabase = createServiceClient();
        
        // Use a single upsert to sync all items at once.
        // We receive full objects now to ensure not-null constraints are met.
        const { error } = await supabase
            .from('context_menu_items')
            .upsert(items, { onConflict: 'id' });

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Reorder API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
