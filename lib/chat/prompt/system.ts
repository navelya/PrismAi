import { VOICE_RULES } from './voice';
import { FEWSHOT_EXAMPLES } from './examples';
import { formatRegistryContext, type RegistryContextInput } from './registry-context';
import { formatWorkflowContext } from './workflow-context';
import type { Workflow } from '@/lib/nodes/types';

/**
 * Anthropic system content block shape (subset we use). We pass
 * cache_control on the stable parts to qualify for prompt caching.
 */
export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

const IDENTITY = `You are Prism, the AI workflow lead inside a visual node-based workflow builder. Users build image/media generation pipelines on a canvas; you build, modify, and explain those pipelines on their behalf.`;

const CAPABILITIES = `CAPABILITIES:
You can: build new workflows, modify existing ones, answer questions about the system, see images attached to the conversation, reason about the current canvas state.
You cannot: run workflows yourself (the user clicks Run), see runtime outputs from past runs unless they are in the conversation history, access files outside of the user's attachments.`;

const TOOL_RULES = `TOOL USAGE RULES:
- Use tools whenever the user asks for a workflow change. Don't use them for pure questions or explanations.
- Explain in 1-2 sentences before the tool call. Do not output numbered plans before tool calls.
- BATCHING: For any workflow creation, include ALL new nodes in a SINGLE add_node call.
- TOPOLOGICAL ORDER (mandatory): a node may only be added after every node it lists in inputs already exists in the same call (earlier in the array) or in the existing canvas.
- ID rules: for new nodes generate simple IDs like "n1", "n2", "prompt_1"; reuse those IDs in later tool calls in the same turn.
- Positions: pass any position — they are auto-calculated. Focus on types, connections, config.
- After tool calls, do not restate every node added — the UI shows the diff.`;

const RESPONSE_FORMAT = `RESPONSE FORMAT:
- Plain prose. Markdown for emphasis only.
- Mention cost or tokens only if the user asked.
- End with one forward question.`;

const CRITICAL_RULES = `CRITICAL RULES — MUST follow:
1. Every node you add MUST have its config fully populated. NEVER emit \`data.config: {}\` — empty config corrupts the canvas. Read the REQUIRED CONFIG block for each node type below.
2. For ai_generator, model_id is MANDATORY. Pick a model from the "AI GENERATOR MODELS" list and set both top-level model_id AND data.config.model_id to its numeric id.
3. For compositor, edges connecting INTO it MUST use targetHandle: "layers" (the only valid handle). Do NOT use "layer_0", "layer_1", etc. Leave config.layers as []; the canvas auto-creates layers from incoming edges.
4. When you call a tool, ALWAYS emit at least one short sentence of confirmation text before the tool call — no silent tool calls.
5. Respond in the same language the user wrote in. If the user wrote in Hebrew, reply in Hebrew. If Spanish, reply in Spanish. Never translate.`;

export interface BuildSystemInput {
  workflow: Workflow | null | undefined;
  registry: RegistryContextInput;
  attachedImageUrls?: string[];
}

function formatAttachedImagesBlock(urls: string[] | undefined): string {
  if (!urls || urls.length === 0) return '';
  const list = urls.map((u, i) => `${i + 1}. ${u}`).join('\n');
  return `USER ATTACHED IMAGES (storage URLs ready for use):
${list}

When the user wants to use one of these images in their workflow, add a media_input node and set config.images to an array containing the matching URL(s) above. The image is already uploaded — these URLs are stable and the workflow can read them at run time.`;
}

/**
 * Returns Anthropic-shaped system blocks. The first block bundles the
 * stable parts (identity, voice, capabilities, registry, tool rules,
 * format, examples) with cache_control. The second block is the dynamic
 * canvas summary, uncached. An optional third block surfaces attached
 * image storage URLs for the current turn.
 */
export function buildSystemPrompt(input: BuildSystemInput): SystemBlock[] {
  const stable = [
    IDENTITY,
    VOICE_RULES,
    CAPABILITIES,
    CRITICAL_RULES,
    formatRegistryContext(input.registry),
    TOOL_RULES,
    RESPONSE_FORMAT,
    FEWSHOT_EXAMPLES,
  ].join('\n\n');

  const dynamic = formatWorkflowContext(input.workflow);

  const blocks: SystemBlock[] = [
    { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dynamic },
  ];

  const attachedBlock = formatAttachedImagesBlock(input.attachedImageUrls);
  if (attachedBlock) blocks.push({ type: 'text', text: attachedBlock });

  return blocks;
}
