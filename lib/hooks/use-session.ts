import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store/app-store';
import { Workflow } from '@/lib/nodes/types';
import { sessionsApi, chatsApi } from '@/lib/api/client';
import { setServerWorkflowHash } from '@/lib/hooks/use-chat-realtime';
import { getSessionExecutions } from '@/lib/db/workflows';

export interface Session {
    id: string;
    title: string;
    updated_at: string;
    created_at: string;
    canvas_session_id?: string | null;
}

/**
 * Construct a public URL for a Supabase storage path.
 * This avoids needing the Supabase client just to build URLs.
 */
function getStoragePublicUrl(path: string): string {
    if (path.startsWith('http') || path.startsWith('data:')) return path;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return `${supabaseUrl}/storage/v1/object/public/chat-assets/${path}`;
}

export function useSession() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
    const [error, setError] = useState<Error | null>(null);

    // Create a new session and redirect
    const createNewSession = useCallback(async () => {
        setIsLoading(true);
        try {
            const { session } = await sessionsApi.create('New Workflow');

            if (session) {
                // Reset ALL local store state before navigating
                const store = useAppStore.getState();

                // Set active session to the new session ID
                store.setActiveSessionId(session.id);

                // A brand-new session is owned by its creator. setActiveSessionId
                // above already cleared any stale collab role/peers carried over
                // from a previously-open shared (viewer) workflow; set 'owner' + the
                // canvas id optimistically so the new session is immediately editable
                // (and shows no ghost peers) before loadSession re-resolves the role.
                store.setCollabRole('owner');
                store.setSessionRole(session.id, 'owner');
                store.setActiveCanvasId(session.id);

                // Clear workflow and other state for fresh start (false = don't mark dirty)
                store.setCurrentWorkflow(null, false);
                store.clearMessages();
                store.clearExecutionResults();
                store.resetNodeStatuses();
                store.clearNodeOutputs();
                // Canvas mode is preserved across sessions (managed by isCanvasMode in store)

                // Use native Next.js Router to soft-navigate without unmounting the layout
                router.push(`/chat/${session.id}`);
            }
        } catch (error) {
            console.error('Failed to create session:', error);
        } finally {
            setIsLoading(false);
        }
    }, [router]);

    // Load a session by ID
    const loadSession = useCallback(async (sessionId: string) => {

        setIsLoading(true);

        // We deliberately do NOT wipe nodeStatuses / nodeOutputs / currentWorkflow
        // here. They are persisted across refresh ([lib/store/app-store.ts]) and
        // represent the last-known DB view of the current session. Clearing them
        // before the async fetch below would flash 'idle' on the canvas while
        // running nodes are still in flight on the server.
        //
        // Cross-session safety: when the user navigates between different
        // sessions, [app/chat/[id]/page.tsx] detects the mismatch and calls
        // store.clearAllState() before this hook runs, so the prior session's
        // state is already gone by the time we get here.
        const store = useAppStore.getState();
        store.setIsLoadingSession(true); // Guard auto-save
        store.setActiveSessionId(sessionId);

        // Seed the collab role optimistically from the last-known role for this
        // canvas so the UI doesn't flash while the server resolves the real role.
        //   - Known own session   → 'owner' → edit affordances render immediately.
        //   - Known shared/viewer  → that role → correct from the first frame.
        //   - Unknown (e.g. a brand-new share link) → leave null → the side
        //     window buttons stay hidden until the server confirms edit access.
        // setActiveSessionId just cleared collabRole to null (its safety reset),
        // so this only ADDS optimism where we have a prior signal.
        const seededRole = store.sessionRoles[sessionId];
        if (seededRole) store.setCollabRole(seededRole);

        // ── Collaboration: resolve the caller's thread + role + canvas ──────────
        // The open route returns { threadId, canvasId, role } where:
        //   - threadId     = the per-user chat thread (== sessionId for owner)
        //   - canvasId     = the shared canvas to hydrate (== sessionId for owner)
        //   - role         = 'owner' | 'editor' | 'viewer'
        // For an owner opening their own workflow all three equal sessionId, so
        // the fallback below keeps single-user behavior unchanged.
        let threadId = sessionId;
        let resolvedCanvasId = sessionId;
        let role: 'owner' | 'editor' | 'viewer' = 'owner';
        try {
            const opened = await sessionsApi.open(sessionId);
            threadId = opened.threadId;
            resolvedCanvasId = opened.canvasId;
            role = opened.role;
        } catch {
            // Fallback (e.g. sessionId is a legacy/own session or open route unavailable):
            // treat it as both the thread and the canvas (single-user behavior).
        }

        // Update the active session id to the resolved thread id so that:
        //   - Chat messages + the realtime channel are scoped to the per-user thread.
        //   - The stale-guard below uses sessionId (the URL param) not threadId, which
        //     is fine because the URL never reflects the internal thread rewrite.
        store.setActiveSessionId(threadId);
        // Set the role LAST — setActiveSessionId clears collabRole as part of
        // switching session context, so the real role must be applied after it.
        store.setCollabRole(role);
        // Remember it (keyed by the URL/canvas id) so the next entry into this
        // session seeds without a flash.
        store.setSessionRole(sessionId, role);

        try {
            // ── Parallel fetches ──────────────────────────────────────────────────
            // For the owner path threadId === resolvedCanvasId === sessionId, so we
            // can skip the redundant canvas load and use a single sessionsApi.load().
            // For a collaborator they diverge: thread load brings messages, canvas
            // load brings canvas_state.
            const isSameId = threadId === resolvedCanvasId;

            const [threadResult, canvasLoadResult, executionsResult] = await Promise.all([
                sessionsApi.load(threadId),
                isSameId ? Promise.resolve(null) : sessionsApi.load(resolvedCanvasId).catch((err) => {
                    console.error('[useSession] Failed to load shared canvas row, falling back to thread session:', err);
                    return null;
                }),
                getSessionExecutions(resolvedCanvasId),
            ]);

            const { session: threadSession, messages } = threadResult;
            // For the owner path the canvas comes from the thread result directly.
            // For a collaborator it comes from the separate canvas load (or falls
            // back to the thread session if that load failed).
            const canvasSession = isSameId
                ? threadSession
                : ((canvasLoadResult as any)?.session ?? threadSession);

            const { executions, latestExecutionId } = executionsResult;

            // STALE CHECK: If the user navigated away while we were loading, ignore results
            // Compare against sessionId (the URL parameter) to catch navigation races; the
            // internal thread rewrite doesn't change the URL.
            const currentStore = useAppStore.getState();
            if (currentStore.activeSessionId !== threadId) {
                console.warn('[useSession] Ignoring stale session load for:', sessionId);
                return;
            }

            // Hydrate Workflow from the canvas session row.
            // For an owner this is identical to the old behaviour (session === canvasSession).
            // For a collaborator this is the shared canvas, not their private thread.
            const canvasId = resolvedCanvasId;
            const canvasRow: any = canvasSession;
            const rawCanvas = (canvasRow.canvas_state || {}) as Partial<Workflow>;
            // Self-heal orphaned parentNode references: if a node points at a
            // parent id that doesn't exist in the same node array, drop the
            // parentNode field. React Flow throws "Parent node X not found"
            // and refuses to render the whole canvas otherwise. This catches
            // both legacy rows persisted before parentNode-resolution shipped
            // and any future bug that lets an unresolved temp id slip through.
            const rawNodes = (rawCanvas.nodes || []) as any[];
            const nodeIdSet = new Set(rawNodes.map((n: any) => n.id));
            const workflow: Workflow = {
                ...rawCanvas,
                id: canvasId,
                name: rawCanvas.name || threadSession.title || 'Untitled Workflow',
                nodes: rawNodes.map((n: any) => {
                    const hasOrphanParent = n.parentNode && !nodeIdSet.has(n.parentNode);
                    const { parentNode: _stripped, ...rest } = n;
                    const base = hasOrphanParent ? rest : n;
                    return {
                        ...base,
                        data: {
                            ...base.data,
                            // V3.1: Strip any legacy status/output from blueprint nodes so a stale
                            // "Success" from a previous run doesn't flash while fresh results load.
                            status: undefined,
                            output: undefined,
                            outputMetadata: undefined,
                            error: undefined,
                        },
                    };
                }),
                edges: rawCanvas.edges || [],
            };

            setServerWorkflowHash(workflow);
            store.setActiveCanvasId(canvasId);
            store.setCurrentWorkflow(workflow, false); // NOT dirty on initial load!

            // Hydrate Messages
            const formattedMessages: any[] = messages
                // Filter out 'processing' placeholder messages ONLY IF they have absolutely no content and no workflow
                .filter((msg: any) => !(msg.status === 'processing' && !msg.content && !msg.workflow && !msg.canvas_state))
                .map((msg: any) => {
                    // Restore image paths to URLs
                    const images = msg.images?.map((path: string) => getStoragePublicUrl(path));

                    let result = undefined;
                    if (msg.role === 'assistant') {
                        if (msg.metadata?.execution_result) {
                            result = msg.metadata.execution_result;
                        } else if (images && images.length > 0) {
                            // Fallback to old behavior for legacy messages
                            result = images.map((url: string, idx: number) => ({
                                url,
                                resolution: { width: 800, height: 600 },
                                metadata: { title: `Image ${idx + 1}` }
                            }));
                        }
                    }

                    // Read from `workflow` column (written by background worker)
                    // Fall back to `canvas_state` for backwards compat with old messages
                    const messageWorkflow = msg.workflow || msg.canvas_state || undefined;

                    const metadata = (msg.metadata ?? {}) as {
                        thinking?: string | null;
                        usage?: any;
                        model?: string | null;
                        clarification?: {
                            questions?: import('@/lib/chat/streaming/protocol').ClarificationQuestion[];
                            options?: string[];
                        } | null;
                        clarification_answer?: {
                            questionMessageId: string;
                            chosenIndex?: number | null;
                            answers?: { chosenIndex: number | null; text: string }[];
                        } | null;
                        plan?: {
                            title: string;
                            summary: string;
                            arrows: string;
                            models: string[];
                            detail: string;
                            blueprint?: { nodes?: any[]; edges?: any[] };
                            tasks?: import('@/lib/chat/streaming/protocol').TaskBlueprint[];
                        } | null;
                        plan_answer?: {
                            planMessageId: string;
                            action: 'approve' | 'feedback';
                            feedbackText?: string;
                        } | null;
                        node_refs?: import('@/lib/utils/selection-refs').NodeRef[] | null;
                        run_proposal?: {
                            runTargetIds: string[];
                            terminalIds: string[];
                            cost: number;
                            status: 'ready' | 'running' | 'done' | 'failed' | 'superseded';
                            error?: string;
                            expectedResultCount?: number;
                        } | null;
                        inline_result_ids?: string[] | null;
                    };

                    const formatted: any = {
                        id: msg.id,
                        type: msg.role, // 'user' | 'assistant'
                        content: msg.content || '',
                        timestamp: new Date(msg.created_at),
                        images: msg.role === 'user' ? images : undefined, // Only user messages show inline images
                        result: result, // Assistant messages use result for image display
                        workflow: messageWorkflow, // Attach snapshot if available
                        thinking: metadata.thinking ?? '',
                        usage: metadata.usage ?? null,
                        model: metadata.model === 'haiku' || metadata.model === 'sonnet'
                            ? metadata.model
                            : undefined,
                    };

                    if (msg.role === 'assistant' && metadata.clarification) {
                        const clar = metadata.clarification;
                        if (clar.questions?.length) {
                            formatted.clarification = { questions: clar.questions };
                        } else if (clar.options?.length) {
                            formatted.clarification = { options: clar.options };
                        }
                    }

                    if (msg.role === 'assistant' && metadata.plan) {
                        formatted.plan = {
                            title: typeof metadata.plan.title === 'string' ? metadata.plan.title : '',
                            summary: typeof metadata.plan.summary === 'string' ? metadata.plan.summary : '',
                            arrows: typeof metadata.plan.arrows === 'string' ? metadata.plan.arrows : '',
                            models: Array.isArray(metadata.plan.models) ? metadata.plan.models.filter((s: any) => typeof s === 'string') : [],
                            detail: typeof metadata.plan.detail === 'string' ? metadata.plan.detail : '',
                            blueprint: {
                                nodes: Array.isArray(metadata.plan.blueprint?.nodes) ? metadata.plan.blueprint!.nodes : [],
                                edges: Array.isArray(metadata.plan.blueprint?.edges) ? metadata.plan.blueprint!.edges : [],
                            },
                            tasks: Array.isArray(metadata.plan.tasks) ? metadata.plan.tasks : undefined,
                        };
                    }

                    if (msg.role === 'assistant' && metadata.run_proposal) {
                        const rp = metadata.run_proposal;
                        // A run that was still 'running' when the page unloaded can't be
                        // live anymore — re-offer it as a manual 'ready' card. Auto-run
                        // lives only in the live end-of-stream path, so this never
                        // re-fires a run on load.
                        const status = rp.status === 'running' ? 'ready' : rp.status;
                        formatted.runProposal = {
                            runTargetIds: Array.isArray(rp.runTargetIds) ? rp.runTargetIds : [],
                            terminalIds: Array.isArray(rp.terminalIds) ? rp.terminalIds : [],
                            cost: typeof rp.cost === 'number' ? rp.cost : 0,
                            status,
                            error: typeof rp.error === 'string' ? rp.error : undefined,
                            expectedResultCount: typeof rp.expectedResultCount === 'number' ? rp.expectedResultCount : undefined,
                        };
                    }
                    if (msg.role === 'assistant' && Array.isArray(metadata.inline_result_ids)) {
                        formatted.inlineResultIds = metadata.inline_result_ids;
                    }

                    // Stash the raw answer payload on the user message; we lift it
                    // onto the prior assistant message in a second pass below.
                    if (msg.role === 'user' && metadata.clarification_answer?.questionMessageId) {
                        formatted.__clarificationAnswerRaw = metadata.clarification_answer;
                    }

                    if (msg.role === 'user' && metadata.plan_answer?.planMessageId) {
                        formatted.__planAnswerRaw = metadata.plan_answer;
                        // ALSO mirror planAnswer on the user message itself so the chatWindow
                        // filter in route.ts (and the suppression guard in Message.tsx for
                        // synthetic 'Approved' bubbles) keeps working after reload. The user
                        // message is the bearer of plan_answer.action in DB metadata; the
                        // chatWindow filter checks the in-memory shape `m.planAnswer?.action`.
                        formatted.planAnswer = {
                            action: metadata.plan_answer.action === 'approve' ? 'approve' : 'feedback',
                            feedbackText: typeof metadata.plan_answer.feedbackText === 'string' ? metadata.plan_answer.feedbackText : undefined,
                        };
                    }

                    if (msg.role === 'user' && Array.isArray(metadata.node_refs) && metadata.node_refs.length > 0) {
                        formatted.nodeRefs = metadata.node_refs;
                    }

                    return formatted;
                });

            // Second pass: pair each user message's clarification_answer onto its
            // matching assistant question message as `clarificationAnswer`. The
            // user message's `content` is the answer text.
            for (const msg of formattedMessages) {
                const raw = msg.__clarificationAnswerRaw;
                if (!raw) continue;
                const target = formattedMessages.find((m: any) => m.id === raw.questionMessageId);
                if (target && target.type === 'assistant' && target.clarification) {
                    target.clarificationAnswer = {
                        text: msg.content || '',
                        answers: Array.isArray(raw.answers) && raw.answers.length > 0
                            ? raw.answers
                            : [{ chosenIndex: typeof raw.chosenIndex === 'number' ? raw.chosenIndex : null, text: msg.content || '' }],
                    };
                }
                delete msg.__clarificationAnswerRaw;
            }

            // Second pass for plan answers: pair each user message's plan_answer onto
            // its matching assistant plan message as `planAnswer`. The user message's
            // `content` is the response text (either 'Approved' or the feedback text).
            for (const msg of formattedMessages) {
                const raw = msg.__planAnswerRaw;
                if (!raw) continue;
                const target = formattedMessages.find((m: any) => m.id === raw.planMessageId);
                if (target && target.type === 'assistant' && target.plan) {
                    target.planAnswer = {
                        action: raw.action === 'approve' ? 'approve' : 'feedback',
                        feedbackText: typeof raw.feedbackText === 'string' ? raw.feedbackText : undefined,
                    };
                }
                delete msg.__planAnswerRaw;
            }

            // Clear existing and add new
            store.clearMessages();

            // Attach workflow to last assistant message (for Editor button visibility)
            let lastWorkflowMsgStatus: 'completed' | 'failed' | null = null;
            let lastWorkflowMsgHasError = false;

            if (formattedMessages.length > 0) {
                const lastAssistantIndex = formattedMessages.map((m: any) => m.type).lastIndexOf('assistant');
                if (lastAssistantIndex !== -1 && canvasRow.canvas_state?.nodes?.length > 0) {
                    formattedMessages[lastAssistantIndex].workflow = canvasRow.canvas_state;

                    // Dig back into the raw DB message to check the actual execution status
                    const lastMsgId = formattedMessages[lastAssistantIndex].id;
                    const rawMsg = messages.find((m: any) => m.id === lastMsgId);
                    if (rawMsg && (rawMsg.status === 'completed' || rawMsg.status === 'failed')) {
                        lastWorkflowMsgStatus = rawMsg.status;
                        lastWorkflowMsgHasError = !!rawMsg.metadata?.execution_error;
                    }
                }
            }

            formattedMessages.forEach((msg: any) => store.addMessage(msg));

            // Track which chat is active so a first message titles the right one.
            store.setActiveChatId((threadSession as any)?.active_chat_id ?? null);

            // Hydrate node statuses + outputs from node_results (DB is the
            // source of truth; the persisted store cache gets overwritten with
            // fresh values here).
            if (canvasRow.canvas_state?.nodes?.length > 0) {
                if (latestExecutionId) {
                    store.setActiveExecutionId(latestExecutionId);
                }

                const executionMap = new Map(
                    executions.map((exec: any) => [exec.nodeId, exec])
                );

                const isCompleted = lastWorkflowMsgStatus === 'completed' || lastWorkflowMsgStatus === 'failed';
                const isFailed = lastWorkflowMsgStatus === 'failed' || lastWorkflowMsgHasError;

                canvasRow.canvas_state.nodes.forEach((node: any) => {
                    const execution = executionMap.get(node.id);

                    if (execution) {
                        if (execution.status) {
                            let mappedStatus = execution.status;
                            if (mappedStatus === 'completed') mappedStatus = 'success';
                            if (mappedStatus === 'failed') mappedStatus = 'error';

                            // Downgrade guard — mirrors [lib/hooks/use-execution-channel.ts:32-35].
                            // A stale 'pending' row from a prior queueing must not overwrite
                            // a more-advanced 'running'/'success' that's already in the store
                            // (either persisted from before, or applied by realtime).
                            const current = useAppStore.getState().nodeStatuses[node.id];
                            const isStalePending =
                                mappedStatus === 'pending' &&
                                (current === 'running' || current === 'success');
                            if (!isStalePending) {
                                store.setNodeStatus(node.id, mappedStatus as import('@/lib/nodes/types').NodeStatus);
                            }
                        }

                        // Priority 1: Check the new outputMetadata property (from the new DB column)
                        if (execution.outputMetadata?.preview_urls && Array.isArray(execution.outputMetadata.preview_urls) && execution.outputMetadata.preview_urls.length > 0) {
                            const imageObjects = execution.outputMetadata.preview_urls.map((url: string, idx: number) => ({
                                url,
                                resolution: { width: 1024, height: 1024 },
                                metadata: { title: `Output ${idx + 1}`, source: 'Database' },
                            }));
                            store.setNodeOutput(node.id, imageObjects);
                        }
                        // Priority 2: Check legacy _metadata inside output
                        else if (execution.output?._metadata?.preview_urls && Array.isArray(execution.output._metadata.preview_urls) && execution.output._metadata.preview_urls.length > 0) {
                            const metadata = execution.output._metadata;
                            const imageObjects = metadata.preview_urls.map((url: string, idx: number) => ({
                                url,
                                resolution: { width: 1024, height: 1024 },
                                metadata: { title: `Output ${idx + 1}`, source: 'Database' },
                            }));
                            store.setNodeOutput(node.id, imageObjects);
                        }
                        // Priority 3: Fallback to raw output
                        else if (execution.output) {
                            store.setNodeOutput(node.id, execution.output);
                        }
                    } else if (isCompleted) {
                        // No execution record but session completed - mark as success/error
                        store.setNodeStatus(node.id, isFailed ? 'error' : 'success');
                    }
                });
            }

            setCurrentSessionId(sessionId);
            setError(null);

        } catch (error: any) {
            console.error('Failed to load session:', error);
            setError(error);
        } finally {
            setIsLoading(false);
            store.setIsLoadingSession(false); // Release guard
        }
    }, []);

    // Duplicate the currently-open workflow into a brand-new session owned by
    // the caller, then navigate straight to it. Used by the read-only banner so
    // a viewer can fork a shared workflow into their own files. The new session's
    // title is seeded from the workflow name (so "My Files" shows it right away),
    // and the canvas is copied with execution state stripped.
    const duplicateToMyFiles = useCallback(async () => {
        const store = useAppStore.getState();
        const wf = store.currentWorkflow;
        if (!wf) return;

        const title = (wf.name || '').trim() || 'Untitled Workflow';

        setIsLoading(true);
        try {
            // 1. Create the owned session (title up-front → mirrors the workflow name).
            const { session } = await sessionsApi.create(title);
            if (!session?.id) throw new Error('Failed to create duplicate session');
            const newId = session.id;

            // 2. Copy the canvas with a fresh id + name; strip per-node execution
            //    state (status/output/error) so the fork starts clean.
            const dupWorkflow: Workflow = {
                ...wf,
                id: newId,
                name: title,
                nodes: (wf.nodes || []).map((n: any) => ({
                    ...n,
                    data: { ...n.data, status: undefined, output: undefined, error: undefined },
                })),
                edges: wf.edges || [],
            };
            await sessionsApi.update(newId, { canvas_state: dupWorkflow, title });

            // 3. Optimistic store setup (mirrors createNewSession) so the
            //    destination opens immediately editable as owner, with no stale
            //    viewer role / peers and no role-resolution flash.
            store.setActiveSessionId(newId);
            store.setCollabRole('owner');
            store.setSessionRole(newId, 'owner');
            store.setActiveCanvasId(newId);
            store.setCurrentWorkflow(dupWorkflow, false);
            store.clearMessages();
            store.clearExecutionResults();
            store.resetNodeStatuses();
            store.clearNodeOutputs();

            router.push(`/chat/${newId}`);
        } catch (error) {
            console.error('[duplicateToMyFiles] Failed:', error);
            setIsLoading(false);
            throw error;
        }
        // NOTE: on success we leave isLoading true through the navigation; the
        // destination page's own loader takes over.
    }, [router]);

    // ── Chats within a session ──────────────────────────────────────────────
    // A session (workflow) holds multiple chats against its one canvas. These
    // operate on the per-user THREAD id (store.activeSessionId) — for a
    // collaborator that's their companion thread, where their messages live.

    // "New chat": archive the current conversation and open a fresh one in the
    // SAME session. The canvas is untouched; only the message thread resets.
    const createNewChat = useCallback(async () => {
        const store = useAppStore.getState();
        const threadId = store.activeSessionId;
        if (!threadId) return;
        // Optimistic: empty the conversation immediately (this also shrinks the
        // AI context, which is built from the in-memory messages).
        store.clearMessages();
        try {
            const { chat } = await chatsApi.create(threadId);
            // Track the new active chat so the first message titles THIS chat.
            if (chat?.id) store.setActiveChatId(chat.id);
        } catch (err) {
            console.error('[useSession] createNewChat failed:', err);
        }
    }, []);

    // Switch to a past chat: flip the active chat server-side, then re-hydrate
    // the conversation via loadSession (reuses all message formatting). The
    // canvas reloads from its saved state — unchanged, since chats share it.
    const switchChat = useCallback(async (chatId: string) => {
        const store = useAppStore.getState();
        const threadId = store.activeSessionId;
        const canvasId = store.activeCanvasId || threadId;
        if (!threadId || !canvasId) return;
        try {
            await chatsApi.open(threadId, chatId);
            store.setActiveChatId(chatId);
            await loadSession(canvasId);
        } catch (err) {
            console.error('[useSession] switchChat failed:', err);
        }
    }, [loadSession]);

    // Delete a session — OPTIMISTIC: navigate + clear state immediately, DB delete async
    const deleteSession = useCallback(async (sessionId: string) => {
        // Immediately update UI (don't wait for DB)
        if (currentSessionId === sessionId) {
            router.push('/chat');
            setCurrentSessionId(null);
            useAppStore.getState().clearMessages();
            useAppStore.getState().setCurrentWorkflow(null, false); // Don't trigger auto-save of null
        }

        // Fire-and-forget — delete from DB asynchronously
        sessionsApi.delete(sessionId).catch((error) => {
            console.error("Failed to delete session", error);
        });
    }, [currentSessionId, router]);

    return {
        createNewSession,
        createNewChat,
        switchChat,
        loadSession,
        deleteSession,
        duplicateToMyFiles,
        isLoading,
        currentSessionId,
        error // Export error state
    };
}
