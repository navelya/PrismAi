// Public surface of the blur plugin.
// IMPORTANT: this barrel must NOT export executor.server.ts.
// executor.server.ts imports `sharp`, which is server-only and would leak
// into the client bundle if surfaced here. Server code imports from
// './executor.server' explicitly via the server-registry barrel.
export { blurSharedDef, type BlurConfig } from './definition';
export { blurClientDef, default as BlurNode } from './component';
export { blurClientExecutor } from './executor.client';
