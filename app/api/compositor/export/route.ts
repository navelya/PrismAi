import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import {
    renderCompositorVideo,
    renderCompositorStill,
} from '@/lib/nodes/plugins/compositor/executor.server';
import { detectSourceKindFromUrl, hasTemporalContent } from '@/lib/nodes/plugins/compositor/shared';
import type { LayerSourceKind } from '@/lib/nodes/plugins/compositor/shared';
import type { CompositorConfig, CompositorLayer } from '@/lib/nodes/plugins/compositor/definition';

/**
 * Render the compositor server-side and stream the result back as a file
 * download. Mirrors the workflow executor's split: image-only timelines (no
 * video/audio layer, no non-default time range) render as a still image via
 * Sharp; anything temporal renders as an mp4 via ffmpeg. This keeps a
 * downloaded image-only compositor consistent with the image the workflow
 * produces, and gives image+text compositors a Download button (previously the
 * route always produced an mp4, so the UI only offered download for video).
 *
 * Body:
 *   {
 *     config: CompositorConfig,
 *     // keyed by layer.sourceHandleId → resolved URL string, OR a serialized
 *     // pull-model graph `{ graph: GraphDescription }` for live upstreams
 *     // (chained compositor, blur). Graph inputs are flattened server-side
 *     // into the same single render — no client-side chained re-renders.
 *     inputs: Record<string, string | { graph: object }>,
 *     filename?: string,                // user-friendly download name (no extension needed)
 *   }
 *
 * Renders synchronously and returns the bytes directly. `maxDuration` is
 * bumped to the Vercel Pro cap; longer timelines on Hobby plans will hit the
 * per-request execution limit before this matters.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;

    let body: { config?: CompositorConfig; inputs?: Record<string, any>; filename?: string };
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
        const safe = (body.filename || 'compositor').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

        // Decide image vs video the same way the workflow executor does, so the
        // download matches what a Run would produce. A layer is temporal when
        // its source URL is a video/audio, or it sets a non-default time range.
        const layers = (config.layers || []) as CompositorLayer[];
        const sourceKindByLayerId: Record<string, LayerSourceKind> = {};
        for (const layer of layers) {
            const input = inputs[layer.sourceHandleId];
            if (input && typeof input === 'object' && (input as any).graph) {
                // Live-graph input (chained compositor / blur) — always a
                // temporal surface, same convention as the client renderers.
                sourceKindByLayerId[layer.id] = 'video';
            } else {
                sourceKindByLayerId[layer.id] =
                    typeof input === 'string' ? detectSourceKindFromUrl(input) : 'unknown';
            }
        }

        if (!hasTemporalContent(layers, sourceKindByLayerId)) {
            // Still image — Sharp composite, no ffmpeg.
            const { buffer, contentType, ext } = await renderCompositorStill(config, inputs);
            const downloadName = `${safe}-${ts}.${ext}`;
            // NextResponse's BodyInit doesn't accept Node's Buffer directly
            // (see mp4 note below); Uint8Array.from re-roots onto a plain
            // ArrayBuffer that satisfies BlobPart.
            const responseBlob = new Blob([Uint8Array.from(buffer)], { type: contentType });
            return new NextResponse(responseBlob, {
                status: 200,
                headers: {
                    'Content-Type': contentType,
                    'Content-Length': String(responseBlob.size),
                    'Content-Disposition': `attachment; filename="${downloadName}"`,
                    'Cache-Control': 'no-store',
                },
            });
        }

        const buffer = await renderCompositorVideo(config, inputs, {
            includeAudio: true,
            crf: 18,
        });

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
