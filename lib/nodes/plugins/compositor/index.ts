// Public surface of the compositor plugin.
// IMPORTANT: this barrel must NOT export executor.server.ts (server-only).
export {
    compositorSharedDef,
    type CompositorConfig,
    type CompositorLayer,
    type LayerTransform,
    calculateInitialTransform,
} from './definition';
export { compositorClientDef, default as CompositorNode } from './component';
export { compositorClientExecutor } from './executor.client';
