import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

/**
 * POST /api/sessions/beacon
 * 
 * Emergency save endpoint for navigator.sendBeacon() calls.
 * Designed to handle exit saves (tab close/refresh) with minimal payload.
 * 
 * This endpoint is optimized for speed and reliability:
 * - Accepts minimal payload (sessionId + canvas_state)
 * - Bypasses complex validation for speed
 * - Returns immediately without waiting for database response
 * - Uses best-effort delivery (may fail if browser kills connection)
 */
export async function POST(request: NextRequest) {
    try {
        const auth = await getAuthenticatedUser();
        if (auth.error) return auth.error;
        const { user, supabase } = auth;

        const body = await request.json();
        const { sessionId, canvas_state } = body;

        if (!sessionId || !canvas_state) {
            return NextResponse.json(
                { error: 'sessionId and canvas_state required' },
                { status: 400 }
            );
        }

        // Fire-and-forget update (don't wait for response)
        // Using void operator to explicitly ignore the promise
        // No .eq('user_id', user.id) filter here — editors don't own the canvas
        // row but have UPDATE rights via the can_edit_session RLS policy.
        void supabase
            .from('sessions')
            .update({
                canvas_state,
                updated_at: new Date().toISOString(),
            })
            .eq('id', sessionId);

        // Return immediately (don't wait for database)
        return NextResponse.json({ success: true }, { status: 200 });
    } catch (error) {
        console.error('[Beacon] Emergency save failed:', error);
        // Still return success to prevent browser from blocking
        return NextResponse.json({ success: true }, { status: 200 });
    }
}
