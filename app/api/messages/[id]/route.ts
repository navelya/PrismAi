import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

/**
 * PATCH /api/messages/[id]
 * Updates properties of an existing message (e.g., attaching image results after execution).
 */
export async function PATCH(
    request: Request,
    { params }: { params: { id: string } }
) {
    try {
        const auth = await getAuthenticatedUser();
        if (auth.error) return auth.error;
        const { user, supabase } = auth;

        const messageId = params.id;
        const body = await request.json();

        // Allowed fields to update
        const updatePayload: any = {};
        if (body.images !== undefined) updatePayload.images = body.images;
        if (body.content !== undefined) updatePayload.content = body.content;
        if (body.metadata !== undefined) updatePayload.metadata = body.metadata;

        if (Object.keys(updatePayload).length === 0) {
            return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
        }

        // Verify the user owns the session this message belongs to
        // Option 1: Join with sessions table to verify ownership
        // Let's do it eagerly with a service client or direct select
        const { data: message, error: messageError } = await supabase
            .from('messages')
            .select('session_id, sessions!inner(user_id)')
            .eq('id', messageId)
            .single();

        if (messageError || !message || (message.sessions as any).user_id !== user.id) {
            return NextResponse.json({ error: 'Message not found or unauthorized' }, { status: 404 });
        }

        const { data: updatedMessage, error: updateError } = await supabase
            .from('messages')
            .update(updatePayload)
            .eq('id', messageId)
            .select()
            .single();

        if (updateError) throw updateError;

        return NextResponse.json({ success: true, message: updatedMessage });
    } catch (error: any) {
        console.error('❌ /api/messages/[id] error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 },
        );
    }
}
