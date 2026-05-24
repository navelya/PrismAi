import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServiceClient } from '@/lib/supabase/service';
import { getRegistryContext } from '@/lib/chat/registry-cache';
import { buildSystemPrompt } from '@/lib/chat/prompt/system';
import { TOOLS } from '@/lib/chat/tools/definitions';
import { MODELS } from '@/lib/chat/provider/anthropic';
import { createEmptyWorkflow } from '@/lib/workflow/workflow-patch';

// @anthropic-ai/sdk pulls in node:fs transitively — must run on nodejs.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Keep the shared chat-prompt cache warm.
 *
 * The chat system prefix (tools + the stable system block: identity, rules,
 * and the global ai_models registry) is byte-identical across every user, so
 * Anthropic's org-scoped prompt cache lets the whole user base share ONE
 * cached prefix. The problem: with sporadic traffic the entry expires between
 * turns and the next request pays full uncached price ($3/Mtok on Sonnet) on
 * the entire ~10K-token prefix instead of the cached rate ($0.3/Mtok).
 *
 * This cron refreshes that entry on a schedule (paired with ttl:'1h' on the
 * cache_control breakpoint in lib/chat/prompt/system.ts) so a real user
 * essentially never eats a cold read. Cost is a few cents per run — a cached
 * read of the prefix plus one output token.
 *
 * The cache is model-scoped, so we warm every model real traffic can hit.
 * Today: paid users run on sonnet, free users on haiku (see
 * app/api/chat/stream/route.ts).
 *
 * NOT wired to Vercel cron: the Hobby plan only allows daily schedules, and a
 * daily warm is useless (cache TTL maxes at 1h). On Hobby this endpoint is
 * meant to be triggered by an external scheduler (GitHub Actions, cron-job.org,
 * Upstash) every ~30 min, or left dormant — the ttl:'1h' on the cache breakpoint
 * already keeps the prefix warm within an active conversation on its own. When
 * the project moves to Vercel Pro, add an every-30-minutes cron entry for this
 * path to vercel.json and drop the external pinger.
 */
const WARM_MODELS: Array<keyof typeof MODELS> = ['sonnet', 'haiku'];

export async function GET(request: Request) {
  // Authenticate the cron request (Vercel injects this header when CRON_SECRET is set).
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 });
  }

  try {
    const supabase = createServiceClient();
    const registry = await getRegistryContext(supabase);

    // Build the SAME system blocks a real chat turn builds. Only the cached
    // prefix (tools + the first/stable block) matters here — the dynamic
    // blocks (canvas, images, selection) render AFTER the cache breakpoint, so
    // an empty canvas produces a byte-identical cacheable prefix.
    const system = buildSystemPrompt({
      workflow: createEmptyWorkflow(),
      registry,
      attachedImageUrls: [],
      nodeRefs: [],
      characterRefs: [],
    });

    const client = new Anthropic({ apiKey });
    const warmed: Record<string, unknown> = {};

    for (const modelKey of WARM_MODELS) {
      try {
        const resp = await client.messages.create({
          model: MODELS[modelKey],
          max_tokens: 1, // we only care about processing/caching the input prefix
          system: system as any,
          tools: TOOLS as any,
          messages: [{ role: 'user', content: 'ping' }],
        });
        const u: any = resp.usage;
        warmed[modelKey] = {
          cacheRead: u.cache_read_input_tokens ?? 0,    // >0 once steady-state: cache is warm
          cacheWrite: u.cache_creation_input_tokens ?? 0, // >0 only when it had expired
          input: u.input_tokens ?? 0,
        };
      } catch (err: any) {
        warmed[modelKey] = { error: err?.message || 'warm failed' };
      }
    }

    console.log('[cron:warm-cache]', JSON.stringify(warmed));
    return NextResponse.json({ success: true, warmed });
  } catch (error: any) {
    console.error('[cron:warm-cache] failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
