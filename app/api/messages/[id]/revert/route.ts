import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

interface RouteParams {
    params: { id: string }; // Message ID
}

/**
 * POST /api/messages/[id]/revert
 * Reverts the session to the state of a specific message.
 * - Restores the workflow (canvas_state) from that message.
 * - Deletes all subsequent messages (Time Machine logic).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;
    const messageId = params.id;

    // 1. Fetch the target message
    const { data: targetMessage, error: msgError } = await supabase
        .from('messages')
        .select('session_id, created_at, canvas_state')
        .eq('id', messageId)
        .single();

    if (msgError || !targetMessage) {
        return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    // 2. Verify Session Ownership
    const { data: session } = await supabase
        .from('sessions')
        .select('id')
        .eq('id', targetMessage.session_id)
        .eq('user_id', user.id)
        .single();

    if (!session) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    if (!targetMessage.canvas_state) {
        return NextResponse.json({ error: 'No snapshot available for this message' }, { status: 400 });
    }

    // 3. Time Machine: Delete all future messages (Robust Sequence Strategy)
    // Instead of relying solely on timestamps (which can be flaky or have skew),
    // we fetch the ordered list, find our target, and delete everything that follows.

    const { data: allMessages, error: listError } = await supabase
        .from('messages')
        .select('id, created_at')
        .eq('session_id', targetMessage.session_id)
        .order('created_at', { ascending: true }); // Trust the DB sort order

    if (listError || !allMessages) {
        return NextResponse.json({ error: 'Failed to retrieve message sequence' }, { status: 500 });
    }

    // Find the cut-off point
    const targetIndex = allMessages.findIndex(m => m.id === messageId);

    if (targetIndex === -1) {
        // Should not happen as we fetched it earlier, but safety check
        return NextResponse.json({ error: 'Target message lost in sequence' }, { status: 500 });
    }

    // Collect IDs to delete (everything AFTER the target)
    const idsToDelete = allMessages
        .slice(targetIndex + 1)
        .map(m => m.id);

    console.log(`[Revert] Found ${idsToDelete.length} messages to delete after index ${targetIndex}`);

    if (idsToDelete.length > 0) {
        const { error: deleteError } = await supabase
            .from('messages')
            .delete()
            .in('id', idsToDelete);

        if (deleteError) {
            console.error('[Revert] Delete failed:', deleteError);
            return NextResponse.json({ error: 'Failed to delete future messages' }, { status: 500 });
        }
    }

    // 4. Restore Session State
    const { error: updateError } = await supabase
        .from('sessions')
        .update({
            canvas_state: targetMessage.canvas_state,
            updated_at: new Date().toISOString(),
        })
        .eq('id', targetMessage.session_id);

    if (updateError) {
        return NextResponse.json({ error: 'Failed to restore session state' }, { status: 500 });
    }

    return NextResponse.json({
        success: true,
        workflow: targetMessage.canvas_state,
        message: 'Time machine reversion complete',
    });
}
