import { createServiceClient } from '@/lib/supabase/service';
import { waitUntil } from '@vercel/functions';
import { runBrain, StreamEncoder, type ChatTurn, type ImageAttachment } from '@/lib/chat';
import { getRegistryContext } from '@/lib/chat/registry-cache';
import { uploadBase64ToStorage } from '@/lib/utils/image-processing';

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

async function handleWithNewBrain(req: Request): Promise<Response> {
  const body = await req.json();
  const { messages, sessionId, previousWorkflow, attachedImages } = body ?? {};
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
        });

        if (sessionId && (result.hadAnyOutput || result.clarification) && messages?.length > 0) {
          const lastUserMsg = messages[messages.length - 1];
          const dbOps: Promise<any>[] = [];

          if (lastUserMsg.role === 'user' || lastUserMsg.type === 'user') {
            const userMetadata =
              clarificationAnswer && clarificationAnswer.questionMessageId.length > 0
                ? { clarification_answer: clarificationAnswer }
                : null;
            dbOps.push(
              Promise.resolve(supabase.from('messages').insert({
                ...(userMessageId ? { id: userMessageId } : {}),
                session_id: sessionId,
                role: 'user',
                content: lastUserMsg.content,
                status: 'completed',
                metadata: userMetadata,
                created_at: new Date().toISOString()
              }) as any)
            );
          }

          if (result.finalText) {
            dbOps.push(
              Promise.resolve(supabase.from('messages').insert({
                ...(assistantMessageId ? { id: assistantMessageId } : {}),
                session_id: sessionId,
                role: 'assistant',
                content: result.finalText,
                metadata: {
                  thinking: result.finalThinking || null,
                  usage: result.usage || null,
                  clarification: result.clarification || null,
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
