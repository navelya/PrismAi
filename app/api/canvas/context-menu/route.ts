import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

function buildTree(items: any[], parentId: string | null = null): any[] {
    return items
        .filter(item => item.parent_id === parentId)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(item => ({
            ...item,
            children: buildTree(items, item.id)
        }));
}

export async function GET() {
    try {
        const supabase = createServiceClient();
        
        // Fetch all active items, order them by sort_order
        const { data, error } = await supabase
            .from('context_menu_items')
            .select('*')
            .eq('is_active', true)
            .order('sort_order');

        if (error) throw error;
        
        // Transform the flat list into a hierarchical tree format the canvas menu expects
        const tree = buildTree(data || []);
        
        return NextResponse.json({ tree, flat: data });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
