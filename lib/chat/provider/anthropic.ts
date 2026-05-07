import Anthropic from '@anthropic-ai/sdk';
import type { SystemBlock } from '../prompt/system';
import type { AnthropicTool } from '../tools/definitions';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 8192;
const THINKING_BUDGET = 2500;

// Sonnet 4.6 published pricing (USD per Mtok).
// Update if Anthropic changes pricing; only used for the usage event so
// downstream cost UI (sub-project C) doesn't have to recompute.
const PRICE_INPUT_PER_MTOK = 3;
const PRICE_OUTPUT_PER_MTOK = 15;
const PRICE_CACHE_READ_PER_MTOK = 0.3;

export interface ImageAttachment {
  /** base64 payload WITHOUT the "data:image/...;base64," prefix */
  data: string;
  mediaType: 'image/webp' | 'image/png' | 'image/jpeg' | 'image/gif';
}

export interface UserTurn {
  role: 'user';
  text: string;
  images?: ImageAttachment[];
}

export interface AssistantTurn {
  role: 'assistant';
  text: string;
}

export type ChatTurn = UserTurn | AssistantTurn;

export type ProviderEvent =
  | { kind: 'thinking_start' }
  | { kind: 'thinking_delta'; text: string }
  | { kind: 'thinking_end' }
  | { kind: 'text_delta'; text: string }
  | { kind: 'tool_call'; name: string; args: any }
  | { kind: 'usage'; inputTokens: number; outputTokens: number; thinkingTokens: number; cacheReadTokens: number; costUsd: number };

export interface StreamArgs {
  system: SystemBlock[];
  messages: ChatTurn[];
  tools: AnthropicTool[];
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set.');
    client = new Anthropic({ apiKey });
  }
  return client;
}

function toAnthropicMessages(turns: ChatTurn[]): Anthropic.MessageParam[] {
  return turns.map(turn => {
    if (turn.role === 'assistant') {
      return { role: 'assistant', content: turn.text };
    }
    const blocks: Anthropic.ContentBlockParam[] = [];
    for (const img of turn.images ?? []) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.data }
      });
    }
    blocks.push({ type: 'text', text: turn.text });
    return { role: 'user', content: blocks };
  });
}

/**
 * Stream a Claude Sonnet 4.6 turn with extended thinking enabled.
 * Yields normalized ProviderEvents. Caller (brain.ts) maps these into
 * NDJSON StreamEvents.
 */
export async function* streamAnthropicTurn(args: StreamArgs): AsyncGenerator<ProviderEvent> {
  const c = getClient();

  const stream = c.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'enabled', budget_tokens: THINKING_BUDGET },
    system: args.system as any,
    tools: args.tools as any,
    messages: toAnthropicMessages(args.messages)
  });

  /**
   * Per-block accumulator: index → { type, name?, jsonBuffer }
   * Tool calls arrive as input_json_delta strings; we concatenate then
   * JSON.parse on content_block_stop.
   */
  const blockState = new Map<number, { type: string; name?: string; jsonBuffer: string }>();

  for await (const event of stream) {
    if (event.type === 'content_block_start') {
      const block = event.content_block;
      const idx = event.index;

      if (block.type === 'thinking') {
        blockState.set(idx, { type: 'thinking', jsonBuffer: '' });
        yield { kind: 'thinking_start' };
      } else if (block.type === 'text') {
        blockState.set(idx, { type: 'text', jsonBuffer: '' });
      } else if (block.type === 'tool_use') {
        blockState.set(idx, { type: 'tool_use', name: block.name, jsonBuffer: '' });
      }
    } else if (event.type === 'content_block_delta') {
      const idx = event.index;
      const state = blockState.get(idx);
      if (!state) continue;

      const delta = event.delta;
      if (delta.type === 'thinking_delta') {
        yield { kind: 'thinking_delta', text: delta.thinking };
      } else if (delta.type === 'text_delta') {
        yield { kind: 'text_delta', text: delta.text };
      } else if (delta.type === 'input_json_delta') {
        state.jsonBuffer += delta.partial_json;
      }
    } else if (event.type === 'content_block_stop') {
      const idx = event.index;
      const state = blockState.get(idx);
      if (!state) continue;

      if (state.type === 'thinking') {
        yield { kind: 'thinking_end' };
      } else if (state.type === 'tool_use' && state.name) {
        let parsed: any = {};
        try {
          parsed = state.jsonBuffer ? JSON.parse(state.jsonBuffer) : {};
        } catch (err) {
          parsed = { __json_parse_error: String(err) };
        }
        yield { kind: 'tool_call', name: state.name, args: parsed };
      }

      blockState.delete(idx);
    }
  }

  const final = await stream.finalMessage();
  const usage = final.usage;
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheReadTokens = (usage as any).cache_read_input_tokens ?? 0;
  // Anthropic counts thinking inside output_tokens. We don't get a separate
  // count from the API for thinking-only — we report 0 unless future SDK
  // versions expose it. The cost calc is still accurate.
  const thinkingTokens = 0;

  const costUsd =
    ((inputTokens - cacheReadTokens) * PRICE_INPUT_PER_MTOK) / 1_000_000 +
    (cacheReadTokens * PRICE_CACHE_READ_PER_MTOK) / 1_000_000 +
    (outputTokens * PRICE_OUTPUT_PER_MTOK) / 1_000_000;

  yield {
    kind: 'usage',
    inputTokens,
    outputTokens,
    thinkingTokens,
    cacheReadTokens,
    costUsd: Number(costUsd.toFixed(6))
  };
}
