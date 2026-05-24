import Anthropic from '@anthropic-ai/sdk';
import type { SystemBlock } from '../prompt/system';
import type { AnthropicTool } from '../tools/definitions';

export const MODELS = {
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
} as const;

const MAX_TOKENS = 8192;
const THINKING_BUDGET = 2500;

// Per-model pricing (USD per Mtok).
// Update if Anthropic changes pricing; only used for the usage event so
// downstream cost UI (sub-project C) doesn't have to recompute.
const INPUT_PRICE_PER_MTOK: Record<keyof typeof MODELS, number> = { haiku: 1, sonnet: 3 };
const OUTPUT_PRICE_PER_MTOK: Record<keyof typeof MODELS, number> = { haiku: 5, sonnet: 15 };
const CACHE_READ_PRICE_PER_MTOK: Record<keyof typeof MODELS, number> = { haiku: 0.1, sonnet: 0.3 };
// Cache WRITES are billed at 1.25x the base input price for the default
// 5-minute (ephemeral) TTL. If we ever switch a breakpoint to ttl:"1h",
// that slice writes at 2x — split this into two rates at that point.
const CACHE_WRITE_PRICE_PER_MTOK: Record<keyof typeof MODELS, number> = { haiku: 1.25, sonnet: 3.75 };

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
  | { kind: 'tool_start'; id: string; name: string }
  | { kind: 'tool_call'; id: string; name: string; args: any }
  | { kind: 'turn_end'; assistantContent: Anthropic.ContentBlock[]; stopReason: string | null }
  | { kind: 'usage'; inputTokens: number; outputTokens: number; thinkingTokens: number; cacheReadTokens: number; costUsd: number };

export interface StreamArgs {
  system: SystemBlock[];
  /**
   * Pre-built Anthropic message array. The brain converts its ChatTurn[]
   * once via toAnthropicMessages and then appends assistant + tool_result
   * messages across continuation iterations.
   */
  messages: Anthropic.MessageParam[];
  tools: AnthropicTool[];
  /**
   * Disable extended thinking for this turn. Used by the brain to make
   * trivial messages ("hi", short Q&A, simple updates) respond instantly
   * without the ~700ms thinking floor. Continuation iterations also set
   * this true — thinking belongs on iteration 1 only.
   */
  disableThinking?: boolean;
  /** Which Claude model to use. Defaults to 'sonnet'. */
  model?: keyof typeof MODELS;
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

export function toAnthropicMessages(turns: ChatTurn[]): Anthropic.MessageParam[] {
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
 * Stream a Claude turn (Haiku 4.5 or Sonnet 4.6) with optional extended thinking.
 * Yields normalized ProviderEvents. Caller (brain.ts) maps these into
 * NDJSON StreamEvents.
 */
export async function* streamAnthropicTurn(args: StreamArgs): AsyncGenerator<ProviderEvent> {
  const c = getClient();
  const modelKey: keyof typeof MODELS = args.model ?? 'sonnet';

  const thinking = args.disableThinking
    ? { type: 'disabled' as const }
    : { type: 'enabled' as const, budget_tokens: THINKING_BUDGET };

  const stream = c.messages.stream({
    model: MODELS[modelKey],
    max_tokens: MAX_TOKENS,
    thinking,
    system: args.system as any,
    tools: args.tools as any,
    messages: args.messages
  });

  /**
   * Per-block accumulator: index → { type, name?, id?, jsonBuffer }
   * Tool calls arrive as input_json_delta strings; we concatenate then
   * JSON.parse on content_block_stop. The id is needed so the brain can
   * pair tool_use blocks with their tool_result on the next iteration.
   */
  const blockState = new Map<number, { type: string; name?: string; id?: string; jsonBuffer: string }>();

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
        blockState.set(idx, { type: 'tool_use', name: block.name, id: block.id, jsonBuffer: '' });
        yield { kind: 'tool_start', id: block.id, name: block.name };
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
      } else if (state.type === 'tool_use' && state.name && state.id) {
        let parsed: any = {};
        try {
          parsed = state.jsonBuffer ? JSON.parse(state.jsonBuffer) : {};
        } catch (err) {
          parsed = { __json_parse_error: String(err) };
        }
        yield { kind: 'tool_call', id: state.id, name: state.name, args: parsed };
      }

      blockState.delete(idx);
    }
  }

  const final = await stream.finalMessage();
  // Yield the full assistant content (thinking + text + tool_use blocks)
  // so the brain can echo it back verbatim on continuation iterations.
  // Signatures on thinking blocks are preserved by passing final.content
  // through without modification.
  yield { kind: 'turn_end', assistantContent: final.content, stopReason: final.stop_reason };

  const usage = final.usage;
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheReadTokens = (usage as any).cache_read_input_tokens ?? 0;
  // Tokens written to the cache this call (cold write). Billed at 1.25x
  // input. Reported separately from input_tokens, so omitting it under-bills
  // exactly the cold-prefix turns we most want to see.
  const cacheWriteTokens = (usage as any).cache_creation_input_tokens ?? 0;
  // Anthropic counts thinking inside output_tokens. We don't get a separate
  // count from the API for thinking-only — we report 0 unless future SDK
  // versions expose it. The cost calc is still accurate.
  const thinkingTokens = 0;

  // Anthropic reports input_tokens as the *uncached, non-cached-write*
  // portion only; cache_read_input_tokens (billed 0.1x) and
  // cache_creation_input_tokens (billed 1.25x) are reported separately.
  // Sum all four terms — do NOT subtract anything from inputTokens.
  const costUsd =
    (inputTokens * INPUT_PRICE_PER_MTOK[modelKey]) / 1_000_000 +
    (cacheReadTokens * CACHE_READ_PRICE_PER_MTOK[modelKey]) / 1_000_000 +
    (cacheWriteTokens * CACHE_WRITE_PRICE_PER_MTOK[modelKey]) / 1_000_000 +
    (outputTokens * OUTPUT_PRICE_PER_MTOK[modelKey]) / 1_000_000;

  // ── Cache measurement (D1) ──────────────────────────────────────────────
  // One structured line per real Anthropic call. Grep "[chat:cache]" in logs.
  // prefixTokens = the whole cacheable prefix this call processed, however it
  // was billed. hitRate = fraction served from cache. coldWrite = this call
  // paid to (re)build the cache (TTL expiry, registry change, or first use).
  const prefixTokens = inputTokens + cacheReadTokens + cacheWriteTokens;
  const hitRate = prefixTokens > 0 ? cacheReadTokens / prefixTokens : 0;
  console.log('[chat:cache]', JSON.stringify({
    model: MODELS[modelKey],
    thinking: !args.disableThinking,
    inputTokens,        // uncached, full price
    cacheReadTokens,    // served from cache, 0.1x
    cacheWriteTokens,   // cold write, 1.25x
    prefixTokens,
    outputTokens,
    hitRate: Number(hitRate.toFixed(3)),
    coldWrite: cacheWriteTokens > 0,
    costUsd: Number(costUsd.toFixed(6)),
  }));

  yield {
    kind: 'usage',
    inputTokens,
    outputTokens,
    thinkingTokens,
    cacheReadTokens,
    costUsd: Number(costUsd.toFixed(6))
  };
}
