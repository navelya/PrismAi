import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { invalidateRegistryCache } from '@/lib/chat/registry-cache';

// Promote a variant to be its group's primary (the one shown in user-facing
// model lists). Atomic single-statement RPC — never a transient two-primary
// state, idempotent if the target is already primary.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
    try {
        const auth = await requireAdmin();
        if (auth.error) return auth.error;

        const { id } = params;

        const { error } = await auth.supabase
            .rpc('promote_model_variant', { target_id: Number(id) });

        if (error) throw error;

        // The shown-model set changed — let the brain/store refresh promptly.
        invalidateRegistryCache();

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('[Admin Models Promote API] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
