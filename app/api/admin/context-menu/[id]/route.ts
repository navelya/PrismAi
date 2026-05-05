import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAdmin } from '@/lib/api/auth';

// Cycle Prevention Logic
async function causesCycle(supabase: any, itemId: string, targetParentId: string | null): Promise<boolean> {
    if (!targetParentId) return false;
    if (itemId === targetParentId) return true;

    // Fetch all items to build a local tree for fast checking
    const { data: allItems } = await supabase.from('context_menu_items').select('id, parent_id');
    if (!allItems) return false;

    let currentParentId = targetParentId;
    const maxDepth = 1000;
    let depth = 0;
    
    // Walk up the tree from targetParentId
    // If we ever hit itemId, then making itemId the parent of targetParentId would create an infinite loop.
    while (currentParentId && depth < maxDepth) {
        if (currentParentId === itemId) return true;
        const parentNode = allItems.find((n: any) => n.id === currentParentId);
        if (!parentNode) break;
        currentParentId = parentNode.parent_id;
        depth++;
    }
    return false;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
    try {
        const auth = await requireAdmin();
        if (auth.error) return auth.error;
        const id = params.id;
        const updates = await req.json();
        const supabase = createServiceClient();

        if (updates.parent_id !== undefined) {
            const hasCycle = await causesCycle(supabase, id, updates.parent_id);
            if (hasCycle) {
                return NextResponse.json({ error: 'Cannot assign a folder as a child of itself or its descendants.' }, { status: 400 });
            }
        }

        const { data, error } = await supabase
            .from('context_menu_items')
            .update(updates)
            .eq('id', id)
            .select();

        if (error) {
            console.error('[ContextMenu PATCH Error]', error);
            throw error;
        }

        if (!data || data.length === 0) {
            throw new Error('Update succeeded but no record was found or updated.');
        }

        return NextResponse.json({ item: data[0] });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
    try {
        const auth = await requireAdmin();
        if (auth.error) return auth.error;
        const id = params.id;
        const supabase = createServiceClient();

        // Since parent_id uses ON DELETE CASCADE in the DB schema,
        // deleting a parent will automatically delete its descendants.
        const { error } = await supabase
            .from('context_menu_items')
            .delete()
            .eq('id', id);

        if (error) throw error;
        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
