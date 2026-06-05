import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { invalidateRegistryCache } from '@/lib/chat/registry-cache';
import { v4 as uuidv4 } from 'uuid';

/**
 * PATCH /api/admin/providers/[id] - Update a provider
 * DELETE /api/admin/providers/[id] - Delete a provider
 */

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const auth = await requireAdmin();
        if (auth.error) return auth.error;
        const { supabase } = auth;
        const id = params.id;

        const formData = await req.formData();
        const name = formData.get('name') as string;
        const logoFile = formData.get('logo') as File | null;

        // Fetch current provider to handle logo cleanup
        const { data: current, error: fetchError } = await supabase
            .from('providers')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !current) {
            return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
        }

        let logoUrl = current.logo_url;

        if (logoFile) {
            // Delete old logo if exists
            if (current.logo_url) {
                const oldPath = current.logo_url.split('/').pop();
                if (oldPath) {
                    await supabase.storage.from('provider-logos').remove([`logos/${oldPath}`]);
                }
            }

            // Upload new logo
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

        const { data, error } = await supabase
            .from('providers')
            .update({ name, logo_url: logoUrl, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // Provider name change flows into the registry's joined model display.
        invalidateRegistryCache();

        return NextResponse.json({ provider: data });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const auth = await requireAdmin();
        if (auth.error) return auth.error;
        const { supabase } = auth;
        const id = params.id;

        // Fetch to cleanup logo
        const { data: current } = await supabase
            .from('providers')
            .select('logo_url')
            .eq('id', id)
            .single();

        if (current?.logo_url) {
            const oldPath = current.logo_url.split('/').pop();
            if (oldPath) {
                await supabase.storage.from('provider-logos').remove([`logos/${oldPath}`]);
            }
        }

        const { error } = await supabase
            .from('providers')
            .delete()
            .eq('id', id);

        if (error) throw error;

        invalidateRegistryCache();

        return NextResponse.json({ success: true });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
