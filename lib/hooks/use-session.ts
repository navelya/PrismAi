import { useState, useCallback } from 'react';
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
            const workflow: Workflow = {
                ...rawCanvas,
                id: session.id,
                name: rawCanvas.name || session.title || 'Untitled Workflow',
                nodes: (rawCanvas.nodes || []).map((n: any) => ({
                    ...n,
                    data: {
                        ...n.data,
                        // V3.1: Strip any legacy status/output from blueprint nodes so a stale
                        // "Success" from a previous run doesn't flash while fresh results load.
                        status: undefined,
                        output: undefined,
                        outputMetadata: undefined,
                        error: undefined,
                    },
                })),
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

                    const metadata = (msg.metadata ?? {}) as { thinking?: string | null; usage?: any };

                    return {
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
                });

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
