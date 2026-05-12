import { useState, useCallback, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store/app-store';
import { Workflow } from '@/lib/nodes/types';
import { sessionsApi } from '@/lib/api/client';
import { setServerWorkflowHash } from '@/lib/hooks/use-chat-realtime';
import { getSessionExecutions } from '@/lib/db/workflows';

export interface Session {
    id: string;
    title: string;
    updated_at: string;
    created_at: string;
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

    // Create a new session — mirrors the typing flow in use-chat-messages.ts
    // exactly. Generate the UUID client-side so the URL change and store
    // seeding happen synchronously (no awaiting the DB round-trip), then
    // fire the DB insert in the background and soft-navigate via replace +
    // startTransition. The new session opens with canvas mode on and the
    // copilot collapsed to a sidebar — matching what the user would see
    // after sending the first message in the typing flow.
    const createNewSession = useCallback(() => {
        const sessionId = crypto.randomUUID();
        const store = useAppStore.getState();

        store.setActiveSessionId(sessionId);
        store.setCurrentWorkflow({
            id: sessionId,
            name: 'Untitled Workflow',
            nodes: [],
            edges: [],
        }, false);
        store.clearMessages();
        store.clearExecutionResults();
        store.resetNodeStatuses();
        store.clearNodeOutputs();
        store.setIsCanvasMode(true);
        store.setIsCopilotMinimized(false);

        // Fire the DB insert in the background — don't await. Matches the
        // typing flow's pattern.
        sessionsApi.create('New Workflow', sessionId).catch((err) => {
            console.error('Failed to create session:', err);
        });

        startTransition(() => {
            router.replace(`/chat/${sessionId}`, { scroll: false });
        });
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


        try {
            // Fire both reads in parallel — they have no dependency on each other,
            // and running them sequentially adds 100-300ms to the time-to-first
            // correct render.
            const [sessionResult, executionsResult] = await Promise.all([
                sessionsApi.load(sessionId),
                getSessionExecutions(sessionId),
            ]);
            const { session, messages } = sessionResult;
            const { executions, latestExecutionId } = executionsResult;

            // STALE CHECK: If the user navigated away while we were loading, ignore results
            const currentStore = useAppStore.getState();
            if (currentStore.activeSessionId !== sessionId) {
                console.warn('[useSession] Ignoring stale session load for:', sessionId);
                return;
            }

            // Hydrate Workflow from Session State (primary source of truth for blueprint/layout).
            // Freshly-created sessions store canvas_state as `{}` (the column default), so we
            // must still hand the store a valid empty workflow — otherwise currentWorkflow stays
            // null and onNodesChange/onConnect bail on their null guards, making it impossible
            // to add the first node.
            const rawCanvas = (session.canvas_state || {}) as Partial<Workflow>;
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
                id: session.id,
                name: rawCanvas.name || session.title || 'Untitled Workflow',
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
                        clarification?: { options: string[] } | null;
                        clarification_answer?: { questionMessageId: string; chosenIndex: number | null } | null;
                        plan?: {
                            title: string;
                            summary: string;
                            arrows: string;
                            models: string[];
                            detail: string;
                            blueprint?: { nodes?: any[]; edges?: any[] };
                        } | null;
                        plan_answer?: {
                            planMessageId: string;
                            action: 'approve' | 'feedback';
                            feedbackText?: string;
                        } | null;
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
                    };

                    if (msg.role === 'assistant' && metadata.clarification?.options) {
                        formatted.clarification = { options: metadata.clarification.options };
                    }

                    if (msg.role === 'assistant' && metadata.plan) {
                        formatted.plan = {
                            title: typeof metadata.plan.title === 'string' ? metadata.plan.title : '',
                            summary: typeof metadata.plan.summary === 'string' ? metadata.plan.summary : '',
                            arrows: typeof metadata.plan.arrows === 'string' ? metadata.plan.arrows : '',
                            models: Array.isArray(metadata.plan.models) ? metadata.plan.models.filter((s: any) => typeof s === 'string') : [],
                            detail: typeof metadata.plan.detail === 'string' ? metadata.plan.detail : '',
                        };
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
                        chosenIndex: typeof raw.chosenIndex === 'number' ? raw.chosenIndex : null,
                        text: msg.content || '',
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
                if (lastAssistantIndex !== -1 && session.canvas_state?.nodes?.length > 0) {
                    formattedMessages[lastAssistantIndex].workflow = session.canvas_state;

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

            // Hydrate node statuses + outputs from node_results (DB is the
            // source of truth; the persisted store cache gets overwritten with
            // fresh values here).
            if (session.canvas_state?.nodes?.length > 0) {
                if (latestExecutionId) {
                    store.setActiveExecutionId(latestExecutionId);
                }

                const executionMap = new Map(
                    executions.map((exec: any) => [exec.nodeId, exec])
                );

                const isCompleted = lastWorkflowMsgStatus === 'completed' || lastWorkflowMsgStatus === 'failed';
                const isFailed = lastWorkflowMsgStatus === 'failed' || lastWorkflowMsgHasError;

                session.canvas_state.nodes.forEach((node: any) => {
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
        loadSession,
        deleteSession,
        isLoading,
        currentSessionId,
        error // Export error state
    };
}
