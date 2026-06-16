import { coerceResultDataArray, extractMediaUrls, isOutputEnvelope, normalizeNodeResultType } from './result-format';
import { extFromUrl, extForContentType, defaultExtForType } from '@/lib/workflow/media-formats';
import { graphDimensions } from '@/lib/nodes/plugins/compositor/shared';

export interface DownloadItem {
    /** Filename (no path), already sanitized — safe to use as a zip entry name. */
    filename: string;
    blob: Blob;
}

/**
 * Pull-model live-signal items publish `url: ''` alongside a serializable
 * `graph` (a compositor/blur/filter GraphDescription) — there's no rendered
 * file until the user downloads. Collect those graphs so any node carrying
 * one (NOT just the compositor) is downloadable via the shared export route.
 */
function extractGraphs(output: any): any[] {
    if (!isOutputEnvelope(output)) return [];
    const graphs: any[] = [];
    for (const item of coerceResultDataArray(output.data)) {
        if (item && typeof item === 'object' && (item as any).graph) {
            graphs.push((item as any).graph);
        }
    }
    return graphs;
}

/**
 * Render a live graph to an mp4 Blob via the shared compositor export route.
 * This is what makes blur (and every future live filter node) downloadable
 * with zero per-node wiring — the route flattens the graph server-side into
 * one ffmpeg pass, so there's no client-side chained re-render.
 */
async function renderGraphToBlob(graph: any, filename: string): Promise<Blob | null> {
    try {
        // graphDimensions descends through filter wrappers to the real base
        // canvas size, so a portrait/4K source isn't squashed into 1920×1080.
        const { width, height } = graphDimensions(graph);
        const resp = await fetch('/api/compositor/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                // The route renders a graph passed as a single synthetic
                // full-bleed layer: a 1-layer compositor whose only input is
                // the graph. Reuses the existing inputs map machinery.
                config: {
                    canvasWidth: width,
                    canvasHeight: height,
                    backgroundColor: '#000000',
                    // A graph input is always temporal → the route renders mp4
                    // (outputFormat is only consulted on the still path, which
                    // a graph never takes). 'mp4' for honesty, not effect.
                    outputFormat: 'mp4',
                    outputQuality: 1.0,
                    fps: 30,
                    timelineDuration: null,
                    layers: [{
                        id: '__graph_dl__',
                        name: filename,
                        sourceHandleId: '__graph_dl__',
                        selectedIndex: 0,
                        transform: {
                            x: 0, y: 0, width, height,
                            rotation: 0, opacity: 1, flipX: false, flipY: false,
                            // isAutoCentered:false → the server's single-layer
                            // auto-fit resizes the canvas to the source's TRUE
                            // resolution (the graph's declared dims can be a
                            // 1920x1080 placeholder from a URL-wrap), so a
                            // direct blur download isn't capped below source res.
                            isAutoCentered: false, crop: null,
                        },
                        visible: true, locked: false,
                        startTime: 0, duration: null, trimIn: 0, trimOut: null,
                        speed: 1, muted: false, transition: { type: 'none', duration: 0 },
                    }],
                },
                inputs: { __graph_dl__: { graph } },
                filename,
            }),
        });
        if (!resp.ok) {
            console.error('[renderGraphToBlob] export failed', resp.status, await resp.text().catch(() => ''));
            return null;
        }
        return await resp.blob();
    } catch (err) {
        console.error('[renderGraphToBlob] export error', err);
        return null;
    }
}

/**
 * Walk a node's output envelope and return one downloadable Blob per media
 * item it contains. Text and JSON envelopes are intentionally skipped — the
 * bulk-download flow targets media only (images, video, audio, 3D assets).
 *
 * The caller can pass an `onUnit` callback that is invoked once per URL after
 * the fetch resolves (success OR failure), so the orchestrator can drive a
 * deterministic progress bar without knowing per-node internals.
 *
 * Filenames are derived from the node label, suffixed with an index when the
 * node outputs multiple items, and use the URL's extension (falling back to a
 * sensible default per envelope type).
 */
export async function collectNodeMediaBlobs(
    output: any,
    label: string,
    onUnit?: () => void,
): Promise<DownloadItem[]> {
    if (output === null || output === undefined) return [];

    const safeLabel = sanitizeLabel(label);

    // Live-graph items first: a blur (or future filter node) wrapping a
    // compositor publishes a `graph` with no URL. Render each via the shared
    // export route so it's downloadable without a per-node handler.
    const graphs = extractGraphs(output);
    if (graphs.length > 0) {
        const items: DownloadItem[] = [];
        for (let i = 0; i < graphs.length; i++) {
            const suffix = graphs.length === 1 ? '' : `-${i + 1}`;
            const filename = `${safeLabel}${suffix}.mp4`;
            try {
                const blob = await renderGraphToBlob(graphs[i], `${safeLabel}${suffix}`);
                if (blob) items.push({ filename, blob });
            } finally {
                onUnit?.();
            }
        }
        // Fall through to also collect any plain media URLs in the same
        // envelope (mixed envelopes are rare but cheap to handle).
        const urls = extractMediaUrls(output);
        if (urls.length === 0) return items;
        const fallbackExt = isOutputEnvelope(output)
          ? defaultExtForType(normalizeNodeResultType(output.type))
          : 'mp4';
        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            try {
                const resp = await fetch(url);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const blob = await resp.blob();
                const ext = extFromUrl(url) || extForContentType(blob.type) || fallbackExt;
                items.push({ filename: `${safeLabel}-${i + 1}.${ext}`, blob });
            } catch (err) {
                console.error('[collectNodeMediaBlobs] fetch failed', url, err);
            } finally {
                onUnit?.();
            }
        }
        return items;
    }

    const urls = extractMediaUrls(output);
    if (urls.length === 0) return [];
    const fallbackExt = isOutputEnvelope(output)
      ? defaultExtForType(normalizeNodeResultType(output.type))
      : null;

    const items: DownloadItem[] = [];
    // Fetch sequentially. Browsers and servers throttle parallel fetches anyway,
    // and sequential keeps the progress counter monotonic without extra locking.
    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const suffix = urls.length === 1 ? '' : `-${i + 1}`;
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            const ext = extFromUrl(url) || extForContentType(blob.type) || fallbackExt || 'bin';
            items.push({ filename: `${safeLabel}${suffix}.${ext}`, blob });
        } catch (err) {
            // CORS or network failure on a single URL — log and skip. The zip
            // gets whatever could be fetched; the orchestrator's toast reports
            // partial counts.
            console.error('[collectNodeMediaBlobs] fetch failed', url, err);
        } finally {
            onUnit?.();
        }
    }
    return items;
}

function sanitizeLabel(label: string): string {
    const cleaned = (label || '').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '');
    return cleaned.slice(0, 64) || 'node';
}

/**
 * Trigger a browser save dialog for a single Blob. Used by the bulk-download
 * flow to deliver the final zip; not part of the per-node collection path.
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Firefox cancels the download if the URL is revoked too eagerly.
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Fetch a single hosted result and save it AS-IS with the correct extension.
 * Type-agnostic: image / svg / video / audio / 3d all flow through identically.
 * Extension resolves from the URL, then the blob's content-type, then 'bin'.
 * On failure, falls back to opening the URL in a new tab.
 */
export async function downloadUrlAsFile(url: string, baseName: string): Promise<void> {
    const safe = sanitizeLabel(baseName);
    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const ext = extFromUrl(url) || extForContentType(blob.type) || 'bin';
        triggerBlobDownload(blob, `${safe}.${ext}`);
    } catch (err) {
        console.error('[downloadUrlAsFile] failed, opening in new tab', url, err);
        if (typeof window !== 'undefined') window.open(url, '_blank');
    }
}
