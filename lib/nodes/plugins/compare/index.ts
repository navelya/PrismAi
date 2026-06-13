// Public surface of the `compare` plugin.
// IMPORTANT: this barrel must NOT export executor.server.ts — server-only code
// stays out of the client bundle. The server registry imports it explicitly.
export { compareSharedDef, type CompareConfig } from './definition';
export { compareClientDef, default as CompareNode } from './component';
export { compareClientExecutor } from './executor.client';
