// Public surface of the extract_frame plugin.
// IMPORTANT: this barrel must NOT export executor.server.ts.
// executor.server.ts imports `sharp`, which is server-only and would leak
// into the client bundle if surfaced here. Server code imports from
// './executor.server' explicitly via the server-registry barrel.
export { extractFrameSharedDef, type ExtractFrameConfig } from './definition';
export { extractFrameClientDef, default as ExtractFrameNode } from './component';
export { extractFrameClientExecutor } from './executor.client';
