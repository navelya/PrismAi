import type { DownloadItem } from './download-output';

/**
 * Per-instance download override registry.
 *
 * Default behavior for any node is "extract media URLs from nodeOutputs[id]
 * and fetch them as blobs" (see download-output.ts). A node type that needs
 * to produce a different artifact — e.g. compositor's server-side ffmpeg
 * export, which yields a re-rendered mp4 instead of the cached preview frame —
 * can register an imperative handler from its component (in a useEffect) and
 * unregister on unmount.
 *
 * Stored as a module-level Map rather than in Zustand because the value is a
 * non-serializable function closure that depends on the component's resolved
 * hooks state. Lookup is by node id and doesn't need to trigger re-renders.
 *
 * Handlers return one or more {filename, blob} pairs, which the bulk-download
 * orchestrator zips together with everything else. Handlers should throw on
 * failure so Promise.allSettled in the orchestrator can count accurately.
 */
export type DownloadCollector = () => Promise<DownloadItem[]>;

const handlers = new Map<string, DownloadCollector>();

export function registerDownloadHandler(nodeId: string, fn: DownloadCollector): void {
    handlers.set(nodeId, fn);
}

export function unregisterDownloadHandler(nodeId: string): void {
    handlers.delete(nodeId);
}

export function getDownloadHandler(nodeId: string): DownloadCollector | undefined {
    return handlers.get(nodeId);
}
