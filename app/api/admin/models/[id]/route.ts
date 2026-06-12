import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { invalidateRegistryCache } from '@/lib/chat/registry-cache';
import { mirrorModelProviderBinding } from '@/lib/admin/model-provider-binding';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
    try {
        const auth = await requireAdmin();
        if (auth.error) return auth.error;

        const { id } = params;
        const body = await req.json();

        const {
            replicate_model_id,
            display_name,
            category_id,
            node_type_id,
            archetype_id,
            credit_cost,
            is_active,
            inputs_schema,
            outputs_schema,
            provider_id,
            provider_model_id,
            description
        } = body;

        const { data, error } = await auth.supabase
            .from('ai_models')
            .update({
                replicate_model_id,
                display_name,
                category_id,
                node_type_id,
                archetype_id,
                credit_cost: credit_cost !== undefined ? Number(credit_cost) : undefined,
                is_active,
                inputs_schema: {
                    ...(inputs_schema || {}),
                    description: description || inputs_schema?.description || ''
                },
                outputs_schema: outputs_schema || { handles: [] },
                provider_id,
                provider_model_id: provider_model_id || null,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // Slug edits must reach the ai_model_providers binding table too —
        // provider resolution prefers it over the legacy ai_models columns.
        await mirrorModelProviderBinding(auth.supabase, data);

        // Model edits (inputs_schema/handles, is_active, etc.) must reach the
        // chat brain faster than the 5-min TTL.
        invalidateRegistryCache();

        return NextResponse.json({ success: true, model: data });
    } catch (err: any) {
        console.error('[Admin Models PATCH API] Error:', err);
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
            .from('ai_models')
            .delete()
            .eq('id', id);

        if (error) throw error;

        // Drop the deleted model from the chat brain's view promptly.
        invalidateRegistryCache();

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('[Admin Models DELETE API] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
