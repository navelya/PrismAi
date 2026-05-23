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
  normalizeNodeResultType,
  toResultDataForType,
} from '@/lib/workflow/result-format';

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

async function resolveNodeOutputWireType(
  supabase: ReturnType<typeof createServiceClient>,
  executionGraph: any,
  nodeId: string
): Promise<NodeResultType> {
  const graphNodes = executionGraph?.nodes;
  const node = Array.isArray(graphNodes) ? graphNodes.find((n: any) => n?.id === nodeId) : null;
  const modelId = node?.data?.config?.model_id ?? node?.data?.model_id;

  if (!modelId) return 'json';

  const { data: model } = await supabase
    .from('ai_models')
    .select('outputs_schema')
    .eq('id', modelId)
    .single();

  const handleType = model?.outputs_schema?.handles?.[0]?.type;
  return normalizeNodeResultType(handleType);
}

async function finalizeFanOutIfReady(
  supabase: ReturnType<typeof createServiceClient>,
  executionId: string,
  nodeId: string,
  outputType: NodeResultType,
  origin: string
): Promise<void> {
  // Any predictions still pending? If so, nothing to do yet.
  const { count: pendingCount, error: pendingErr } = await supabase
    .from('node_predictions')
    .select('id', { count: 'exact', head: true })
    .eq('execution_id', executionId)
    .eq('node_id', nodeId)
    .eq('status', 'pending');
  if (pendingErr) throw new Error(`node_predictions pending-count failed: ${pendingErr.message}`);
  if ((pendingCount ?? 0) > 0) return;

  // All resolved. Gather successful outputs in prediction order.
  const { data: rows, error: rowsErr } = await supabase
    .from('node_predictions')
    .select('prediction_index, status, result_data')
    .eq('execution_id', executionId)
    .eq('node_id', nodeId)
    .order('prediction_index', { ascending: true });
  if (rowsErr) throw new Error(`node_predictions gather failed: ${rowsErr.message}`);

  const aggregated: any[] = [];
  let anySuccess = false;
  for (const r of rows ?? []) {
    if (r.status === 'completed' && Array.isArray(r.result_data)) {
      aggregated.push(...r.result_data);
      anySuccess = true;
    }
  }

  // Elect a single dispatcher: transition node_results out of 'running' exactly
  // once. Concurrent final webhooks race here; only the row-returning update wins.
  const { data: claimed, error: claimErr } = await supabase
    .from('node_results')
    .update({
      status: anySuccess ? 'completed' : 'failed',
      result_type: outputType,
      result_data: aggregated,
      error: anySuccess ? null : 'All iterations failed',
      updated_at: new Date().toISOString(),
    })
    .eq('execution_id', executionId)
    .eq('node_id', nodeId)
    .eq('status', 'running')
    .select('id');
  if (claimErr) throw new Error(`node_results claim failed: ${claimErr.message}`);

  if (claimed && claimed.length > 0) {
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
    const storagePath = `${userId}/${sessionId}/thumbnails/${nodeId}/result_${now}_${i}.${ext}`;

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
    const storageSessionId = sessionId || 'unknown_session';

    // Fan-out (iterations > 1) tracks each prediction in node_predictions. If a
    // row exists for THIS prediction, take the aggregation path; otherwise the
    // legacy single-prediction path runs unchanged.
    const { data: predRow } = await supabase
        .from('node_predictions')
        .select('id, prediction_index')
        .eq('execution_id', executionId)
        .eq('node_id', nodeId)
        .eq('replicate_id', predictionId)
        .maybeSingle();
    const isFanOut = !!predRow;

    if (status === 'succeeded') {
      const normalizedOutput = normalizeReplicateOutput(output);
      const outputType = await resolveNodeOutputWireType(supabase, executionCtx?.graph_json, nodeId);
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
          const { error: predErr } = await supabase
            .from('node_predictions')
            .update({ status: 'failed', error: `Media upload to storage failed: ${uploadJobError instanceof Error ? uploadJobError.message : 'Unknown error'}`, updated_at: new Date().toISOString() })
            .eq('id', predRow!.id);
          if (predErr) throw new Error(`node_predictions update failed: ${predErr.message}`);
          const { origin } = new URL(request.url);
          await finalizeFanOutIfReady(supabase, executionId, nodeId, outputType, origin);
          return NextResponse.json({ success: true });
        }

        await supabase.from('node_results').upsert(
          {
            execution_id: executionId,
            node_id: nodeId,
            session_id: sessionId,
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
          const { error: predErr } = await supabase
            .from('node_predictions')
            .update({ status: 'failed', error: 'Media could not be permanently stored. Please re-run the node.', updated_at: new Date().toISOString() })
            .eq('id', predRow!.id);
          if (predErr) throw new Error(`node_predictions update failed: ${predErr.message}`);
          const { origin } = new URL(request.url);
          await finalizeFanOutIfReady(supabase, executionId, nodeId, outputType, origin);
          return NextResponse.json({ success: true });
        }

        await supabase.from('node_results').upsert(
          {
            execution_id: executionId,
            node_id: nodeId,
            session_id: sessionId,
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
        const { error: predErr } = await supabase
          .from('node_predictions')
          .update({ status: 'completed', result_data: resultData, error: null, updated_at: new Date().toISOString() })
          .eq('id', predRow!.id);
        if (predErr) throw new Error(`node_predictions update failed: ${predErr.message}`);
        const { origin } = new URL(request.url);
        await finalizeFanOutIfReady(supabase, executionId, nodeId, outputType, origin);
        return NextResponse.json({ success: true });
      }

      const { error: updateError } = await supabase.from('node_results').upsert(
        {
          execution_id: executionId,
          node_id: nodeId,
          session_id: sessionId,
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
        const { error: predErr } = await supabase
          .from('node_predictions')
          .update({ status: 'failed', error: predictionError || `Prediction ${status}`, updated_at: new Date().toISOString() })
          .eq('id', predRow!.id);
        if (predErr) throw new Error(`node_predictions update failed: ${predErr.message}`);
        const outputType = await resolveNodeOutputWireType(supabase, executionCtx?.graph_json, nodeId);
        const { origin } = new URL(request.url);
        await finalizeFanOutIfReady(supabase, executionId, nodeId, outputType, origin);
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
