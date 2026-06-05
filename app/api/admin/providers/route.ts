import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { invalidateRegistryCache } from '@/lib/chat/registry-cache';
import { v4 as uuidv4 } from 'uuid';

/**
 * GET /api/admin/providers - List all providers
 * POST /api/admin/providers - Create a new provider (with logo upload)
 */

export async function GET() {
    try {
        const auth = await requireAdmin();
        if (auth.error) return auth.error;

        const { data, error } = await auth.supabase
            .from('providers')
            .select('*')
            .order('name');

        if (error) throw error;
        return NextResponse.json({ providers: data });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const auth = await requireAdmin();
        if (auth.error) return auth.error;
        const { supabase } = auth;

        const formData = await req.formData();
        const name = formData.get('name') as string;
        const logoFile = formData.get('logo') as File | null;

        if (!name) {
            return NextResponse.json({ error: 'Provider name is required' }, { status: 400 });
        }

        let logoUrl = null;

        if (logoFile) {
            const fileExt = logoFile.name.split('.').pop();
            const fileName = `${uuidv4()}.${fileExt}`;
            const filePath = `logos/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('provider-logos')
                .upload(filePath, logoFile);

            if (uploadError) throw uploadError;

            const { data: urlData } = supabase.storage
                .from('provider-logos')
                .getPublicUrl(filePath);
            
            logoUrl = urlData.publicUrl;
        }

        const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-');

        const { data, error } = await supabase
            .from('providers')
            .insert([{ id, name, logo_url: logoUrl }])
            .select()
            .single();

        if (error) throw error;

        // The registry cache joins providers(name) into each model, so a new
        // provider must invalidate it too.
        invalidateRegistryCache();

        return NextResponse.json({ provider: data });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
