import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from './provider/anthropic';
import { formatRegistryContext, type RegistryContextInput } from './prompt/registry-context';
import { TOOLS } from './tools/definitions';

/**
 * One-shot model call that takes a failing add_node payload + the apply error
 * and returns a corrected payload, preserving every node id. Used by
 * applyBlueprintWithRepair to self-heal a plan build at Approve time so the user
 * never sees a build error from an approved plan.
 *
 * Returns null if the model can't produce a usable fix (the caller then falls
 * back to the original failure — never worse than before).
 */

const ADD_NODE_TOOL = TOOLS.find((t) => t.name === 'add_node') ?? null;

const REPAIR_SYSTEM = `You repair ONE add_node payload for a node-based media-workflow builder. You are given a payload that failed to apply and the exact error. Return a corrected add_node tool call that fixes ONLY what the error requires.

HARD RULES:
- Keep every node's "id" EXACTLY as given. Do NOT rename, add, or remove nodes or edges.
- Keep group_container nodes and every child's parentNode relationship intact.
- Fix node configuration so each node satisfies its schema: correct field names, required values, a valid model_id, and valid edge handle keys for the chosen model.
- Preserve the creative intent — same node types, same connections. Correct only what is invalid.
- Respond with the add_node tool only. No prose.`;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export async function requestBlueprintFix(
  blueprint: { nodes?: any[]; edges?: any[] },
  error: string,
  registry: RegistryContextInput,
): Promise<{ nodes?: any[]; edges?: any[] } | null> {
  if (!ADD_NODE_TOOL) return null;

  try {
    const resp = await getClient().messages.create({
      model: MODELS.sonnet,
      max_tokens: 4096,
      system: `${REPAIR_SYSTEM}\n\n${formatRegistryContext(registry)}`,
      tools: [ADD_NODE_TOOL as any],
      tool_choice: { type: 'tool', name: 'add_node' },
      messages: [
        {
          role: 'user',
          content:
            `This add_node payload failed to apply.\n\nERROR: ${error}\n\n` +
            `PAYLOAD:\n${JSON.stringify(blueprint).slice(0, 60000)}\n\n` +
            `Return the corrected add_node call. Keep every node id identical; fix only what the error requires.`,
        },
      ],
    });

    const toolUse = resp.content.find((c: any) => c.type === 'tool_use') as any;
    const args = toolUse?.input ?? {};
    const nodes = Array.isArray(args.nodes) ? args.nodes : [];
    const edges = Array.isArray(args.edges) ? args.edges : [];
    if (nodes.length === 0 && edges.length === 0) return null;
    return { nodes, edges };
  } catch (e) {
    console.error('[chat] blueprint repair model call failed', e);
    return null;
  }
}
