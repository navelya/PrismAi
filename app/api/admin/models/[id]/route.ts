import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
    try {
        const auth = await getAuthenticatedUser();
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
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

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
        const auth = await getAuthenticatedUser();
        if (auth.error) return auth.error;

        const { id } = params;

        const { error } = await auth.supabase
            .from('ai_models')
            .delete()
            .eq('id', id);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('[Admin Models DELETE API] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
