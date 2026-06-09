import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

export async function GET() {
    try {
        const auth = await getAuthenticatedUser();
        if (auth.error) return auth.error;

        const { data, error } = await auth.supabase
            .from('ai_models')
            .select('*, providers(name, logo_url, adapter_key)')
            .eq('is_active', true)
            .order('display_name');

        if (error) throw error;

        return NextResponse.json({ models: data });
    } catch (err: any) {
        console.error('[Models List API] Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
