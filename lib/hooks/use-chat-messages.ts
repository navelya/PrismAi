import { useState, useRef, useEffect, MutableRefObject, Dispatch, SetStateAction, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Workflow, NodeStatus } from '@/lib/nodes/types';
import { Message } from '@/lib/store/app-store';
import { useAppStore } from '@/lib/store/app-store';
import { useShallow } from 'zustand/react/shallow';
import { messagesApi, sessionsApi, uploadApi } from '@/lib/api/client';
import { createClient } from '@/lib/supabase/client';
import { applyWorkflowPatch } from '@/lib/workflow/workflow-patch';
import { expandSelectionForChat } from '@/lib/utils/selection-refs';
import { extractRenderableMedia } from '@/lib/workflow/result-format';
import { collectTerminalRunMedia } from '@/lib/workflow/run-media';
import { firstChatRunError } from '@/lib/workflow/validate-chat-run';
import { buildPreferencesPayload } from '@/lib/chat/preferences';


async function persistRunProposal(messageId: string) {
    try {
        const msg = useAppStore.getState().chatMessages.find((m) => m.id === messageId);
        if (!msg) return;
        await fetch(`/api/messages/${messageId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                metadata: {
                    run_proposal: msg.runProposal ?? null,
                    inline_result_ids: msg.inlineResultIds ?? null,
                },
            }),
        });
    } catch (e) {
        console.error('[chat-run] persistRunProposal failed', e);
    }
}

async function persistFrozenResult(messageId: string, result: any) {
    try {
        const msg = useAppStore.getState().chatMessages.find((m) => m.id === messageId);
        await fetch(`/api/messages/${messageId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                metadata: {
                    execution_result: result,
                    run_proposal: msg?.runProposal ?? null,
                },
            }),
        });
    } catch (e) {
        console.error('[chat-run] persistFrozenResult failed', e);
    }
}

export interface UseChatMessagesProps {
    sessionId?: string;
    onWorkflowGenerated: (workflow: Workflow) => void;
    abortControllerRef: MutableRefObject<AbortController | null>;
}

export function useChatMessages({
    sessionId,
    onWorkflowGenerated,
    abortControllerRef
}: UseChatMessagesProps) {
    const router = useRouter();
    const messages = useAppStore(useShallow((state) =>
        sessionId ? state.chatMessages.filter(m => m.sessionId === sessionId) : state.chatMessages
    ));
    const addMessage = useAppStore((state) => state.addMessage);
    const isLoading = useAppStore((state) => state.isLoading);
    const setIsLoading = useAppStore((state) => state.setIsLoading);
    const setStatusMessage = useAppStore((state) => state.setStatusMessage);
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

    // Freeze a chat-run's inline results onto the message when its terminal
    // nodes all settle, and flip the RunProposalCard status accordingly.
    const nodeStatusesForRun = useAppStore((s) => s.nodeStatuses);
    // Subscribed so the freeze re-evaluates when a terminal's output (and its
    // execution stamp) lands — setNodeStatus no-ops once a node is already
    // 'success', so a status-only dependency would miss the moment THIS run's
    // output finally replaces a stale prior one.
    const nodeOutputExecutionsForRun = useAppStore((s) => s.nodeOutputExecutions);
    useEffect(() => {
        const msgs = useAppStore.getState().chatMessages;
        for (const m of msgs) {
            const rp = m.runProposal;
            if (!rp || rp.status !== 'running') continue;
            const ids = rp.terminalIds.length ? rp.terminalIds : rp.runTargetIds;
            const statuses = ids.map((id) => nodeStatusesForRun[id]);
            if (statuses.some((s) => s === 'pending' || s === 'running' || s === undefined)) continue;

            const anyError = statuses.some((s) => s === 'error');
            if (anyError) {
                useAppStore.getState().updateMessage(m.id, {
                    runProposal: { ...rp, status: 'failed' },
                });
                void persistRunProposal(m.id);
                continue;
            }

            // Execution-correlation gate: when this card knows the execution it
            // dispatched under, only freeze once the terminals' outputs were
            // produced by THAT execution. A terminal still carrying a prior
            // run's output (e.g. an out-of-order completion from a superseded
            // execution) means this run's result hasn't landed yet — wait.
            const outExecs = useAppStore.getState().nodeOutputExecutions || {};
            if (rp.executionId && ids.some((id) => {
                const stamp = outExecs[id];
                return stamp !== undefined && stamp !== rp.executionId;
            })) {
                continue;
            }

            // All terminals succeeded — freeze their MEDIA outputs (image +
            // video, type preserved) into `result`. Text outputs (e.g. a prompt
            // node's string) are intentionally NOT shown as a chat result.
            // Use collectTerminalRunMedia, NOT nodeOutputs directly: an
            // ai_generator narrows nodeOutputs to its single selected output, so a
            // fan-out (iterations > 1) run would otherwise freeze just 1 of N.
            const store = useAppStore.getState();
            const media: ReturnType<typeof extractRenderableMedia> = [];
            for (const id of ids) {
                const node = store.currentWorkflow?.nodes.find((n) => n.id === id);
                media.push(...collectTerminalRunMedia(node, store.nodeOutputs?.[id], rp.executionId));
            }
            const frozen = media.length ? media : null;
            useAppStore.getState().updateMessage(m.id, {
                result: frozen,
                runProposal: { ...rp, status: 'done' },
            });
            void persistFrozenResult(m.id, frozen);
        }
    }, [nodeStatusesForRun, nodeOutputExecutionsForRun]);

    // Durable-URL convergence. When a chat run's terminal node is ephemeral
    // (compositor, blur, …) its output is first frozen with a
    // `workflow-ephemeral-tmp` URL — which the orchestrator then promotes to the
    // durable `chat-assets` bucket and rewrites the node_results row. That
    // rewrite arrives via realtime as a fresh nodeOutputs URL; swap the frozen
    // result over to it so the result doesn't 404 once the ephemeral original is
    // cleaned up. The live inline preview keeps showing the video throughout, so
    // this swap is invisible to the user.
    const nodeOutputsForRun = useAppStore((s) => s.nodeOutputs);
    useEffect(() => {
        const msgs = useAppStore.getState().chatMessages;
        for (const m of msgs) {
            const rp = m.runProposal;
            if (!rp || rp.status !== 'done') continue;
            const result = m.result as ReturnType<typeof extractRenderableMedia> | null;
            if (!Array.isArray(result) || result.length === 0) continue;
            // Only act while something is still pinned to the ephemeral bucket.
            if (!result.some((it) => typeof it?.url === 'string' && it.url.includes('workflow-ephemeral-tmp'))) continue;

            const ids = rp.terminalIds.length ? rp.terminalIds : rp.runTargetIds;
            const fresh: ReturnType<typeof extractRenderableMedia> = [];
            for (const id of ids) {
                for (const item of extractRenderableMedia(nodeOutputsForRun?.[id])) {
                    if (item.type === 'image' || item.type === 'video') fresh.push(item);
                }
            }
            if (fresh.length === 0) continue;
            // Durable URL hasn't landed yet — wait for the next realtime tick.
            if (fresh.some((it) => it.url.includes('workflow-ephemeral-tmp'))) continue;

            const sameUrls =
                fresh.length === result.length && fresh.every((it, i) => it.url === result[i]?.url);
            if (sameUrls) continue;

            useAppStore.getState().updateMessage(m.id, { result: fresh });
            void persistFrozenResult(m.id, fresh);
        }
    }, [nodeOutputsForRun]);

    // Helper to save messages via BFF API
    const saveMessageToDb = async (msg: Message, imagePaths?: string[]) => {
        const activeSessionId = sessionId;
        if (!activeSessionId) return;

        const role = msg.type;
        const imagesToSave = imagePaths || [];

        try {
            const { message } = await messagesApi.create(activeSessionId, {
                role,
                content: msg.content || '',
                images: imagesToSave,
                created_at: msg.timestamp.toISOString(),
                // Intentionally omit canvas_state to avoid heavy snapshots per message
            });

            if (message && message.id) {
                useAppStore.getState().updateMessage(msg.id, { id: message.id });
                msg.id = message.id;
            }
        } catch (err: any) {
            console.error('Failed to save message:', err);
        }
    };

    const handleRevert = async (messageId: string, skipConfirmation = false) => {
        const isInitial = messageId === 'initial';
        const confirmMsg = isInitial
            ? 'This will clear the current session and restart. Are you sure?'
            : 'Are you sure you want to rewind to this state? Future messages will be lost.';

        if (!skipConfirmation && !confirm(confirmMsg)) return;

        try {
            setIsLoading(true);

            if (isInitial) {
                const activeSessionId = sessionId;
                if (activeSessionId) {
                    await sessionsApi.reset(activeSessionId);
                }
                useAppStore.getState().setCurrentWorkflow(null);
                useAppStore.getState().clearMessages();
            } else {
                const { success, workflow } = await messagesApi.revert(messageId);

                if (success && workflow) {
                    useAppStore.getState().setCurrentWorkflow(workflow);

                    const targetIndex = messages.findIndex(m => m.id === messageId);
                    if (targetIndex !== -1) {
                        const newMessages = messages.slice(0, targetIndex + 1);
                        useAppStore.getState().clearMessages();
                        newMessages.forEach(msg => {
                            addMessage(msg);
                        });
                    }
                }
            }
        } catch (error) {
            console.error('Revert failed:', error);
            alert('Failed to rewind workflow.');
        } finally {
            setIsLoading(false);
            setStatusMessage(null);
        }
    };

    const handleStop = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsLoading(false);
        setStatusMessage(null);

        const stopMessage: Message = {
            id: Date.now().toString(),
            type: 'assistant',
            content: '⏹️ Workflow stopped by user.',
            timestamp: new Date(),
        };
        addMessage(stopMessage);
    };

    const handleSend = async (
        trimmedInput: string,
        attachedBlobs: Blob[],
        attachedImages: string[],
        clearAttachments: () => void,
        setInput: (val: string) => void,
        clarificationAnswerOverride?: { questionMessageId: string; answers: { chosenIndex: number | null; text: string }[] },
        planAnswerOverride?: { planMessageId: string; action: 'approve' | 'feedback'; feedbackText?: string },
        mentionedCharacterIds?: string[],
    ) => {
        if (!trimmedInput && attachedImages.length === 0) return;

        // Resolve clarification answer: explicit override (from a chip click) OR
        // implicit (the most recent assistant message has a pending clarification
        // and the user is responding via the main chat input). Use the
        // session-filtered `messages` slice (top of hook) so we never pair an
        // outgoing message with an unanswered clarification from a different
        // session that happens to coexist in the store.
        let resolvedClarificationAnswer: { questionMessageId: string; answers: { chosenIndex: number | null; text: string }[] } | undefined =
            clarificationAnswerOverride;
        if (!resolvedClarificationAnswer) {
            for (let i = messages.length - 1; i >= 0; i--) {
                const m = messages[i];
                if (m.type === 'assistant') {
                    const hasPending = (m.clarification?.options?.length || m.clarification?.questions?.length);
                    if (hasPending && !m.clarificationAnswer) {
                        // Implicit answer typed into the main input — treat as one
                        // free-text answer (the card is the structured path).
                        resolvedClarificationAnswer = {
                            questionMessageId: m.id,
                            answers: [{ chosenIndex: null, text: trimmedInput }],
                        };
                    }
                    break; // only inspect the most recent assistant in this session
                }
            }
        }

        // Resolve plan answer: explicit override (from approve / feedback button) OR
        // implicit (the most recent assistant message has a pending plan and the
        // user is responding via the main chat input — treated as feedback).
        let resolvedPlanAnswer: { planMessageId: string; action: 'approve' | 'feedback'; feedbackText?: string } | undefined =
            planAnswerOverride;
        if (!resolvedPlanAnswer) {
            for (let i = messages.length - 1; i >= 0; i--) {
                const m = messages[i];
                if (m.type === 'assistant') {
                    if (m.plan && !m.planAnswer) {
                        resolvedPlanAnswer = {
                            planMessageId: m.id,
                            action: 'feedback',
                            feedbackText: trimmedInput,
                        };
                    }
                    break; // only inspect the most recent assistant in this session
                }
            }
        }

        // 📸 Capture history snapshot BEFORE any optimistic updates or clearing
        const historySnapshot = useAppStore.getState().chatMessages;

        if (editingMessageId) {
            // ... (לוגיקת ה-Revert המקורית שלך נשארת כאן כרגיל)
            const msgIndex = messages.findIndex((m: any) => m.id === editingMessageId);
            if (msgIndex !== -1) {
                let undoSnapshotId = 'initial';
                for (let i = msgIndex - 1; i >= 0; i--) {
                    const m = messages[i];
                    if (m.type === 'assistant' && m.workflow) {
                        undoSnapshotId = m.id;
                        break;
                    }
                }
                await handleRevert(undoSnapshotId, true);
                setEditingMessageId(null);
            }
        }

        const imagesToSend = [...attachedImages];
        clearAttachments();
        setInput('');

        // --- Initial Session Check (CRITICAL: Before adding messages) ---
        let activeSessionId = sessionId || useAppStore.getState().activeSessionId;
        let sessionCreationPromise: Promise<any> | null = null;

        if (!activeSessionId) {
            activeSessionId = crypto.randomUUID();
            useAppStore.getState().setActiveSessionId(activeSessionId);

            // This freshly-created session is owned by the current user.
            // setActiveSessionId above already cleared any stale collab role/peers
            // from a previously-open shared (viewer) workflow; loadSession is then
            // SKIPPED for this session (it carries optimistic messages — see
            // app/chat/[id]/page.tsx), so set 'owner' + the canvas id here or the
            // user is stuck read-only with ghost peers until a refresh.
            useAppStore.getState().setCollabRole('owner');
            useAppStore.getState().setSessionRole(activeSessionId, 'owner');
            useAppStore.getState().setActiveCanvasId(activeSessionId);

            // Background initialization
            sessionCreationPromise = sessionsApi.create('', activeSessionId)
                .then((res) => {
                    // Track the session's initial active chat so this + later
                    // messages title the correct chat.
                    if ((res as any)?.session?.active_chat_id) {
                        useAppStore.getState().setActiveChatId((res as any).session.active_chat_id);
                    }
                    return res;
                })
                .catch(err => console.error("[Session Create] Error:", err));
            sessionsApi.generateTitle({
                sessionId: activeSessionId,
                message: trimmedInput
            }).catch(err => console.error('[TitleGen] Error:', err));

            // Smooth background transition (URL change only)
            startTransition(() => {
                router.replace(`/chat/${activeSessionId}`, { scroll: false });
            });
        } else if (historySnapshot.length === 0) {
            // First message of a FRESH chat inside an existing session (e.g. after
            // "New chat"): the session already exists, so just title the active
            // chat from this message. The snapshot was captured before optimistic
            // adds, so length 0 means the active chat is empty. Pass the chat id
            // explicitly so the title lands on THIS chat even if the user starts
            // another chat before the async title call returns.
            sessionsApi.generateTitle({
                sessionId: activeSessionId,
                message: trimmedInput,
                chatId: useAppStore.getState().activeChatId || undefined,
            }).catch(err => console.error('[TitleGen] Error:', err));
        }

        // 👑 Immediate UI update with guaranteed activeSessionId in store.
        // Use real UUIDs (not "assistant-<timestamp>") so the in-memory ID
        // matches the DB row's id after persistence — required for the
        // clarification-answer pairing to survive a page refresh.
        const userMsgId = crypto.randomUUID();
        const assistantMsgId = crypto.randomUUID();

        const nodeRefs = expandSelectionForChat(
            useAppStore.getState().currentSelectedNodeIds,
            useAppStore.getState().currentWorkflow,
        );

        addMessage({
            id: userMsgId,
            type: 'user',
            content: trimmedInput,
            images: imagesToSend.length > 0 ? imagesToSend : undefined,
            timestamp: new Date(),
            nodeRefs: nodeRefs.length > 0 ? nodeRefs : undefined,
        });

        // Skip the optimistic empty assistant bubble for the approve path —
        // the server applies the blueprint and emits tool + usage + done with
        // no `text` events, so the empty bubble would never get filled and
        // render as a permanent ghost (bouncing dots) below the plan card.
        // Feedback turns DO produce an assistant turn (the next plan), so we
        // keep the optimistic bubble for those.
        if (resolvedPlanAnswer?.action !== 'approve') {
            addMessage({
                id: assistantMsgId,
                type: 'assistant',
                content: '',
                status: 'running',
                timestamp: new Date(),
            });
        }

        if (resolvedClarificationAnswer) {
            useAppStore.getState().updateMessage(resolvedClarificationAnswer.questionMessageId, {
                clarificationAnswer: {
                    text: trimmedInput,
                    answers: resolvedClarificationAnswer.answers,
                },
            });
        }

        if (resolvedPlanAnswer) {
            useAppStore.getState().updateMessage(resolvedPlanAnswer.planMessageId, {
                planAnswer: {
                    action: resolvedPlanAnswer.action,
                    feedbackText: resolvedPlanAnswer.action === 'feedback' ? resolvedPlanAnswer.feedbackText : undefined,
                },
                planApproveError: undefined, // clear any prior approve-failed state
            });
            // Mirror planAnswer onto the synthetic user message so the
            // 'Approved' bubble is suppressed by Message.tsx's render guard
            // (the suppression check lives in Task 10).
            if (resolvedPlanAnswer.action === 'approve') {
                useAppStore.getState().updateMessage(userMsgId, {
                    planAnswer: { action: 'approve' },
                });
            }
        }

        setIsLoading(true);
        setStatusMessage('Prism is thinking...');

        // --- קריאה לשרת הסטרימינג ---
        try {
            if (sessionCreationPromise) {
                // Ensure the database has the session row BEFORE hitting the stream API
                // so the user message insert doesn't fail due to foreign key constraints!
                await sessionCreationPromise;
            }

            const userMsg: Message = {
                id: userMsgId,
                type: 'user',
                content: trimmedInput,
                images: imagesToSend.length > 0 ? imagesToSend : undefined,
                timestamp: new Date(),
                nodeRefs: nodeRefs.length > 0 ? nodeRefs : undefined,
            };

            // Build the full history using the snapshot taken BEFORE optimistic updates
            const fullHistory = [...historySnapshot, userMsg];

            // Begin a new "AI turn" so <AiAddedZoom /> can track which nodes the
            // AI touches during this stream and smoothly fit the camera to them.
            useAppStore.getState().beginAiTurn();

            const response = await fetch('/api/chat/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: fullHistory,
                    sessionId: activeSessionId,
                    previousWorkflow: useAppStore.getState().currentWorkflow,
                    attachedImages: imagesToSend,
                    clarificationAnswer: resolvedClarificationAnswer,
                    planAnswer: resolvedPlanAnswer,
                    userMessageId: userMsgId,
                    assistantMessageId: assistantMsgId,
                    nodeRefs: nodeRefs.length > 0 ? nodeRefs : undefined,
                    mentionedCharacterIds: mentionedCharacterIds && mentionedCharacterIds.length > 0 ? mentionedCharacterIds : undefined,
                    // Standing composer preferences (non-Auto only). The store
                    // value is the source of truth; resolve model ids to
                    // {id, display_name} here so the server need not re-look-up.
                    preferences: buildPreferencesPayload(
                        useAppStore.getState().chatPreferences,
                        useAppStore.getState().models as any,
                    ) ?? undefined,
                }),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Server error: ${errText}`);
            }
            if (!response.body) throw new Error('No response body');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let networkText = '';
            let displayedText = '';
            let streamDone = false;
            let buffer = '';
            let finalWorkflow: Workflow | undefined = undefined;
            let runRequestIds: string[] | null = null;
            let streamingWorkflowCursor: Workflow | null | undefined = useAppStore.getState().currentWorkflow;

            const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

            const renderLoop = async () => {
                while (!streamDone || displayedText.length < networkText.length) {
                    if (displayedText.length < networkText.length) {
                        const remaining = networkText.length - displayedText.length;
                        const charsToAdd = Math.max(1, Math.ceil(remaining * 0.3));
                        displayedText += networkText.substring(displayedText.length, displayedText.length + charsToAdd);

                        useAppStore.getState().updateMessage(assistantMsgId, {
                            content: displayedText
                        });
                    }
                    await nextFrame();
                }

                // Update message with final workflow after streaming completes
                if (finalWorkflow) {
                    useAppStore.getState().updateMessage(assistantMsgId, {
                        content: displayedText,
                        workflow: finalWorkflow
                    });
                }
                
                setIsLoading(false);
                setStatusMessage(null);

                // Assistant message generation and local state update are finished.
                // 🛑 DELETED: saveMessageToDb call removed.
                // Persistence is handled server-side in stream/route.ts.
            };

            renderLoop();

            const processStreamLine = async (parsed: any) => {
                if (parsed.type === 'text') {
                    // Accept either new-brain `text` field or legacy `content` field
                    const chunk = parsed.text ?? parsed.content ?? '';
                    networkText += chunk;
                }
                else if (parsed.type === 'thinking_start') {
                    const current = useAppStore.getState().chatMessages.find(m => m.id === assistantMsgId);
                    useAppStore.getState().updateMessage(assistantMsgId, {
                        thinking: current?.thinking ?? '',
                        isThinking: true,
                        thinkingStartedAt: Date.now(),
                    });
                }
                else if (parsed.type === 'thinking_delta') {
                    const current = useAppStore.getState().chatMessages.find(m => m.id === assistantMsgId);
                    useAppStore.getState().updateMessage(assistantMsgId, {
                        thinking: (current?.thinking ?? '') + (parsed.text ?? ''),
                    });
                }
                else if (parsed.type === 'thinking_end') {
                    const current = useAppStore.getState().chatMessages.find(m => m.id === assistantMsgId);
                    useAppStore.getState().updateMessage(assistantMsgId, {
                        isThinking: false,
                        thinkingDurationMs: Date.now() - (current?.thinkingStartedAt ?? Date.now()),
                    });
                }
                else if (parsed.type === 'usage') {
                    useAppStore.getState().updateMessage(assistantMsgId, {
                        usage: {
                            inputTokens: parsed.inputTokens,
                            outputTokens: parsed.outputTokens,
                            thinkingTokens: parsed.thinkingTokens,
                            costUsd: parsed.costUsd,
                        },
                    });
                }
                else if (parsed.type === 'model') {
                    useAppStore.getState().updateMessage(assistantMsgId, {
                        model: parsed.model === 'haiku' || parsed.model === 'sonnet' ? parsed.model : undefined,
                    });
                }
                else if (parsed.type === 'switching') {
                    // The fast lane is handing off to the heavy lane, which
                    // re-runs the turn from scratch. Discard any fast-lane
                    // preamble already streamed so the live bubble matches what
                    // gets persisted (only the heavy-lane output).
                    networkText = '';
                    displayedText = '';
                    useAppStore.getState().updateMessage(assistantMsgId, { content: '' });
                    setStatusMessage('Thinking deeper…');
                }
                else if (parsed.type === 'clarification') {
                    // New shape: questions[]. Tolerate the legacy flat options[] too.
                    const questions = Array.isArray(parsed.questions)
                        ? parsed.questions
                        : Array.isArray(parsed.options)
                            ? [{ question: '', options: parsed.options }]
                            : [];
                    useAppStore.getState().updateMessage(assistantMsgId, {
                        clarification: { questions },
                    });
                }
                else if (parsed.type === 'tool_start' && parsed.name === 'propose_plan') {
                    useAppStore.getState().updateMessage(assistantMsgId, {
                        planLoading: true,
                    });
                }
                else if (parsed.type === 'plan') {
                    const p = parsed.plan;
                    if (p && typeof p === 'object') {
                        useAppStore.getState().updateMessage(assistantMsgId, {
                            plan: {
                                title: typeof p.title === 'string' ? p.title : '',
                                summary: typeof p.summary === 'string' ? p.summary : '',
                                arrows: typeof p.arrows === 'string' ? p.arrows : '',
                                models: Array.isArray(p.models) ? p.models.filter((s: any) => typeof s === 'string') : [],
                                detail: typeof p.detail === 'string' ? p.detail : '',
                                blueprint: {
                                    nodes: Array.isArray(p.blueprint?.nodes) ? p.blueprint.nodes : [],
                                    edges: Array.isArray(p.blueprint?.edges) ? p.blueprint.edges : [],
                                },
                                tasks: Array.isArray(p.tasks) ? p.tasks : undefined,
                            },
                        });
                    }
                }
                else if (parsed.type === 'task_start') {
                    // Drive TaskProgressCard live during the approve/apply loop.
                    // The progress is stored on the plan message so the card that
                    // owns the task list can update in place.
                    const planMsgId = resolvedPlanAnswer?.planMessageId;
                    if (planMsgId) {
                        useAppStore.getState().updateMessage(planMsgId, {
                            taskProgress: {
                                status: 'running',
                                currentIndex: typeof parsed.index === 'number' ? parsed.index : 0,
                                total: typeof parsed.total === 'number' ? parsed.total : 0,
                            },
                        });
                    }
                }
                else if (parsed.type === 'task_complete') {
                    const planMsgId = resolvedPlanAnswer?.planMessageId;
                    if (planMsgId) {
                        useAppStore.getState().updateMessage(planMsgId, {
                            taskProgress: {
                                status: 'running',
                                currentIndex: typeof parsed.index === 'number' ? parsed.index + 1 : 1,
                                total: typeof parsed.total === 'number' ? parsed.total : 0,
                            },
                        });
                    }
                }
                else if (parsed.type === 'tasks_complete') {
                    const planMsgId = resolvedPlanAnswer?.planMessageId;
                    if (planMsgId) {
                        const total = typeof parsed.total === 'number' ? parsed.total : 0;
                        useAppStore.getState().updateMessage(planMsgId, {
                            taskProgress: {
                                status: 'done',
                                currentIndex: total,
                                total,
                            },
                        });
                    }
                }
                else if (parsed.type === 'tool' && ['add_node', 'update_node', 'update_compositor_layer', 'remove_node', 'mutate_workflow'].includes(parsed.name)) {
                    if (parsed.message) {
                        networkText += (networkText ? '\n\n' : '') + parsed.message;
                    }

                    const appStore = useAppStore.getState();
                    if (parsed.patch) {
                        // (No client-side position recalc — the server (runAddNode) has already
                        // translated the batch to sit beside the existing canvas. We trust
                        // whatever positions arrive in the patch. This kills the "huge gaps
                        // between nodes" symptom and avoids treating group children's parent-
                        // relative coordinates as absolute.)

                        const patched = applyWorkflowPatch(streamingWorkflowCursor, parsed.patch);
                        const styledEdges = (patched.edges || []).map((edge: any) => ({
                            ...edge,
                            type: edge.type || 'smoothstep',
                            animated: typeof edge.animated === 'boolean' ? edge.animated : true
                        }));

                        streamingWorkflowCursor = {
                            ...patched,
                            edges: styledEdges
                        } as any;

                        appStore.setCurrentWorkflow(streamingWorkflowCursor as any, true);

                        // Notify the AI-zoom tracker about the new patch so the
                        // canvas can debounce-fit the touched nodes into view.
                        appStore.recordAiPatch(parsed.patch);

                        finalWorkflow = streamingWorkflowCursor || undefined;
                        await nextFrame();
                    }
                }
                else if (parsed.type === 'runRequest') {
                    runRequestIds = Array.isArray(parsed.nodeIds)
                        ? parsed.nodeIds.filter((x: unknown): x is string => typeof x === 'string')
                        : null;
                }
                else if (parsed.type === 'error') {
                    const errorText = parsed.message ?? parsed.content ?? 'Unknown error';
                    // Special-case: if this turn is an approve attempt, route the error
                    // to the plan card's planApproveError instead of the message body so
                    // the user sees it in context (and the optimistic approved state
                    // reverts to pending).
                    if (resolvedPlanAnswer?.action === 'approve') {
                        useAppStore.getState().updateMessage(resolvedPlanAnswer.planMessageId, {
                            planAnswer: undefined, // revert optimistic approved transition
                            planApproveError: errorText,
                        });
                    } else {
                        networkText += (networkText ? '\n\n' : '') + `⚠️ ${errorText}`;
                    }
                }
                else if (parsed.type === 'done') {
                    // Mark message as completed when the stream signals done.
                    // Also clear planLoading: it's set on `tool_start: propose_plan`
                    // but only ever cleared implicitly by a `plan` event. If the
                    // plan never materialized (validation failed, the model took a
                    // different route, etc.) the PlanCardSkeleton + "Creating plan"
                    // step would otherwise spin forever. The turn is over now.
                    useAppStore.getState().updateMessage(assistantMsgId, {
                        status: 'completed',
                        planLoading: false,
                        isThinking: false,
                    });
                }
            };

            // Queue-based line processor: ensures sequential processing
            const lineQueue: string[] = [];

            const drainQueue = async () => {
                while (lineQueue.length > 0) {
                    const line = lineQueue.shift()!;
                    if (!line.trim()) continue;
                    try {
                        const parsed = JSON.parse(line);
                        await processStreamLine(parsed);
                        // NO DELAYS - stream naturally as fast as it arrives
                    } catch (e) {}
                }
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    if (buffer.trim()) lineQueue.push(buffer);
                    await drainQueue();
                    streamDone = true;
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) lineQueue.push(line);

                // Drain after each network chunk so nodes appear as they arrive
                await drainQueue();
            }

            // ── Chat-run decision (Approach A) ──────────────────────────────
            // Bound to end-of-stream on the CLEAN path only. Never per-tool,
            // never per-task, never in catch. This is what guarantees a
            // multi-task plan runs ONCE, after all tasks finish.
            try {
                const store = useAppStore.getState();
                const touched = store.aiTurn?.touchedNodeIds ?? [];
                const workflow = store.currentWorkflow;
                if (streamDone && touched.length > 0 && workflow) {
                    const { buildRunPlan } = await import('@/lib/billing/run-plan');
                    const { buildModelsMap } = await import('@/lib/billing/cost');
                    const modelsById = buildModelsMap(store.models as any[]);
                    const plan = buildRunPlan(workflow as any, touched, modelsById);

                    if (plan.runTargetIds.length > 0) {
                        // First-time auto-run intro: the very first paid (cost > 0,
                        // models known) run proposal a user reaches gets a one-time
                        // explainer modal instead of auto-running. Attach a 'ready'
                        // card as a holding state and hand the run to the modal, which
                        // saves the chosen limit and runs (or not) on approve.
                        const isPaidKnown = plan.cost > 0 && plan.missingModels.length === 0;
                        if (isPaidKnown && store.autoRunEnabled && !store.hasSeenAutoRunIntro) {
                            useAppStore.getState().updateMessage(assistantMsgId, {
                                inlineResultIds: plan.terminalIds,
                                runProposal: {
                                    runTargetIds: plan.runTargetIds,
                                    terminalIds: plan.terminalIds,
                                    cost: plan.cost,
                                    status: 'ready',
                                    expectedResultCount: plan.expectedResultCount,
                                },
                            });
                            store.openAutoRunIntro({
                                runTargetIds: plan.runTargetIds,
                                terminalIds: plan.terminalIds,
                                cost: plan.cost,
                                messageId: assistantMsgId,
                            });
                            void persistRunProposal(assistantMsgId);
                        } else {
                            // STAGE 2: auto-run when cost is at/under the user's limit AND
                            // all models are known. A missing model means the real cost is
                            // unknown — never auto-run it.
                            const shouldAutoRun = store.autoRunEnabled && plan.cost <= store.maxAutoRunCredits && plan.missingModels.length === 0;

                            // Pre-flight validation: if commitExecution would abort
                            // (e.g. a node's mandatory input isn't wired yet), don't
                            // mark 'running' — that left the card stuck on "Running…"
                            // with nothing happening. Show the reason instead.
                            const runErr = shouldAutoRun
                                ? firstChatRunError(workflow as any, plan.runTargetIds, store.models as any[])
                                : null;

                            if (shouldAutoRun && !runErr) {
                            useAppStore.getState().updateMessage(assistantMsgId, {
                                inlineResultIds: plan.terminalIds,
                                runProposal: {
                                    runTargetIds: plan.runTargetIds,
                                    terminalIds: plan.terminalIds,
                                    cost: plan.cost,
                                    status: 'running',
                                    expectedResultCount: plan.expectedResultCount,
                                },
                            });
                            store.triggerRunSelection(plan.runTargetIds, { preconfirmed: true });
                        } else {
                            useAppStore.getState().updateMessage(assistantMsgId, {
                                inlineResultIds: plan.terminalIds,
                                runProposal: {
                                    runTargetIds: plan.runTargetIds,
                                    terminalIds: plan.terminalIds,
                                    cost: plan.cost,
                                    status: 'ready',
                                    error: runErr ?? undefined,
                                    expectedResultCount: plan.expectedResultCount,
                                },
                            });
                        }
                            // Persist the proposal so it survives refresh as a manual card.
                            void persistRunProposal(assistantMsgId);
                        }
                    }
                }
            } catch (e) {
                console.error('[chat-run] decision failed', e);
            }
            // ────────────────────────────────────────────────────────────────

            // Stream finished cleanly — let the AI-zoom tracker run the
            // definitive "settle" fit on the union of touched nodes.
            useAppStore.getState().endAiTurn();

        } catch (error) {
            console.error("Stream failed:", error);
            useAppStore.getState().updateMessage(assistantMsgId, {
                content: "Sorry, I encountered a network error while streaming.",
                // Don't strand the plan skeleton / "Creating plan" step if the
                // stream broke mid-plan (network error, abort, refresh).
                planLoading: false,
                isThinking: false,
            });
            // End the turn even on failure so the tracker doesn't strand the
            // active flag and block the next turn's begin/end transition.
            useAppStore.getState().endAiTurn();
            setIsLoading(false);
            setStatusMessage(null);
        }
    };

    /**
     * Finds the last user message and resubmits it.
     */
    const retryLast = async () => {
        const lastUserMsg = [...messages].reverse().find(m => m.type === 'user');
        if (!lastUserMsg) return;

        // Reset the assistant's previous error state by simply sending again
        handleSend(lastUserMsg.content, [], lastUserMsg.images || [], () => { }, () => { });
    };

    /** Called when the user clicks Approve & Build on a plan card. */
    const handlePlanApprove = (planMessageId: string) => {
        handleSend('Approved', [], [], () => {}, () => {}, undefined, {
            planMessageId,
            action: 'approve',
        });
    };

    /** Called when the user submits feedback inside a plan card. */
    const handlePlanFeedback = (planMessageId: string, feedbackText: string) => {
        handleSend(feedbackText, [], [], () => {}, () => {}, undefined, {
            planMessageId,
            action: 'feedback',
            feedbackText,
        });
    };

    return {
        editingMessageId,
        setEditingMessageId,
        saveMessageToDb,
        handleRevert,
        handleStop,
        handleSend,
        retryLast,
        handlePlanApprove,
        handlePlanFeedback,
    };
}
