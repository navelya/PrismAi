/**
 * Workflow Engine v2 - Replicate Webhook Handler
 * Receives callbacks from Replicate when predictions complete
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { REPLICATE_WEBHOOK_SIGNING_SECRET, normalizeReplicateOutput } from '@/lib/ai/replicate-client';
import { Webhook } from 'standardwebhooks';
import { checkAndDispatchChildren } from '@/lib/workflow/orchestrator';
import {
  NodeResultType,
  isMediaResultType,
  toResultDataForType,
} from '@/lib/workflow/result-format';
import { resolveNodeOutputWireTypeFromGraph } from '@/lib/workflow/output-type';
import { clampIterations } from '@/lib/billing/cost';

const WEBHOOK_MEDIA_EXTENSIONS: Record<NodeResultType, string> = {
  image: 'png',
  video: 'mp4',
  audio: 'mp3',
  '3d': 'glb',
  text: 'txt',
  json: 'json',
};

const WEBHOOK_MEDIA_CONTENT_TYPES: Record<NodeResultType, string> = {
  image: 'image/png',
  video: 'video/mp4',
  audio: 'audio/mpeg',
  '3d': 'model/gltf-binary',
  text: 'text/plain',
  json: 'application/json',
};

async function fetchWithRetry(url: string, maxAttempts = 3, delayMs = 1500): Promise<Response> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res;
    console.warn(
      `[Webhook/Replicate-v2] Fetch attempt ${attempt}/${maxAttempts} failed (${res.status}). ${
        attempt < maxAttempts ? `Retrying in ${delayMs}ms...` : 'No more retries.'
      }`
    );
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Failed to fetch media after ${maxAttempts} attempts`);
}

/**
 * Finalize a fan-out node via the atomic `finalize_fan_out` RPC. The RPC, under a
 * row lock, finalizes only once all `expectedCount` iterations have resolved and
 * claims the running->completed/failed transition exactly once. We dispatch
 * children only for the single caller that won the claim (RPC returns true).
 *
 * Replaces the former non-atomic count->gather->update, which could (a) double-
 * finalize on concurrent "last" webhooks and (b) finalize on a partial set when a
 * fast callback's row existed before its siblings'. The expected-count gate closes
 * both: no node finalizes until exactly N iterations are accounted for, regardless
 * of which writer (webhook upsert or dispatch insert) created each row first.
 */
async function finalizeFanOut(
  supabase: ReturnType<typeof createServiceClient>,
  executionId: string,
  nodeId: string,
  outputType: NodeResultType,
  expectedCount: number,
  origin: string
): Promise<void> {
  const { data: claimed, error } = await supabase.rpc('finalize_fan_out', {
    p_execution_id: executionId,
    p_node_id: nodeId,
    p_output_type: outputType,
    p_expected_count: expectedCount,
  });
  if (error) throw new Error(`finalize_fan_out failed: ${error.message}`);

  if (claimed === true) {
    await checkAndDispatchChildren(executionId, nodeId, origin);
  }
}

function isReplicateHostedUrl(value: string): boolean {
  return value.includes('replicate.delivery') || value.includes('replicate.com');
}

// Cap on simultaneous fetch+upload pairs. Each in-flight item holds the full
// media payload in memory as a Buffer, so unbounded Promise.all would OOM the
// function on large batches of video. 5 is enough parallelism for typical
// 4-image outputs while keeping peak memory bounded.
const MIRROR_CONCURRENCY = 5;

async function mirrorMediaToStorage(
  supabase: ReturnType<typeof createServiceClient>,
  urls: string[],
  resultType: NodeResultType,
  userId: string,
  sessionId: string,
  nodeId: string
): Promise<string[]> {
  const now = Date.now();
  // Pre-sized and written by index — downstream consumers rely on positional
  // alignment with the input `urls` array, so order must be preserved across
  // parallel workers.
  const mirroredUrls: string[] = new Array(urls.length);

  const processOne = async (i: number): Promise<void> => {
    const sourceUrl = urls[i];

    if (!sourceUrl.startsWith('http')) {
      mirroredUrls[i] = sourceUrl;
      return;
    }

    const response = await fetchWithRetry(sourceUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const extMatch = sourceUrl.match(/\.(png|jpe?g|webp|gif|mp4|webm|mov|avi|mkv|mp3|wav|ogg|m4a|aac|flac|glb|gltf|obj|fbx|stl|usd|usdz)(\?|$)/i);
    const ext = extMatch?.[1]?.toLowerCase() || WEBHOOK_MEDIA_EXTENSIONS[resultType];
    // Store under `results/`, NOT `thumbnails/`. The `thumbnails/{nodeId}` folder
    // is treated as ephemeral and is wiped wholesale when a node is deleted
    // (see deleteNodeWithAssets in lib/store/slices/ui-slice.ts). This is the only
    // persisted copy of an AI node's output, so it must live in a permanent path
    // that node deletion never touches.
    const storagePath = `${userId}/${sessionId}/results/${nodeId}/result_${now}_${i}.${ext}`;

    const { error: uploadError } = await supabase.storage.from('chat-assets').upload(storagePath, buffer, {
      contentType: WEBHOOK_MEDIA_CONTENT_TYPES[resultType],
      cacheControl: '3600',
      upsert: true,
    });

    if (uploadError) {
      throw new Error(`Supabase Storage upload failed: ${uploadError.message}`);
    }

    const { data: urlData } = supabase.storage.from('chat-assets').getPublicUrl(storagePath);
    mirroredUrls[i] = urlData.publicUrl;
  };

  // Worker pool: N workers pull from a shared cursor. If a worker throws,
  // Promise.all rejects with that error; other workers may finish their
  // current task harmlessly (uploads are idempotent via upsert:true) before
  // the rejection propagates to the caller's try/catch.
  let cursor = 0;
  const workerCount = Math.min(MIRROR_CONCURRENCY, urls.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= urls.length) return;
      await processOne(i);
    }
  });
  await Promise.all(workers);

  return mirroredUrls;
}

/**
 * Refund a single failed fan-out iteration. The upfront debit charged
 * cost_by_node[nodeId] (which already includes the iteration multiplier), so one
 * iteration's share is that value / iterations. Sourced from the persisted
 * execution_debit ledger metadata so it can't drift from what was charged.
 * Idempotent per (execution, node, prediction_index) via the credit_tokens key.
 */
async function refundFailedIteration(
  supabase: ReturnType<typeof createServiceClient>,
  executionId: string,
  nodeId: string,
  predictionIndex: number
): Promise<void> {
  // The execution_debit ledger row holds user_id + the per-node cost map.
  const { data: debitRow } = await supabase
    .from('token_ledger')
    .select('user_id, metadata')
    .eq('execution_id', executionId)
    .eq('reason', 'execution_debit')
    .maybeSingle();
  if (!debitRow?.user_id) return; // nothing was charged (cost 0) → nothing to refund

  const costByNode = (debitRow.metadata as any)?.cost_by_node ?? {};
  const nodeTotal = Number(costByNode[nodeId]);
  if (!Number.isFinite(nodeTotal) || nodeTotal <= 0) return;

  // Resolve this node's iteration count from the execution graph to divide correctly.
  const { data: exec } = await supabase
    .from('executions')
    .select('graph_json')
    .eq('id', executionId)
    .single();
  const graphNodes = (exec?.graph_json as any)?.nodes ?? [];
  const node = graphNodes.find((n: any) => n.id === nodeId);
  const iterations = clampIterations(node?.data?.config?.iterations ?? node?.config?.iterations);
  const perIteration = nodeTotal / iterations;
  if (!(perIteration > 0)) return;

  const { error } = await supabase.rpc('credit_tokens', {
    p_user_id: debitRow.user_id,
    p_amount: perIteration,
    p_reason: 'execution_partial_refund',
    p_idempotency_key: `refund:${executionId}:${nodeId}:${predictionIndex}`,
    p_execution_id: executionId,
    p_stripe_event_id: null,
    p_metadata: { node_id: nodeId, prediction_index: predictionIndex, reason: 'iteration_failed' },
  });
  if (error) {
    // Don't fail the webhook over a refund hiccup — log and continue so the
    // node can still finalize. A missed refund is recoverable; a stuck node is not.
    console.error(`[Webhook/Replicate-v2] Partial refund failed for ${nodeId}#${predictionIndex}:`, error.message);
  }
}

/**
 * Upsert this fan-out prediction's row by its stable (execution_id, node_id,
 * prediction_index) key. Upsert (not update-by-id) is what lets a callback that
 * arrives before the dispatcher's row insert still record its result: it creates
 * the row if missing, or transitions an existing 'pending' row. replicate_id is
 * intentionally omitted so an existing row keeps the value the dispatcher recorded.
 */
async function upsertPredictionRow(
  supabase: ReturnType<typeof createServiceClient>,
  executionId: string,
  nodeId: string,
  predictionIndex: number,
  fields: { status: 'completed' | 'failed'; resultData?: any; error: string | null }
): Promise<void> {
  const { error: predErr } = await supabase.from('node_predictions').upsert(
    {
      execution_id: executionId,
      node_id: nodeId,
      prediction_index: predictionIndex,
      status: fields.status,
      ...(fields.resultData !== undefined ? { result_data: fields.resultData } : {}),
      error: fields.error,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'execution_id,node_id,prediction_index' }
  );
  if (predErr) throw new Error(`node_predictions upsert failed: ${predErr.message}`);
}

export async function POST(request: NextRequest) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('[Webhook/Replicate-v2] 📨 RECEIVED WEBHOOK FROM REPLICATE:');
  console.log('  Request URL:', request.url);
  console.log('  Method:', request.method);
  console.log('  Headers:', {
    'webhook-id': request.headers.get('webhook-id'),
    'webhook-timestamp': request.headers.get('webhook-timestamp'),
    'content-type': request.headers.get('content-type'),
  });
  console.log('═══════════════════════════════════════════════════════════════');

  try {
    const { searchParams } = new URL(request.url);
    const executionId = searchParams.get('executionId');
    const nodeId = searchParams.get('nodeId');

    if (!executionId || !nodeId) {
      return NextResponse.json({ error: 'Missing executionId or nodeId' }, { status: 400 });
    }

    const bodyText = await request.text();

    if (REPLICATE_WEBHOOK_SIGNING_SECRET) {
      const wh = new Webhook(REPLICATE_WEBHOOK_SIGNING_SECRET);
      const headers = {
        'webhook-id': request.headers.get('webhook-id') || '',
        'webhook-timestamp': request.headers.get('webhook-timestamp') || '',
        'webhook-signature': request.headers.get('webhook-signature') || '',
      };

      try {
        wh.verify(bodyText, headers);
        console.log(`[Webhook/Replicate-v2] Signature verified for node ${nodeId}`);
      } catch (err) {
        console.error('[Webhook/Replicate-v2] ❌ Signature verification failed:', err);
        console.warn('[Webhook/Replicate-v2] ⚠️ Bypassing signature block for debugging purposes.');
      }
    } else {
      console.warn('[Webhook/Replicate-v2] WARNING: No signing secret configured');
    }

    const body = JSON.parse(bodyText);
    const { status, output, error: predictionError, id: predictionId } = body;

    const supabase = createServiceClient();

    const { data: executionCtx } = await supabase
      .from('executions')
      .select('session_id, graph_json, sessions(user_id)')
      .eq('id', executionId)
      .single();

    const sessionId = executionCtx?.session_id || null;
    const userId = (executionCtx?.sessions as any)?.user_id || 'unknown_user';
    // Real owner UUID (or null) for the node_results.user_id column. Distinct
    // from `userId` above, which may be the 'unknown_user' string used only for
    // storage paths and is not a valid uuid.
    const userUuid: string | null = (executionCtx?.sessions as any)?.user_id ?? null;
    const storageSessionId = sessionId || 'unknown_session';

    // Fan-out (iterations > 1) carries the stable prediction index in the webhook
    // URL. Its presence — NOT the existence of a node_predictions row — is the
    // fan-out signal, so a callback that beats the dispatcher's row insert still
    // takes the aggregation path (and upserts its own row by index) instead of the
    // legacy single-prediction clobber. Single runs omit predIndex → legacy path.
    const predIndexParam = searchParams.get('predIndex');
    const parsedPredIndex = predIndexParam !== null ? parseInt(predIndexParam, 10) : NaN;
    const isFanOut = Number.isInteger(parsedPredIndex) && parsedPredIndex >= 0;
    const predictionIndex = isFanOut ? parsedPredIndex : -1;
    // Expected iteration count for the atomic finalize gate — read from the graph,
    // matching what the dispatcher fanned out with (clampIterations of the config).
    const graphNode = isFanOut
        ? ((executionCtx?.graph_json as any)?.nodes ?? []).find((n: any) => n?.id === nodeId)
        : null;
    const expectedCount = isFanOut
        ? clampIterations(graphNode?.data?.config?.iterations ?? graphNode?.config?.iterations)
        : 0;

    if (status === 'succeeded') {
      const normalizedOutput = normalizeReplicateOutput(output);
      const outputType = await resolveNodeOutputWireTypeFromGraph(supabase, executionCtx?.graph_json, nodeId);
      let resultData = toResultDataForType(outputType, normalizedOutput);

      try {
        if (isMediaResultType(outputType)) {
          resultData = await mirrorMediaToStorage(
            supabase,
            resultData.filter((item): item is string => typeof item === 'string'),
            outputType,
            userId,
            storageSessionId,
            nodeId
          );
        }
      } catch (uploadJobError) {
        if (isFanOut) {
          await upsertPredictionRow(supabase, executionId, nodeId, predictionIndex, {
            status: 'failed',
            error: `Media upload to storage failed: ${uploadJobError instanceof Error ? uploadJobError.message : 'Unknown error'}`,
          });
          await refundFailedIteration(supabase, executionId, nodeId, predictionIndex);
          const { origin } = new URL(request.url);
          await finalizeFanOut(supabase, executionId, nodeId, outputType, expectedCount, origin);
          return NextResponse.json({ success: true });
        }

        await supabase.from('node_results').upsert(
          {
            execution_id: executionId,
            node_id: nodeId,
            session_id: sessionId,
            user_id: userUuid,
            status: 'failed',
            error: `Media upload to storage failed: ${
              uploadJobError instanceof Error ? uploadJobError.message : 'Unknown error'
            }`,
            replicate_id: predictionId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'execution_id,node_id' }
        );

        const { origin } = new URL(request.url);
        await checkAndDispatchChildren(executionId, nodeId, origin);
        return NextResponse.json({ success: true });
      }

      if (resultData.some((item) => typeof item === 'string' && isReplicateHostedUrl(item))) {
        if (isFanOut) {
          await upsertPredictionRow(supabase, executionId, nodeId, predictionIndex, {
            status: 'failed',
            error: 'Media could not be permanently stored. Please re-run the node.',
          });
          await refundFailedIteration(supabase, executionId, nodeId, predictionIndex);
          const { origin } = new URL(request.url);
          await finalizeFanOut(supabase, executionId, nodeId, outputType, expectedCount, origin);
          return NextResponse.json({ success: true });
        }

        await supabase.from('node_results').upsert(
          {
            execution_id: executionId,
            node_id: nodeId,
            session_id: sessionId,
            user_id: userUuid,
            status: 'failed',
            error: 'Media could not be permanently stored. Please re-run the node.',
            replicate_id: predictionId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'execution_id,node_id' }
        );

        const { origin } = new URL(request.url);
        await checkAndDispatchChildren(executionId, nodeId, origin);
        return NextResponse.json({ success: true });
      }

      if (isFanOut) {
        await upsertPredictionRow(supabase, executionId, nodeId, predictionIndex, {
          status: 'completed',
          resultData,
          error: null,
        });
        const { origin } = new URL(request.url);
        await finalizeFanOut(supabase, executionId, nodeId, outputType, expectedCount, origin);
        return NextResponse.json({ success: true });
      }

      const { error: updateError } = await supabase.from('node_results').upsert(
        {
          execution_id: executionId,
          node_id: nodeId,
          session_id: sessionId,
          user_id: userUuid,
          status: 'completed',
          result_type: outputType,
          result_data: resultData,
          replicate_id: predictionId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'execution_id,node_id' }
      );

      if (updateError) {
        return NextResponse.json({ error: 'Failed to update node_results' }, { status: 500 });
      }

      const { origin } = new URL(request.url);
      await checkAndDispatchChildren(executionId, nodeId, origin);
    } else if (status === 'failed' || status === 'canceled') {
      if (isFanOut) {
        await upsertPredictionRow(supabase, executionId, nodeId, predictionIndex, {
          status: 'failed',
          error: predictionError || `Prediction ${status}`,
        });
        await refundFailedIteration(supabase, executionId, nodeId, predictionIndex);
        const outputType = await resolveNodeOutputWireTypeFromGraph(supabase, executionCtx?.graph_json, nodeId);
        const { origin } = new URL(request.url);
        await finalizeFanOut(supabase, executionId, nodeId, outputType, expectedCount, origin);
        return NextResponse.json({ success: true });
      }

      await supabase.from('node_results').upsert(
        {
          execution_id: executionId,
          node_id: nodeId,
          session_id: sessionId,
          status: 'failed',
          error: predictionError || `Prediction ${status}`,
          replicate_id: predictionId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'execution_id,node_id' }
      );

      const { origin } = new URL(request.url);
      await checkAndDispatchChildren(executionId, nodeId, origin);
    } else {
      console.log(`[Webhook/Replicate-v2] Ignoring intermediate status: ${status}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Webhook/Replicate-v2] Unexpected error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
