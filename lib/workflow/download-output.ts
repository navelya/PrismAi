import { extractMediaUrls, isOutputEnvelope, normalizeNodeResultType } from './result-format';

export interface DownloadItem {
    /** Filename (no path), already sanitized — safe to use as a zip entry name. */
    filename: string;
    blob: Blob;
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

    const urls = extractMediaUrls(output);
    if (urls.length === 0) return [];

    const safeLabel = sanitizeLabel(label);
    const fallbackExt = extensionFromEnvelopeType(output);

    const items: DownloadItem[] = [];
    // Fetch sequentially. Browsers and servers throttle parallel fetches anyway,
    // and sequential keeps the progress counter monotonic without extra locking.
    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const ext = extensionFromUrl(url) || fallbackExt || 'bin';
        const suffix = urls.length === 1 ? '' : `-${i + 1}`;
        const filename = `${safeLabel}${suffix}.${ext}`;
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            items.push({ filename, blob });
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

function extensionFromUrl(url: string): string | null {
    const path = url.split('?')[0].split('#')[0];
    const m = path.match(/\.([a-z0-9]{1,5})$/i);
    return m ? m[1].toLowerCase() : null;
}

function extensionFromEnvelopeType(output: any): string | null {
    if (!isOutputEnvelope(output)) return null;
    const t = normalizeNodeResultType(output.type);
    if (t === 'image') return 'png';
    if (t === 'video') return 'mp4';
    if (t === 'audio') return 'mp3';
    if (t === '3d') return 'glb';
    return null;
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
