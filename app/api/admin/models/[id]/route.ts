import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { invalidateRegistryCache } from '@/lib/chat/registry-cache';
import {
    mirrorModelProviderBinding,
    reconcileModelProviderBindings,
} from '@/lib/admin/model-provider-binding';

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
            is_done,
            inputs_schema,
            outputs_schema,
            provider_id,
            provider_model_id,
            description,
            // Optional ordered bindings array (index 0 = default). Reconciled
            // into ai_model_providers below — NOT an ai_models column.
            provider_bindings
        } = body;

        // Build the update from ONLY the fields the client actually sent, so a
        // partial PATCH (e.g. the management "Done" toggle sending just
        // { is_done }) never clobbers inputs_schema / bindings / other columns.
        const update: Record<string, any> = { updated_at: new Date().toISOString() };
        if (replicate_model_id !== undefined) update.replicate_model_id = replicate_model_id;
        if (display_name !== undefined) update.display_name = display_name;
        if (category_id !== undefined) update.category_id = category_id;
        if (node_type_id !== undefined) update.node_type_id = node_type_id;
        if (archetype_id !== undefined) update.archetype_id = archetype_id;
        if (credit_cost !== undefined) update.credit_cost = Number(credit_cost);
        if (is_active !== undefined) update.is_active = is_active;
        if (is_done !== undefined) update.is_done = is_done;
        if (provider_id !== undefined) update.provider_id = provider_id;
        if (provider_model_id !== undefined) update.provider_model_id = provider_model_id || null;
        if (inputs_schema !== undefined || description !== undefined) {
            update.inputs_schema = {
                ...(inputs_schema || {}),
                description: description || inputs_schema?.description || ''
            };
        }
        if (outputs_schema !== undefined) update.outputs_schema = outputs_schema;

        const { data, error } = await auth.supabase
            .from('ai_models')
            .update(update)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // Slug edits must reach the ai_model_providers binding table too —
        // provider resolution prefers it over the legacy ai_models columns.
        // Clients sending the full ordered bindings array get a reconcile
        // (replace-all); legacy clients keep the single-row mirror.
        if (Array.isArray(provider_bindings)) {
            await reconcileModelProviderBindings(auth.supabase, data.id, provider_bindings);
        } else if (provider_id !== undefined || replicate_model_id !== undefined || provider_model_id !== undefined) {
            // Only re-mirror when provider-related fields were actually sent —
            // a partial PATCH (e.g. the "Done" toggle) must not touch bindings.
            await mirrorModelProviderBinding(auth.supabase, data);
        }

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

        // Deleting a group's primary must promote a surviving variant so the group
        // is never left without a primary — done atomically in the RPC. Plain delete
        // for non-primary or last-in-group rows.
        const { error } = await auth.supabase
            .rpc('delete_model_and_reseat_primary', { target_id: Number(id) });

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
