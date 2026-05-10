// Public surface of the ai_generator plugin.
// IMPORTANT: this barrel must NOT export executor.server.ts.
// executor.server.ts uses the Replicate API and Supabase service client,
// which are server-only and would break the client bundle if surfaced here.
// Server code imports from './executor.server' explicitly via the server-registry.
export { aiGeneratorSharedDef, type AIGeneratorConfig } from './definition';
export { default as AIGeneratorNode, aiGeneratorClientDef } from './component';
export { default as AIGeneratorProperties } from './properties';
