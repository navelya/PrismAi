import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { renderCompositorVideo } from '@/lib/nodes/plugins/compositor/executor.server';
import type { CompositorConfig } from '@/lib/nodes/plugins/compositor/definition';

/**
 * Render the compositor's timeline server-side and stream the mp4 back as a
 * file download. Replaces the previous client-side MediaRecorder flow.
 *
 * Body:
 *   {
 *     config: CompositorConfig,
 *     inputs: Record<string, string>,  // keyed by layer.sourceHandleId -> resolved URL
 *     filename?: string,                // user-friendly download name (no extension needed)
 *   }
 *
 * Renders synchronously and returns the mp4 bytes directly. `maxDuration` is
 * bumped to the Vercel Pro cap; longer timelines on Hobby plans will hit the
 * per-request execution limit before this matters.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;

    let body: { config?: CompositorConfig; inputs?: Record<string, string>; filename?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const config = body.config;
    const inputs = body.inputs;
    if (!config || typeof config !== 'object') {
        return NextResponse.json({ error: 'Missing or invalid `config`' }, { status: 400 });
    }
    if (!inputs || typeof inputs !== 'object') {
        return NextResponse.json({ error: 'Missing or invalid `inputs`' }, { status: 400 });
    }

    try {
        const buffer = await renderCompositorVideo(config, inputs, {
            includeAudio: true,
            crf: 18,
        });

        const safe = (body.filename || 'compositor').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const downloadName = `${safe}-${ts}.mp4`;

        // NextResponse's BodyInit doesn't accept Node's Buffer directly under
        // the current TS DOM lib (Buffer's ArrayBufferLike isn't a strict
        // ArrayBuffer). `Uint8Array.from(buffer)` re-roots the bytes onto a
        // plain ArrayBuffer that satisfies BlobPart.
        const responseBlob = new Blob([Uint8Array.from(buffer)], { type: 'video/mp4' });
        return new NextResponse(responseBlob, {
            status: 200,
            headers: {
                'Content-Type': 'video/mp4',
                'Content-Length': String(responseBlob.size),
                'Content-Disposition': `attachment; filename="${downloadName}"`,
                'Cache-Control': 'no-store',
            },
        });
    } catch (err) {
        console.error('[API/Compositor/Export] render failed:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Render failed' },
            { status: 500 },
        );
    }
}
