import { createServiceClient } from '@/lib/supabase/service';
import { waitUntil } from '@vercel/functions';
import { runBrain, StreamEncoder, type ChatTurn, type ImageAttachment } from '@/lib/chat';
import { getRegistryContext } from '@/lib/chat/registry-cache';
import { uploadBase64ToStorage } from '@/lib/utils/image-processing';
import { dispatchTool, type ToolHandlerState } from '@/lib/chat/tools/handlers';
import { synthesizeTaskBlueprint, sleep } from '@/lib/chat/task-loop';
import { STAGING_DELAY_MS } from '@/lib/chat/config';
import { MAX_NODE_REFS, type NodeRef } from '@/lib/utils/selection-refs';

// Switched from 'edge' to 'nodejs' because @anthropic-ai/sdk imports
// node:fs transitively, which Edge runtime cannot bundle.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function parseImageAttachments(raw: any): ImageAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: ImageAttachment[] = [];
  for (const item of raw) {
    const url: string | undefined = typeof item === 'string' ? item : item?.dataUrl ?? item?.url;
    if (!url || typeof url !== 'string') continue;
    const match = url.match(/^data:(image\/(?:webp|png|jpeg|gif));base64,(.+)$/);
    if (!match) continue;
    out.push({ mediaType: match[1] as ImageAttachment['mediaType'], data: match[2] });
    if (out.length >= 4) break; // hard cap from spec
  }
  return out;
}

async function handlePlanApprove(opts: {
  supabase: ReturnType<typeof createServiceClient>;
  sessionId: string;
  planAnswer: { planMessageId: string; action: 'approve' | 'feedback'; feedbackText?: string };
  userMessageId?: string;
  lastUserContent: string;
}): Promise<Response> {
  const { supabase, sessionId, planAnswer, userMessageId, lastUserContent } = opts;
  const t0 = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new StreamEncoder(controller);

      waitUntil((async () => {
        try {
          // 1. Read the assistant plan row.
          const { data: planRow, error: planErr } = await supabase
            .from('messages')
            .select('id, session_id, metadata')
            .eq('id', planAnswer.planMessageId)
            .single();
          if (planErr || !planRow) {
            encoder.send({
              type: 'error',
              message: 'Plan not found, please retry the request.',
              recoverable: false,
            });
            encoder.send({ type: 'done' });
            encoder.close();
            return;
          }
          if (planRow.session_id !== sessionId) {
            encoder.send({
              type: 'error',
              message: 'Plan does not belong to this session.',
              recoverable: false,
            });
            encoder.send({ type: 'done' });
            encoder.close();
            return;
          }
          const blueprint = planRow.metadata?.plan?.blueprint;
          const tasks = planRow.metadata?.plan?.tasks;
          const isTasks = Array.isArray(tasks) && tasks.length > 0;

          if (!isTasks && !blueprint) {
            encoder.send({
              type: 'error',
              message: 'Plan has no blueprint or tasks to apply.',
              recoverable: false,
            });
            encoder.send({ type: 'done' });
            encoder.close();
            return;
          }

          // 2. Idempotency check: was this plan already approved?
          // NOTE: not atomic — two simultaneous approves from different tabs can both
          // pass this check before either inserts the user message. Acceptable for v1;
          // a DB unique constraint on (session_id, planMessageId) would close the window.
          const { data: priorApprovalRows } = await supabase
            .from('messages')
            .select('id, metadata')
            .eq('session_id', sessionId)
            .eq('role', 'user');
          const alreadyApproved = (priorApprovalRows || []).some(
            (r: any) =>
              r?.metadata?.plan_answer?.planMessageId === planAnswer.planMessageId &&
              r?.metadata?.plan_answer?.action === 'approve'
          );
          if (alreadyApproved) {
            // Plan was already applied; client is showing approved state already.
            encoder.send({ type: 'done' });
            encoder.close();
            return;
          }

          // 3. Load current canvas_state.
          const { data: sessionRow } = await supabase
            .from('sessions')
            .select('canvas_state')
            .eq('id', sessionId)
            .single();
          const baseWorkflow =
            sessionRow?.canvas_state &&
            Array.isArray(sessionRow.canvas_state.nodes) &&
            Array.isArray(sessionRow.canvas_state.edges)
              ? sessionRow.canvas_state
              : { nodes: [], edges: [] };

          // 4. Build aiModelHandles from a fresh registry lookup.
          const registry = await getRegistryContext(supabase);
          const aiModelHandles = new Map<number, string[]>();
          for (const m of registry.models) {
            const schema = (m as any).inputs_schema;
            if (!schema || !Array.isArray(schema.handles)) continue;
            const ids: string[] = [];
            for (const h of schema.handles) {
              const key = h?.api_mapping_key;
              if (typeof key === 'string' && key.length > 0) ids.push(key);
            }
            if (ids.length > 0) aiModelHandles.set(m.id, ids);
          }

          const state: ToolHandlerState = {
            workflow: baseWorkflow as any,
            idMap: new Map(),
            aiModelHandles,
          };

          if (!isTasks) {
            // ─── ORIGINAL SINGLE-BLUEPRINT PATH — UNCHANGED ───

            // 5. Apply via dispatchTool('add_node', blueprint).
            const result = await dispatchTool(state, 'add_node', blueprint);
            if (!result.success) {
              encoder.send({
                type: 'error',
                message: result.error || 'Plan apply failed.',
                recoverable: true,
              });
              encoder.send({ type: 'done' });
              encoder.close();
              return;
            }

            // 6. Persist user message + canvas_state.
            const dbOps: Promise<any>[] = [];
            dbOps.push(
              Promise.resolve(supabase.from('messages').insert({
                ...(userMessageId ? { id: userMessageId } : {}),
                session_id: sessionId,
                role: 'user',
                content: lastUserContent || 'Approved',
                status: 'completed',
                metadata: {
                  plan_answer: {
                    planMessageId: planAnswer.planMessageId,
                    action: 'approve',
                  },
                },
                created_at: new Date().toISOString(),
              }) as any)
            );
            if (result.patch) {
              dbOps.push(
                Promise.resolve(supabase.from('sessions').update({
                  canvas_state: { nodes: state.workflow.nodes, edges: state.workflow.edges },
                  updated_at: new Date().toISOString(),
                }).eq('id', sessionId) as any)
              );
            }
            await Promise.all(dbOps);

            // 7. Emit tool + usage(zero) + done.
            if (result.patch) {
              encoder.send({ type: 'tool', name: 'add_node', patch: result.patch });
            }
            encoder.send({
              type: 'usage',
              inputTokens: 0,
              outputTokens: 0,
              thinkingTokens: 0,
              costUsd: 0,
            });
            encoder.send({ type: 'done' });
            encoder.close();

            console.log('[chat] plan_approve', {
              sessionId,
              planMessageId: planAnswer.planMessageId,
              blueprintNodeCount: Array.isArray(blueprint?.nodes) ? blueprint.nodes.length : 0,
              latencyMs: Date.now() - t0,
              status: 'ok',
            });
            return;
          }

          // ─── NEW TASKS-MODE PATH ───

          // Persist user-approval message ONCE upfront (mirrors single-blueprint path).
          await supabase.from('messages').insert({
            ...(userMessageId ? { id: userMessageId } : {}),
            session_id: sessionId,
            role: 'user',
            content: lastUserContent || 'Approved',
            status: 'completed',
            metadata: { plan_answer: { planMessageId: planAnswer.planMessageId, action: 'approve' } },
            created_at: new Date().toISOString(),
          });

          // Initial taskProgress on the assistant plan row.
          const total = tasks.length;
          await supabase
            .from('messages')
            .update({
              metadata: {
                ...planRow.metadata,
                taskProgress: { status: 'running', currentIndex: 0, total, failedTaskId: null },
              },
            })
            .eq('id', planAnswer.planMessageId);

          let failed = false;
          let failedTaskId: string | null = null;

          for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            encoder.send({ type: 'task_start', taskId: task.id, index: i, total });

            const augmented = synthesizeTaskBlueprint(task);
            const result = await dispatchTool(state, 'add_node', augmented);
            if (!result.success) {
              failed = true;
              failedTaskId = task.id;
              encoder.send({
                type: 'error',
                message: `Task "${task.title}" failed: ${result.error || 'unknown error'}`,
                recoverable: true,
              });
              break;
            }

            if (result.patch) {
              encoder.send({ type: 'tool', name: 'add_node', patch: result.patch });
            }

            // Persist incremental updates after each task.
            await Promise.all([
              supabase.from('sessions').update({
                canvas_state: { nodes: state.workflow.nodes, edges: state.workflow.edges },
                updated_at: new Date().toISOString(),
              }).eq('id', sessionId),
              supabase.from('messages').update({
                metadata: {
                  ...planRow.metadata,
                  taskProgress: { status: 'running', currentIndex: i + 1, total, failedTaskId: null },
                },
              }).eq('id', planAnswer.planMessageId),
            ]);

            encoder.send({ type: 'task_complete', taskId: task.id, index: i, total });

            if (i < tasks.length - 1) {
              await sleep(STAGING_DELAY_MS);
            }
          }

          // Final taskProgress update.
          const finalProgress = failed
            ? { status: 'failed' as const, currentIndex: tasks.findIndex((t: any) => t.id === failedTaskId), total, failedTaskId }
            : { status: 'done' as const, currentIndex: total, total, failedTaskId: null };

          await supabase
            .from('messages')
            .update({
              metadata: {
                ...planRow.metadata,
                taskProgress: finalProgress,
              },
            })
            .eq('id', planAnswer.planMessageId);

          if (!failed) {
            encoder.send({ type: 'tasks_complete', total });
          }

          encoder.send({ type: 'usage', inputTokens: 0, outputTokens: 0, thinkingTokens: 0, costUsd: 0 });
          encoder.send({ type: 'done' });
          encoder.close();
        } catch (err: any) {
          encoder.send({
            type: 'error',
            message: err?.message || 'plan_approve failed unexpectedly',
            recoverable: false,
          });
          encoder.send({ type: 'done' });
          encoder.close();
          console.error('[chat] plan_approve error', err);
        }
      })());
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}

async function handleWithNewBrain(req: Request): Promise<Response> {
  const body = await req.json();
  const { messages, sessionId, previousWorkflow, attachedImages } = body ?? {};
  const nodeRefs: NodeRef[] = Array.isArray(body?.nodeRefs)
    ? body.nodeRefs
        .filter(
          (r: any) =>
            r && typeof r.id === 'string' && typeof r.label === 'string' && typeof r.type === 'string',
        )
        .slice(0, MAX_NODE_REFS)
        .map((r: any) => ({
          id: String(r.id).slice(0, 128),
          label: String(r.label).slice(0, 200),
          type: String(r.type).slice(0, 64),
          ...(r.isGroup === true ? { isGroup: true } : {}),
        }))
    : [];
  const clarificationAnswer: { questionMessageId: string; chosenIndex: number | null } | undefined =
    body?.clarificationAnswer && typeof body.clarificationAnswer === 'object'
      ? {
          questionMessageId: String(body.clarificationAnswer.questionMessageId ?? ''),
          chosenIndex:
            typeof body.clarificationAnswer.chosenIndex === 'number'
              ? body.clarificationAnswer.chosenIndex
              : null,
        }
      : undefined;
  const planAnswer: { planMessageId: string; action: 'approve' | 'feedback'; feedbackText?: string } | undefined =
    body?.planAnswer && typeof body.planAnswer === 'object'
      ? {
            planMessageId: String(body.planAnswer.planMessageId ?? ''),
            action:
                body.planAnswer.action === 'approve' || body.planAnswer.action === 'feedback'
                    ? body.planAnswer.action
                    : 'feedback',
            feedbackText:
                typeof body.planAnswer.feedbackText === 'string' ? body.planAnswer.feedbackText : undefined,
        }
      : undefined;
  // Client-supplied UUIDs so the in-memory message IDs match the DB row IDs.
  // Required for clarification-answer pairing to survive a page refresh.
  const userMessageId: string | undefined =
    typeof body?.userMessageId === 'string' && body.userMessageId.length > 0
      ? body.userMessageId
      : undefined;
  const assistantMessageId: string | undefined =
    typeof body?.assistantMessageId === 'string' && body.assistantMessageId.length > 0
      ? body.assistantMessageId
      : undefined;

  const supabase = createServiceClient();

  // Approve-branch: short-circuit before ALL the brain plumbing. Skips
  // runBrain entirely; applies the stored blueprint via dispatchTool;
  // persists; emits tool + usage(zero) + done.
  if (planAnswer?.action === 'approve' && planAnswer.planMessageId.length > 0 && sessionId) {
    return await handlePlanApprove({
      supabase,
      sessionId,
      planAnswer,
      userMessageId,
      lastUserContent:
        messages?.length > 0 ? String(messages[messages.length - 1]?.content ?? 'Approved') : 'Approved',
    });
  }

  // Resolve the user's plan so we can gate the model choice server-side.
  let planId = 'free';
  if (sessionId) {
    const { data: sessionRow } = await supabase
      .from('sessions')
      .select('user_id')
      .eq('id', sessionId)
      .single();
    if (sessionRow?.user_id) {
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('plan_id')
        .eq('user_id', sessionRow.user_id)
        .single();
      if (sub?.plan_id) planId = sub.plan_id;
    }
  }

  const isPaid = planId !== 'free';
  const requestedModel =
    body.selectedModel === 'sonnet' || body.selectedModel === 'haiku'
      ? (body.selectedModel as 'haiku' | 'sonnet')
      : undefined;
  const model: 'haiku' | 'sonnet' =
    isPaid && requestedModel ? requestedModel : isPaid ? 'sonnet' : 'haiku';

  // Cached for 5 min — see lib/chat/registry-cache.ts
  const registry = await getRegistryContext(supabase);

  const chatWindow = (messages || [])
    .filter((m: any) => m.content && m.content.trim().length > 0)
    // Filter out synthetic 'Approved' user messages — they're DB-only
    // markers for plan-card state derivation on reload. Sending them to
    // Anthropic would put two user roles back-to-back (the prior
    // 'Approved' plus the next real user message), which the API
    // rejects. Real user feedback messages are NOT filtered — they
    // carry meaningful content the model needs to see.
    .filter(
        (m: any) =>
            !(
                (m.role === 'user' || m.type === 'user') &&
                m.content === 'Approved' &&
                m.metadata?.plan_answer?.action === 'approve'
            ) &&
            // Same exclusion when the message arrives from the client store
            // shape (planAnswer rather than metadata.plan_answer).
            !(
                (m.role === 'user' || m.type === 'user') &&
                m.content === 'Approved' &&
                m.planAnswer?.action === 'approve'
            )
    )
    .slice(-8);

  const images = parseImageAttachments(attachedImages);

  // Upload attached images to storage so the model can reference stable URLs.
  const attachedImageUrls: string[] = [];
  const rawAttached: any[] = Array.isArray(attachedImages) ? attachedImages : [];
  const folder = typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : 'anonymous';
  for (const item of rawAttached) {
    const url: string | undefined = typeof item === 'string' ? item : item?.dataUrl ?? item?.url;
    if (!url || !/^data:image\//.test(url)) continue;
    try {
      const { publicUrl } = await uploadBase64ToStorage(url, folder, supabase);
      attachedImageUrls.push(publicUrl);
    } catch (err) {
      console.error('[chat] image upload failed:', err);
    }
    if (attachedImageUrls.length >= 4) break; // hard cap consistent with parseImageAttachments
  }

  // The most recent user message gets the images attached as content blocks.
  const turns: ChatTurn[] = chatWindow.map((m: any, i: number, arr: any[]) => {
    const role = (m.role || m.type) === 'assistant' ? 'assistant' : 'user';
    if (role === 'assistant') return { role: 'assistant', text: m.content };
    const isLast = i === arr.length - 1;
    return { role: 'user', text: m.content, images: isLast ? images : undefined };
  });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new StreamEncoder(controller);

      waitUntil((async () => {
        const result = await runBrain({
          turns,
          workflow: previousWorkflow,
          registry,
          encoder,
          attachedImageUrls,
          model,
          nodeRefs,
        });

        if (sessionId && (result.hadAnyOutput || result.clarification || result.plan) && messages?.length > 0) {
          const lastUserMsg = messages[messages.length - 1];
          const dbOps: Promise<any>[] = [];

          if (lastUserMsg.role === 'user' || lastUserMsg.type === 'user') {
            const userMetadata: Record<string, any> = {};
            if (clarificationAnswer && clarificationAnswer.questionMessageId.length > 0) {
              userMetadata.clarification_answer = clarificationAnswer;
            }
            if (planAnswer && planAnswer.action === 'feedback' && planAnswer.planMessageId.length > 0) {
              userMetadata.plan_answer = {
                planMessageId: planAnswer.planMessageId,
                action: 'feedback',
                feedbackText: planAnswer.feedbackText,
              };
            }
            if (nodeRefs.length > 0) {
              userMetadata.node_refs = nodeRefs;
            }
            dbOps.push(
              Promise.resolve(supabase.from('messages').insert({
                ...(userMessageId ? { id: userMessageId } : {}),
                session_id: sessionId,
                role: 'user',
                content: lastUserMsg.content,
                status: 'completed',
                metadata: Object.keys(userMetadata).length > 0 ? userMetadata : null,
                created_at: new Date().toISOString()
              }) as any)
            );
          }

          // Persist the assistant row whenever the brain produced anything
          // meaningful — text OR a plan OR a clarification. Gating on
          // finalText alone (the prior behavior) silently dropped plan
          // turns where the model skipped the prose preamble, and would
          // similarly drop clarification turns that didn't write a question
          // line. The card had already streamed and rendered, so the row
          // must exist for reload + approve to work against the same id.
          if (result.finalText || result.plan || result.clarification) {
            dbOps.push(
              Promise.resolve(supabase.from('messages').insert({
                ...(assistantMessageId ? { id: assistantMessageId } : {}),
                session_id: sessionId,
                role: 'assistant',
                content: result.finalText || '',
                metadata: {
                  thinking: result.finalThinking || null,
                  usage: result.usage || null,
                  clarification: result.clarification || null,
                  plan: result.plan || null,
                },
                status: 'completed',
                created_at: new Date(Date.now() + 1000).toISOString()
              }) as any)
            );
          }

          if (result.accumulatedPatch) {
            dbOps.push(
              Promise.resolve(supabase.from('sessions').update({
                canvas_state: { nodes: result.finalWorkflow.nodes, edges: result.finalWorkflow.edges },
                updated_at: new Date().toISOString()
              }).eq('id', sessionId) as any)
            );
          }

          if (dbOps.length > 0) await Promise.all(dbOps);
        }

        encoder.send({ type: 'done' });
        encoder.close();
      })());
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform'
    }
  });
}

export async function POST(req: Request) {
  try {
    return await handleWithNewBrain(req);
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
