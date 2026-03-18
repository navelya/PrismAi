import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/telemetry/save-error
 *
 * Receives save-failure reports from navigator.sendBeacon() calls in useAutoSave.
 * Logs structured error data to the server so failures are visible in Vercel logs.
 *
 * Design decisions:
 * - No authentication required: telemetry must arrive even if auth expires.
 * - No database writes: purely log-based to keep this path as simple and fast as possible.
 * - Returns 204: sendBeacon doesn't read the response body; 204 signals success.
 * - Body size guard: reject payloads > 4KB to prevent abuse.
 */
export async function POST(request: NextRequest) {
    try {
        const contentLength = request.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > 4096) {
            return new NextResponse(null, { status: 413 }); // Payload too large
        }

        const body = await request.json();
        const { sessionId, errorMessage, timestamp } = body ?? {};

        // Structured log — captured in Vercel Function Logs / stdout.
        console.error('[Telemetry] Auto-save failure reported:', {
            sessionId: typeof sessionId === 'string' ? sessionId : 'unknown',
            errorMessage: typeof errorMessage === 'string' ? errorMessage : String(errorMessage ?? 'unknown'),
            timestamp: typeof timestamp === 'string' ? timestamp : new Date().toISOString(),
        });
    } catch {
        // Swallow parse errors — a malformed beacon payload is not worth logging noisily.
    }

    // Always return 204: sendBeacon ignores the response body anyway.
    return new NextResponse(null, { status: 204 });
}
