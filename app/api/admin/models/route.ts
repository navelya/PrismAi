import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { invalidateRegistryCache } from '@/lib/chat/registry-cache';
import {
    hasValidProviderBindings,
    mirrorModelProviderBinding,
    reconcileModelProviderBindings,
} from '@/lib/admin/model-provider-binding';

export async function POST(req: Request) {
    try {
        const auth = await requireAdmin();
        if (auth.error) return auth.error;

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
            description,
            // Optional ordered bindings array (index 0 = default). Reconciled
            // into ai_model_providers below — NOT an ai_models column.
            provider_bindings
        } = body;

        // Basic validation
        if (!display_name || !category_id || !archetype_id) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }
        if (!replicate_model_id && !provider_id && !hasValidProviderBindings(provider_bindings)) {
            return NextResponse.json({ error: 'Provide a replicate_model_id, a provider, or provider_bindings' }, { status: 400 });
        }

        const { data, error } = await auth.supabase
            .from('ai_models')
            .insert({
                replicate_model_id,
                display_name,
                category_id,
                node_type_id,
                archetype_id,
                credit_cost: credit_cost || 0,
                is_active: is_active ?? true,
                inputs_schema: { 
                    ...(inputs_schema || { handles: [], controls: [] }),
                    description: description || inputs_schema?.description || ''
                },
                outputs_schema: outputs_schema || { handles: [] },
                provider_id,
                provider_model_id: provider_model_id || null,
            })
            .select()
            .single();

        if (error) throw error;

        // Register the new model's slug(s) in the ai_model_providers binding
        // table — provider resolution prefers it over the legacy ai_models
        // columns. Clients sending the full ordered bindings array get a
        // reconcile (replace-all); legacy clients keep the single-row mirror.
        if (Array.isArray(provider_bindings)) {
            await reconcileModelProviderBindings(auth.supabase, data.id, provider_bindings);
        } else {
            await mirrorModelProviderBinding(auth.supabase, data);
        }

        // New model must surface to the chat brain faster than the 5-min TTL.
        invalidateRegistryCache();

        return NextResponse.json({ success: true, model: data });
    } catch (err: any) {
        console.error('[Admin Models API] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
