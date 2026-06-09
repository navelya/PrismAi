// Public surface of the collect plugin.
// IMPORTANT: this barrel must NOT export executor.server.ts — server code
// imports it explicitly via the server-registry barrel.
export { collectSharedDef, type CollectConfig } from './definition';
export { collectClientDef, default as CollectNode } from './component';
export { collectClientExecutor } from './executor.client';
