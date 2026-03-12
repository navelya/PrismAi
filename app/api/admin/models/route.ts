import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

export async function POST(req: Request) {
    try {
        const auth = await getAuthenticatedUser();
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
            outputs_schema
        } = body;

        // Basic validation
        if (!replicate_model_id || !display_name || !category_id || !archetype_id) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
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
                inputs_schema: inputs_schema || { handles: [], controls: [] },
                outputs_schema: outputs_schema || { handles: [] }
            })
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ success: true, model: data });
    } catch (err: any) {
        console.error('[Admin Models API] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
