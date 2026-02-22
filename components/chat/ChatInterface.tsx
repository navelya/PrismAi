'use client';

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Send, Loader2, Bot, User, Mic, Sparkles, MicOff, Square, Plus, X, Image, ImagePlus, ChevronUp, Pen, AlertTriangle } from 'lucide-react';
import MessageRenderer from './MessageRenderer';
import { Workflow } from '@/lib/nodes/types';
import { useAppStore } from '@/lib/store/app-store';
import { Tooltip } from '@/components/ui/Tooltip';
import { generateNodeId, generateEdgeId, formatRelativeTime } from '@/lib/utils';
import { stableStringify } from '@/lib/utils/stable-stringify';
import { executeWorkflow } from '@/lib/workflow-engine';
import { autoLayoutNodesAsync } from '@/lib/utils/graph-layout';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { NodeStatus } from '@/lib/nodes/types';
import { sessionsApi, messagesApi, uploadApi, userApi, chatApi } from '@/lib/api/client';
import { createClient } from '@/lib/supabase/client';
import { useDebounce } from '@/lib/hooks/use-debounce';
import { convertImageToWebP } from '@/lib/utils/image-processing';

interface Message {
    id: string;
    type: 'user' | 'assistant';
    content: string;
    images?: string[]; // Attached images (base64)
    result?: any;
    workflow?: Workflow;
    timestamp: Date;
    executionResult?: any;
}

interface ChatInterfaceProps {
    onWorkflowGenerated: (workflow: Workflow) => void;
    currentWorkflow?: Workflow | null;
    onReady?: (addResult: (result: any) => void) => void;
    userName?: string;
}

export default function ChatInterface({ onWorkflowGenerated, currentWorkflow, onReady, userName: initialUserName }: ChatInterfaceProps) {
    const params = useParams();
    const router = useRouter();
    const sessionId = params?.sessionId as string;
    const createdSessionIdRef = useRef<string | null>(null); // Handle lazy creation
    const [realtimeSessionId, setRealtimeSessionId] = useState<string | null>(null); // Reactive — triggers Realtime subscription
    // State for Edit Mode // Server-provided execution progress
    const realtimeHandledRef = useRef(false); // Tracks whether Realtime already processed the current message
    const activePollsRef = useRef<Set<NodeJS.Timeout>>(new Set()); // Tracks active polling intervals to prevent zombies

    // Cleanup all polling intervals on unmount
    useEffect(() => {
        return () => {
            activePollsRef.current.forEach(interval => clearInterval(interval));
            activePollsRef.current.clear();
        };
    }, []);

    // Reset lazy session on new chat navigation (Fix for "Always New Chat")
    useEffect(() => {
        if (!sessionId) {
            createdSessionIdRef.current = null;
            useAppStore.getState().clearMessages();
            useAppStore.getState().setCurrentWorkflow(null);
        }
    }, [sessionId]);

    // Use store workflow for auto-save as it's the source of truth
    const storeWorkflow = useAppStore((state) => state.currentWorkflow);
    const debouncedWorkflow = useDebounce(storeWorkflow, 2000);

    // Auto-save Canvas via BFF API
    useEffect(() => {
        if (sessionId && debouncedWorkflow) {
            sessionsApi.update(sessionId, {
                canvas_state: debouncedWorkflow,
            }).catch((error: any) => {
                console.error("Auto-save failed", error);
            });
        }
    }, [debouncedWorkflow, sessionId]);

    // =========================================================================
    // SUPABASE REALTIME: Listen for completed AI responses from background worker
    // =========================================================================
    useEffect(() => {
        const activeSessionId = sessionId || realtimeSessionId;
        if (!activeSessionId) return;

        const supabase = createClient();

        const channel = supabase
            .channel(`chat-messages-${activeSessionId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'messages',
                    filter: `session_id=eq.${activeSessionId}`,
                },
                async (payload: any) => {
                    const updatedMessage = payload.new;

                    // Only process assistant messages
                    if (updatedMessage.role !== 'assistant') return;

                    // Allow 'processing' to let the initial workflow blueprint render instantly
                    if (updatedMessage.status !== 'completed' && updatedMessage.status !== 'failed' && updatedMessage.status !== 'processing') return;

                    console.log('[Realtime] Assistant message update received:', updatedMessage.id, updatedMessage.status);

                    if (updatedMessage.status === 'completed' || updatedMessage.status === 'failed') {
                        realtimeHandledRef.current = true; // Signal polling to skip
                    }

                    // Metadata might not exist yet on initial processing update, infer from workflow
                    let responseType = updatedMessage.metadata?.type || (updatedMessage.workflow ? 'workflow' : undefined);
                    const store = useAppStore.getState();

                    if (!responseType && store.currentWorkflow && (updatedMessage.status === 'completed' || updatedMessage.status === 'failed')) {
                        // The UI expects a workflow, so assume Realtime stripped the large JSON columns
                        responseType = 'workflow';
                    }

                    // Handle FAILED responses
                    if (updatedMessage.status === 'failed') {
                        useAppStore.getState().updateMessage(updatedMessage.id, {
                            content: updatedMessage.content || 'Sorry, an error occurred.',
                        });
                        setIsLoading(false);
                        setStatusMessage(null);
                        return;
                    }

                    // Handle UNDO responses
                    if (responseType === 'undo') {
                        useAppStore.getState().updateMessage(updatedMessage.id, {
                            content: updatedMessage.content,
                        });

                        // Find the previous workflow snapshot to revert to
                        const storeMessages = useAppStore.getState().chatMessages;
                        const snapshots = storeMessages
                            .filter(m => m.type === 'assistant' && m.workflow)
                            .sort((a, b) => Number(b.id) - Number(a.id));

                        if (snapshots.length >= 2) {
                            await handleRevert(snapshots[1].id, true);
                        }
                        setIsLoading(false);
                        setStatusMessage(null);
                        return;
                    }

                    // Handle CHAT (conversational) responses
                    if (responseType === 'chat') {
                        useAppStore.getState().updateMessage(updatedMessage.id, {
                            content: updatedMessage.content,
                        });

                        setIsLoading(false);
                        setStatusMessage(null);
                        return;
                    }

                    // Handle WORKFLOW responses
                    if (responseType === 'workflow') {
                        let workflow = updatedMessage.workflow;
                        let processedResult = updatedMessage.metadata?.execution_result || null;
                        let executionError = updatedMessage.metadata?.execution_error || null;
                        let contentToRender = updatedMessage.content;

                        // CRITICAL FIX: If Realtime stripped the payload (TOAST truncation), explicitly fetch the full row!
                        if (!workflow && !updatedMessage.metadata && (updatedMessage.status === 'completed' || updatedMessage.status === 'failed')) {
                            console.log('[Realtime] Payload likely truncated by Postgres. Fetching full row directly...');
                            try {
                                const { data: fullMsg } = await supabase.from('messages').select('*').eq('id', updatedMessage.id).single();
                                if (fullMsg) {
                                    workflow = fullMsg.workflow;
                                    processedResult = fullMsg.metadata?.execution_result || null;
                                    executionError = fullMsg.metadata?.execution_error || null;
                                    contentToRender = fullMsg.content;
                                }
                            } catch (e) {
                                console.error('[Realtime] Backup block-fetch failed', e);
                            }
                        }

                        workflow = workflow || store.currentWorkflow;

                        if (!workflow) {
                            console.error('[Realtime] FATAL: Received workflow update but neither payload nor store had workflow data.', updatedMessage);
                            return; // Cannot process without workflow definition
                        }

                        const existingWorkflow = store.currentWorkflow;

                        // Apply auto-layout
                        if (workflow.nodes?.length > 0) {
                            let needsLayout = true;

                            // Preserve existing UI positions if they exist to prevent snapping to 0,0
                            if (existingWorkflow && existingWorkflow.nodes) {
                                let hasReusedPosition = false;
                                workflow.nodes = workflow.nodes.map((n: any) => {
                                    const existingNode = existingWorkflow.nodes.find((en: any) => en.id === n.id);
                                    if (existingNode && existingNode.position && (existingNode.position.x !== 0 || existingNode.position.y !== 0)) {
                                        hasReusedPosition = true;
                                        return { ...n, position: existingNode.position };
                                    }
                                    return n;
                                });
                                if (hasReusedPosition) needsLayout = false;
                            }

                            if (needsLayout) {
                                try {
                                    const positions = await autoLayoutNodesAsync(workflow.nodes, workflow.edges, 'elk');
                                    workflow.nodes = workflow.nodes.map((n: any) => {
                                        const pos = positions.get(n.id);
                                        return pos ? { ...n, position: pos } : n;
                                    });
                                } catch (e) {
                                    console.error('[Realtime] Auto-layout failed:', e);
                                }
                            }
                        }

                        onWorkflowGenerated(workflow);

                        const isCompleted = updatedMessage.status === 'completed' || updatedMessage.status === 'failed';

                        if (isCompleted) {
                            // Extract results directly from the server-executed DB update!
                            // Update the placeholder message with the final content
                            store.updateMessage(updatedMessage.id, {
                                content: contentToRender || '',
                                result: processedResult,
                                workflow,
                            });

                            // Set nodes to success/failed state visually based on server execution
                            store.resetNodeStatuses();
                            store.clearExecutionResults();
                            store.clearNodeOutputs();

                            if (executionError && !processedResult) {
                                // Failed execution
                                workflow.nodes.forEach((node: any) => store.setNodeStatus(node.id, 'error'));
                            } else {
                                // Success or partial success execution
                                workflow.nodes.forEach((node: any) => store.setNodeStatus(node.id, 'success'));
                            }

                            setIsLoading(false);
                            setStatusMessage(null);
                        } else {
                            // Intermediate Processing phase
                            store.updateMessage(updatedMessage.id, {
                                workflow,
                            });
                        }
                        return;
                    }

                    // Fallback: just update the message content
                    useAppStore.getState().updateMessage(updatedMessage.id, {
                        content: updatedMessage.content || 'Response received.',
                    });
                    setIsLoading(false);
                    setStatusMessage(null);
                },
            )
            .subscribe();

        // 2. Add second listener explicitly for live status from Worker
        const sessionsChannel = supabase
            .channel(`chat-sessions-${activeSessionId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'sessions',
                    filter: `id=eq.${activeSessionId}`,
                },
                (payload: any) => {
                    const store = useAppStore.getState();
                    if (payload.new) {
                        if (payload.new.status_message) {
                            setStatusMessage(payload.new.status_message);
                        }

                        // Live Sync Node Statuses from Worker execution
                        if (payload.new.canvas_state && payload.new.canvas_state.nodes) {
                            payload.new.canvas_state.nodes.forEach((node: any) => {
                                // Sync node execution borders (running, success, error)
                                if (node.data?.status) {
                                    const currentStatus = store.nodeStatuses[node.id];
                                    // Prevent out-of-order race conditions from downgrading a terminal state!
                                    if (currentStatus !== 'success' && currentStatus !== 'error') {
                                        store.setNodeStatus(node.id, node.data.status);
                                    }
                                }

                                // Sync node output thumbnails as they generate
                                if (node.data?.output !== undefined) {
                                    store.setNodeOutput(node.id, node.data.output);
                                }
                            });
                        }
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
            supabase.removeChannel(sessionsChannel);
        };
        // realtimeSessionId is a STATE variable (not ref) so it triggers re-render
        // and causes this useEffect to fire when a new session is lazily created.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, realtimeSessionId]);

    // =========================================================================
    // SUPABASE REALTIME: Listen for session status_message updates (progress)
    // =========================================================================
    useEffect(() => {
        const activeSessionId = sessionId || realtimeSessionId;
        if (!activeSessionId) return;

        const supabase = createClient();
        const channel = supabase
            .channel(`session-status-${activeSessionId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'sessions',
                    filter: `id=eq.${activeSessionId}`,
                },
                (payload: any) => {
                    const updated = payload.new;
                    // Update status message for progress tracking
                    if ('status_message' in updated) {
                        setStatusMessage(updated.status_message || null);
                    }

                    // Fast real-time node thumbnails and states
                    if ('canvas_state' in updated && updated.canvas_state) {
                        const store = useAppStore.getState();
                        const existingWorkflow = store.currentWorkflow;
                        let newWorkflow = updated.canvas_state;

                        // Preserve UI positions to prevent nodes jumping to 0,0 during live execution
                        if (existingWorkflow && existingWorkflow.nodes) {
                            newWorkflow.nodes = newWorkflow.nodes.map((n: any) => {
                                const existingNode = existingWorkflow.nodes.find((en: any) => en.id === n.id);
                                if (existingNode && existingNode.position) {
                                    return { ...n, position: existingNode.position };
                                }
                                return n;
                            });
                        }

                        store.setCurrentWorkflow(newWorkflow);
                    }
                },
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [sessionId, realtimeSessionId]);

    // Helper to save messages via BFF API
    const saveMessageToDb = async (msg: Message, imagePaths?: string[]) => {
        const activeSessionId = createdSessionIdRef.current || sessionId;
        if (!activeSessionId) return;

        // Map UI message type to DB role
        const role = msg.type;

        // Use uploaded paths if available
        const imagesToSave = imagePaths || [];

        // Insert message via API (also updates session timestamp)
        try {
            const { message } = await messagesApi.create(activeSessionId, {
                role,
                content: msg.content || '',
                images: imagesToSave,
                created_at: msg.timestamp.toISOString(),
                canvas_state: msg.workflow || undefined, // Update canvas_state if workflow present
            });

            // CRITICAL FIX: Update the local message with the REAL DB ID
            // otherwise subsequent operations (like revert) will fail with 404 because they use the temp ID
            if (message && message.id) {
                // We need to update the message in the store
                // efficiently find and update
                useAppStore.getState().updateMessage(msg.id, { id: message.id });
                // Also update the msg object reference if it's being used immediately after this call (unlikely but safe)
                msg.id = message.id;
            }
        } catch (err: any) {
            console.error('Failed to save message:', err);
        }
    };

    const isMobile = useIsMobile();

    // ... existing code ...

    // Use global store for messages
    const messages = useAppStore((state) => state.chatMessages);
    const addMessage = useAppStore((state) => state.addMessage);

    const [input, setInput] = useState('');
    const isLoading = useAppStore((state) => state.isLoading);
    const setIsLoading = useAppStore((state) => state.setIsLoading);
    const statusMessage = useAppStore((state) => state.statusMessage);
    const setStatusMessage = useAppStore((state) => state.setStatusMessage);

    // State for Edit Mode
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

    const [isListening, setIsListening] = useState(false);
    const [attachedImages, setAttachedImages] = useState<string[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
    const recognitionRef = useRef<any>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const attachedBlobsRef = useRef<Blob[]>([]); // Store WebP blobs for upload

    // Textarea ref for auto-resize
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const ghostRef = useRef<HTMLDivElement>(null);
    const [isExpanded, setIsExpanded] = useState(false);
    const [isMultiLine, setIsMultiLine] = useState(false);

    // Check if this is a fresh chat (no user messages yet)
    const hasUserMessages = messages.some(m => m.type === 'user');
    const isEmptyState = !hasUserMessages && !isLoading;

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Correctly resize textarea when layout mode changes
    useLayoutEffect(() => {
        const textarea = textareaRef.current;
        if (textarea && isMultiLine) {
            // Reset to auto to get correct scrollHeight in the new 'relative' layout
            textarea.style.height = 'auto';
            const newHeight = textarea.scrollHeight;

            const maxHeight = isMobile ? (isExpanded ? 200 : 72) : 200;
            textarea.style.height = `${Math.min(newHeight, maxHeight)}px`;
        }
    }, [isMultiLine, isMobile, isExpanded]);

    const toggleListening = () => {
        // Check browser support
        if (typeof window === 'undefined') return;

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert('Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari.');
            return;
        }

        if (isListening) {
            try {
                if (recognitionRef.current) {
                    recognitionRef.current.stop();
                }
            } catch (e) {
                console.error('Error stopping recognition:', e);
            }
            setIsListening(false);
        } else {
            // Capture current input state
            const startingText = input;

            try {
                const recognition = new SpeechRecognition();
                recognition.continuous = true;
                recognition.interimResults = true;
                recognition.lang = 'en-US';

                recognition.onstart = () => {
                    setIsListening(true);
                };

                recognition.onresult = (event: any) => {
                    const transcript = Array.from(event.results)
                        .map((result: any) => result[0].transcript)
                        .join('');

                    const separator = startingText && !startingText.endsWith(' ') ? ' ' : '';
                    setInput(startingText + separator + transcript);
                };

                recognition.onend = () => {
                    // Only set listening to false if we stopped it manually or it timed out
                    // We verify if the abortController is still active or check internal state
                    setIsListening(false);
                    recognitionRef.current = null;
                };

                recognition.onerror = (event: any) => {
                    console.error('Speech recognition error details:', event);

                    if (event.error === 'no-speech') {
                        setIsListening(false);
                    }
                    else if (event.error === 'not-allowed') {
                        setIsListening(false);
                        alert('Microphone access denied. Please allow microphone access in browser settings.');
                    }
                    else {
                        setIsListening(false);
                    }
                };

                recognitionRef.current = recognition;
                recognition.start();

            } catch (err: any) {
                console.error('Initialization error:', err);
                setIsListening(false);
            }
        }
    };

    // Image upload handlers
    const handleImageFiles = useCallback(async (files: FileList | null) => {
        if (!files || files.length === 0) return;

        const promises = Array.from(files).map(async (file) => {
            if (file.type.startsWith('image/')) {
                try {
                    const webpBlob = await convertImageToWebP(file);
                    // Create preview
                    const preview = await new Promise<string>((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result as string);
                        reader.readAsDataURL(webpBlob);
                    });
                    return { blob: webpBlob, preview };
                } catch (e) {
                    console.error("Image conversion failed", e);
                    return null;
                }
            }
            return null;
        });

        const results = await Promise.all(promises);
        const validResults = results.filter((r): r is { blob: Blob, preview: string } => r !== null);

        if (validResults.length > 0) {
            attachedBlobsRef.current = [...attachedBlobsRef.current, ...validResults.map(r => r.blob)];
            setAttachedImages(prev => [...prev, ...validResults.map(r => r.preview)]);
        }
    }, []);

    const handleChatDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.types.includes('Files')) {
            setIsDragOver(true);
        }
    }, []);

    const handleChatDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // Check if leaving the container entirely (relatedTarget is null when leaving window)
        const relatedTarget = e.relatedTarget as HTMLElement | null;
        if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
            setIsDragOver(false);
        }
    }, []);

    const handleChatDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        handleImageFiles(e.dataTransfer.files);
    }, [handleImageFiles]);

    const removeAttachedImage = useCallback((index: number) => {
        setAttachedImages(prev => prev.filter((_, i) => i !== index));
        // Sync ref removal
        attachedBlobsRef.current = attachedBlobsRef.current.filter((_, i) => i !== index);
    }, []);

    const handleEdit = (message: Message) => {
        setEditingMessageId(message.id);
        setInput(message.content);
        // Focus input
        setTimeout(() => {
            textareaRef.current?.focus();
            // Adjust height
            if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
                textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
            }
        }, 100);
    };

    const cancelEdit = () => {
        setEditingMessageId(null);
        setInput('');
    };

    const handleSend = async () => {
        const trimmedInput = input.trim();
        if (!trimmedInput || isLoading) return;

        // EDIT MODE LOGIC: Revert before sending
        if (editingMessageId) {
            const msgIndex = messages.findIndex(m => m.id === editingMessageId);
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

        // Capture state
        const blobsToSend = [...attachedBlobsRef.current];
        const imagesToSend = [...attachedImages]; // Base64

        // Clear state
        setAttachedImages([]);
        attachedBlobsRef.current = [];
        setInput('');

        // Optimistic UI Update — add user message locally
        const userMessage: Message = {
            id: Date.now().toString(),
            type: 'user',
            content: trimmedInput,
            images: imagesToSend.length > 0 ? imagesToSend : undefined,
            timestamp: new Date(),
        };
        addMessage(userMessage);
        setIsLoading(true);

        // Lazy Session Creation via BFF API
        let activeSessionId = sessionId || createdSessionIdRef.current;
        if (!activeSessionId) {
            try {
                const { session } = await sessionsApi.create('New Workflow');
                if (session) {
                    activeSessionId = session.id;
                    createdSessionIdRef.current = session.id;
                    setRealtimeSessionId(session.id); // Triggers Realtime subscription
                    useAppStore.getState().setActiveSessionId(session.id);
                }
            } catch (err) {
                console.error('Failed to create session:', err);
                setIsLoading(false);
                setStatusMessage(null);
                return;
            }
        }

        // Upload images to persistent storage via BFF API
        let uploadedPaths: string[] = [];
        if (blobsToSend.length > 0 && activeSessionId) {
            try {
                const results = await Promise.all(
                    blobsToSend.map(blob => uploadApi.upload(blob))
                );
                uploadedPaths = results.map(r => r.path);
            } catch (e) {
                console.error('[DEBUG] Image upload failed', e);
            }
        }

        try {
            // === ASYNC FIRE-AND-FORGET ===
            // This returns immediately after inserting messages and triggering the background worker.
            // The actual AI response will arrive via the Supabase Realtime subscription below.
            const response = await chatApi.send({
                sessionId: activeSessionId!,
                prompt: trimmedInput,
                previousWorkflow: currentWorkflow,
                attachedImages: imagesToSend.length > 0 ? imagesToSend : undefined,
                imagePaths: uploadedPaths.length > 0 ? uploadedPaths : undefined,
            });

            // Update local user message with real DB ID
            if (response.userMessage?.id) {
                useAppStore.getState().updateMessage(userMessage.id, { id: response.userMessage.id });
            }

            // Add assistant placeholder (thinking indicator)
            const assistantPlaceholder: Message = {
                id: response.assistantMessage.id,
                type: 'assistant',
                content: '', // Empty — will be filled by Realtime
                timestamp: new Date(),
            };
            addMessage(assistantPlaceholder);

            // Reset the Realtime-handled flag for this new message
            realtimeHandledRef.current = false;

            // ═══════════════════════════════════════════════════════════
            // POLLING FALLBACK: If Supabase Realtime misses the UPDATE,
            // poll the DB every 3 seconds to catch the completed message.
            // ═══════════════════════════════════════════════════════════
            const pollMessageId = response.assistantMessage.id;
            const pollSupabase = createClient(); // Reuse single client for all polls
            let pollCount = 0;
            const maxPolls = 60; // 3s × 60 = 3 minutes max

            const pollInterval = setInterval(async () => {
                pollCount++;
                if (pollCount > maxPolls) {
                    clearInterval(pollInterval);
                    activePollsRef.current.delete(pollInterval);
                    useAppStore.getState().setIsLoading(false);
                    useAppStore.getState().setStatusMessage(null);
                    return;
                }

                // Skip if Realtime already handled it
                if (realtimeHandledRef.current) {
                    clearInterval(pollInterval);
                    activePollsRef.current.delete(pollInterval);
                    return;
                }

                try {
                    const { data: msg } = await pollSupabase
                        .from('messages')
                        .select('*')
                        .eq('id', pollMessageId)
                        .single();

                    if (!msg) return;
                    if (msg.status !== 'completed' && msg.status !== 'failed') return;

                    // Double-check Realtime didn't just handle it
                    if (realtimeHandledRef.current) {
                        clearInterval(pollInterval);
                        activePollsRef.current.delete(pollInterval);
                        return;
                    }

                    // Message is done — stop polling
                    clearInterval(pollInterval);
                    activePollsRef.current.delete(pollInterval);
                    console.log('[Polling Fallback] Processing completed message:', pollMessageId, msg.status);

                    let responseType = msg.metadata?.type || (msg.workflow ? 'workflow' : undefined);
                    if (!responseType && useAppStore.getState().currentWorkflow) {
                        responseType = 'workflow';
                    }

                    if (msg.status === 'failed') {
                        useAppStore.getState().updateMessage(pollMessageId, {
                            content: msg.content || 'Sorry, an error occurred.',
                        });
                        useAppStore.getState().setIsLoading(false);
                        useAppStore.getState().setStatusMessage(null);
                        return;
                    }

                    if (responseType === 'chat') {
                        useAppStore.getState().updateMessage(pollMessageId, {
                            content: msg.content,
                        });
                        setIsLoading(false);
                        setStatusMessage(null);
                        return;
                    }

                    if (responseType === 'workflow') {
                        let workflow = msg.workflow || useAppStore.getState().currentWorkflow;

                        // We must have the workflow from either DB or local store
                        if (workflow) {
                            if (workflow.nodes?.length > 0) {
                                try {
                                    const positions = await autoLayoutNodesAsync(workflow.nodes, workflow.edges, 'elk');
                                    workflow.nodes = workflow.nodes.map((n: any) => {
                                        const pos = positions.get(n.id);
                                        return pos ? { ...n, position: pos } : n;
                                    });
                                } catch (e) {
                                    console.error('[Polling] Auto-layout failed:', e);
                                }
                            }

                            onWorkflowGenerated(workflow);

                            const processedResult = msg.metadata?.execution_result || null;
                            const executionError = msg.metadata?.execution_error || null;

                            useAppStore.getState().updateMessage(pollMessageId, {
                                content: msg.content ?? '',
                                result: processedResult,
                                workflow,
                            });

                            const store = useAppStore.getState();
                            store.resetNodeStatuses();
                            store.clearExecutionResults();
                            store.clearNodeOutputs();

                            if (executionError && !processedResult) {
                                workflow.nodes.forEach((node: any) => store.setNodeStatus(node.id, 'error'));
                            } else {
                                workflow.nodes.forEach((node: any) => store.setNodeStatus(node.id, 'success'));
                            }

                            store.setIsLoading(false);
                            store.setStatusMessage(null);
                            return;
                        }
                    }

                    // Fallback
                    useAppStore.getState().updateMessage(pollMessageId, {
                        content: msg.content ?? 'Response received.',
                    });
                    useAppStore.getState().setIsLoading(false);
                    useAppStore.getState().setStatusMessage(null);
                } catch (pollErr) {
                    console.warn('[Polling] Check failed:', pollErr);
                }
            }, 3000);

            // Seamlessly update URL if this was the first message
            if (!sessionId && createdSessionIdRef.current) {
                const currentPath = window.location.pathname;
                if (currentPath === '/chat' || currentPath === '/') {
                    window.history.replaceState({}, '', `/chat/${createdSessionIdRef.current}`);
                }
                // NOTE: No session-updated event — sidebar's Realtime handler picks up the INSERT automatically
            }

            // NOTE: isLoading stays true — it will be cleared by the Realtime handler
            // OR by the polling fallback above when the message status changes.

            activePollsRef.current.add(pollInterval);

        } catch (error) {
            console.error('Failed to send message:', error);
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                type: 'assistant',
                content: `Sorry, I failed to send the message: ${error instanceof Error ? error.message : 'Unknown error'}`,
                timestamp: new Date(),
            };
            addMessage(errorMessage);
            setIsLoading(false);
            setStatusMessage(null);
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
                // RESET SESSION LOGIC (PERSISTENT)
                const activeSessionId = createdSessionIdRef.current || sessionId;
                if (activeSessionId) {
                    await sessionsApi.reset(activeSessionId);
                }

                // Clear local store
                useAppStore.getState().setCurrentWorkflow(null);
                useAppStore.getState().clearMessages();


            } else {
                const { success, workflow } = await messagesApi.revert(messageId);

                if (success && workflow) {
                    // 1. Update Workflow
                    useAppStore.getState().setCurrentWorkflow(workflow);

                    // 2. Truncate Messages locally
                    // Find index of target message
                    const targetIndex = messages.findIndex(m => m.id === messageId);
                    if (targetIndex !== -1) {
                        const newMessages = messages.slice(0, targetIndex + 1);

                        // Clear store and re-add to ensure sync
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

        // Add a message indicating the workflow was stopped
        const stopMessage: Message = {
            id: Date.now().toString(),
            type: 'assistant',
            content: '⏹️ Workflow stopped by user.',
            timestamp: new Date(),
        };
        addMessage(stopMessage);
    };

    // Expose method to add execution results from editor
    // Use ref to prevent infinite loop if onReady changes identity on every render
    const onReadyRef = useRef(onReady);
    useEffect(() => {
        onReadyRef.current = onReady;
    }, [onReady]);

    useEffect(() => {
        if (onReadyRef.current) {
            onReadyRef.current(async (result: any) => {
                // 1. Ensure Active Session Exists (Lazy Creation) via BFF API
                let activeSessionId = sessionId || createdSessionIdRef.current;

                if (!activeSessionId) {
                    try {
                        const { session } = await sessionsApi.create('New Workflow');
                        if (session) {
                            activeSessionId = session.id;
                            createdSessionIdRef.current = session.id;
                            useAppStore.getState().setActiveSessionId(session.id);

                            // Update URL silently only if still on chat
                            const currentPath = window.location.pathname;
                            if (currentPath === '/chat' || currentPath === '/') {
                                window.history.replaceState({}, '', `/chat/${session.id}`);
                            }
                        }
                    } catch (err) {
                        console.error("Failed to create session for editor result:", err);
                        return;
                    }
                }

                let processedResult = result;
                let resultImagePaths: string[] = [];

                // 2. Process images via BFF upload API
                try {
                    if (Array.isArray(result)) {
                        for (let i = 0; i < result.length; i++) {
                            const item = result[i];
                            const isDataUri = item.url?.startsWith('data:');
                            const isExternalUrl = item.url?.startsWith('http') &&
                                !item.url.includes(window.location.hostname) &&
                                !item.url.includes('.supabase.co');

                            if (item?.url && (isDataUri || isExternalUrl)) {
                                try {
                                    const response = await fetch(item.url);
                                    const blob = await response.blob();
                                    const uploaded = await uploadApi.upload(blob);
                                    resultImagePaths.push(uploaded.path);
                                    result[i] = { ...item, url: uploaded.publicUrl };
                                } catch (e) {
                                    console.error("Failed to upload editor result image:", e);
                                }
                            }
                        }
                        processedResult = result;
                    }
                } catch (e) {
                    console.error("Failed to process editor result images:", e);
                }

                // 3. Save Message with persistence
                const assistantMessage: Message = {
                    id: Date.now().toString(),
                    type: 'assistant',
                    content: 'Workflow executed from editor:',
                    result: processedResult,
                    timestamp: new Date(),
                };

                addMessage(assistantMessage);
                saveMessageToDb(assistantMessage, resultImagePaths);
            });
        }
    }, []); // Run once on mount

    // Reusable height-recalculation logic (used by both typing and resize)
    const adjustTextareaHeight = useCallback(() => {
        const textarea = textareaRef.current;
        const ghost = ghostRef.current;
        if (!textarea) return;

        const currentInput = textarea.value;
        const hasNewlines = currentInput.includes('\n');

        if (!isMultiLine && !hasNewlines) {
            if (textarea.scrollHeight > 40) {
                setIsMultiLine(true);
            }
        } else {
            textarea.style.height = 'auto';
            const contentHeight = textarea.scrollHeight;

            if (!hasNewlines && contentHeight < 60 && ghost) {
                ghost.textContent = currentInput;
                const singleLineAvailableWidth = textarea.clientWidth - 144;
                ghost.style.width = `${singleLineAvailableWidth}px`;

                if (ghost.scrollHeight < 50) {
                    setIsMultiLine(false);
                }
            } else if (!hasNewlines && contentHeight < 60) {
                setIsMultiLine(false);
            } else {
                setIsMultiLine(hasNewlines || contentHeight > 40);

                const maxHeight = isMobile ? (isExpanded ? 200 : 72) : 200;
                const newHeight = Math.min(contentHeight, maxHeight);
                textarea.style.height = `${newHeight}px`;
            }
        }
    }, [isMultiLine, isMobile, isExpanded]);

    // ResizeObserver: retrigger height calc when container dimensions change
    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const ro = new ResizeObserver(() => {
            adjustTextareaHeight();
        });
        ro.observe(textarea);

        return () => ro.disconnect();
    }, [adjustTextareaHeight]);

    // Auto-resize textarea and detect multi-line
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        // Immediately recalculate after React updates the DOM value
        // (the ref's .value is already updated by the controlled input at this point)
        adjustTextareaHeight();
    };

    // Check if textarea exceeds 3 lines (for mobile expand button)
    const showExpandButton = isMobile && !isExpanded && textareaRef.current && textareaRef.current.scrollHeight > 72;

    // Input component (reused in both states)
    const InputField = (
        <form onSubmit={(e) => {
            e.preventDefault();
            handleSend();
        }} className="relative w-full max-w-3xl mx-auto">
            {/* Mobile expand button */}
            {showExpandButton && (
                <button
                    type="button"
                    onClick={() => setIsExpanded(true)}
                    className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 text-xs 
                               bg-surface-tertiary hover:bg-surface-elevated text-content-secondary rounded-t-lg
                               border border-b-0 border-stroke-subtle transition-colors z-10"
                >
                    Expand ↑
                </button>
            )}

            {/* Input container */}
            <div className={`relative flex flex-col rounded-2xl border bg-surface-secondary/50 
                           focus-within:ring-2 focus-within:ring-accent-primary/20 focus-within:border-accent-primary focus-within:bg-surface-primary
                           transition-all duration-200
                           ${isListening ? 'border-accent-error ring-2 ring-accent-error/20' : 'border-stroke-subtle'}`}>

                {/* Attached Images Preview Strip */}
                {attachedImages.length > 0 && (
                    <div className="flex gap-2 px-3 pt-3 pb-1 overflow-x-auto">
                        {attachedImages.map((img, index) => (
                            <div key={index} className="relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden group/img bg-surface-tertiary border border-stroke-subtle">
                                <img src={img} alt={`Attached ${index + 1}`} className="w-full h-full object-cover" />
                                <button
                                    type="button"
                                    onClick={() => removeAttachedImage(index)}
                                    className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/70 rounded-full flex items-center justify-center
                                               opacity-0 group-hover/img:opacity-100 hover:bg-accent-error transition-all"
                                >
                                    <X className="w-3 h-3 text-white" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Hidden ghost element */}
                <div
                    ref={ghostRef}
                    className="absolute top-0 left-0 -z-50 invisible whitespace-pre-wrap break-words pointer-events-none"
                    style={{
                        fontFamily: 'inherit',
                        fontSize: 'inherit',
                        lineHeight: '1.5rem',
                        padding: '8px 8px',
                        minHeight: '0px'
                    }}
                    aria-hidden="true"
                />

                {/* Textarea */}
                <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                        }
                    }}
                    placeholder={isListening ? 'Listening...' : 'Message Prism AI...'}
                    rows={1}
                    className={`bg-transparent focus:outline-none text-content-primary placeholder-content-tertiary resize-none leading-6 [&::-webkit-scrollbar]:hidden
                                ${isMultiLine || attachedImages.length > 0
                            ? 'relative w-full px-4 py-2'
                            : 'absolute left-12 right-24 top-1/2 -translate-y-1/2 px-2 py-2'
                        }`}
                    style={{
                        minHeight: isMultiLine || attachedImages.length > 0 ? '40px' : '24px',
                        maxHeight: isMobile ? (isExpanded ? '200px' : '72px') : '200px',
                        overflowY: isMultiLine ? 'auto' : 'hidden',
                        scrollbarWidth: 'none',
                        msOverflowStyle: 'none',
                    }}
                />

                {/* Bottom row */}
                <div className={`flex w-full items-center justify-between px-2 pb-2
                               ${isMultiLine || attachedImages.length > 0 ? '' : 'pt-2'}`}>
                    {/* Plus button on left */}
                    <div className="relative z-10">
                        <Tooltip content="Add attachment" position="top">
                            <button
                                type="button"
                                onClick={() => setIsPlusMenuOpen(!isPlusMenuOpen)}
                                className={`p-2 rounded-lg transition-colors ${isPlusMenuOpen ? 'bg-surface-tertiary text-content-primary' : 'bg-surface-secondary hover:bg-surface-tertiary text-content-tertiary hover:text-content-secondary'}`}
                            >
                                <Plus className={`w-5 h-5 transition-transform ${isPlusMenuOpen ? 'rotate-45' : ''}`} />
                            </button>
                        </Tooltip>

                        {/* Dropup Menu */}
                        {isPlusMenuOpen && (
                            <div className="absolute bottom-full left-0 mb-2 w-48 bg-surface-primary rounded-xl shadow-xl border border-stroke-subtle overflow-hidden z-50">
                                <button
                                    type="button"
                                    onClick={() => {
                                        imageInputRef.current?.click();
                                        setIsPlusMenuOpen(false);
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-content-primary hover:bg-surface-secondary transition-colors"
                                >
                                    <ImagePlus className="w-5 h-5 text-accent-primary" />
                                    <span className="font-medium">Add Images</span>
                                </button>
                                <div className="border-t border-stroke-subtle">
                                    <button disabled className="w-full flex items-center gap-3 px-4 py-3 text-content-tertiary cursor-not-allowed">
                                        <Sparkles className="w-5 h-5" />
                                        <span>Templates</span>
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Mic and Send buttons on right */}
                    <div className="flex items-center gap-1 z-10">
                        {!isLoading && (
                            <Tooltip content={isListening ? 'Stop listening' : 'Voice input'} position="top">
                                <button
                                    type="button"
                                    onClick={toggleListening}
                                    className={`p-2 rounded-lg transition-all duration-200
                                ${isListening
                                            ? 'bg-accent-error text-white animate-pulse'
                                            : 'bg-surface-secondary text-content-tertiary hover:bg-surface-tertiary hover:text-content-secondary'
                                        }`}
                                >
                                    {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                                </button>
                            </Tooltip>
                        )}

                        {isLoading ? (
                            <Tooltip content="Stop" position="top">
                                <button
                                    type="button"
                                    onClick={handleStop}
                                    className="p-2 rounded-lg bg-surface-secondary hover:bg-accent-error/10 border border-stroke-subtle hover:border-accent-error/30 transition-all duration-200 group"
                                >
                                    <Square className="w-4 h-4 text-content-tertiary group-hover:text-accent-error fill-current transition-colors" />
                                </button>
                            </Tooltip>
                        ) : (
                            <Tooltip content="Send message" position="top">
                                <button
                                    type="submit"
                                    disabled={!input.trim()}
                                    className={`p-2 rounded-lg transition-all duration-200
                                ${input.trim()
                                            ? 'bg-content-primary hover:bg-content-secondary text-surface-primary'
                                            : 'bg-surface-secondary text-content-tertiary cursor-not-allowed'
                                        }`}
                                >
                                    <Send className="w-4 h-4" />
                                </button>
                            </Tooltip>
                        )}
                    </div>
                </div>
            </div>
        </form>
    );

    // Mobile: Slide-out drawer
    // ... (This hook logic is in Sidebar, not here. We are in ChatInterface)

    // START: Add User Name Fetching Logic
    const [userName, setUserName] = useState<string>(initialUserName || '');
    // Removed redundant supabase declaration

    useEffect(() => {
        const getUserName = async () => {
            try {
                const { user } = await userApi.me();
                const name = user?.user_metadata?.display_name || user?.user_metadata?.full_name;
                if (name) {
                    setUserName(name);
                }
            } catch {
                // Not authenticated or failed
            }
        };

        getUserName();
    }, []);
    // END: User Name Fetching Logic

    // Desktop Empty State
    if (isEmptyState && !isMobile) {
        return (
            <div
                className="relative flex flex-col h-full bg-surface-primary"
                onDragOver={handleChatDragOver}
                onDragLeave={handleChatDragLeave}
                onDrop={handleChatDrop}
            >
                {/* Hidden file input */}
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                        handleImageFiles(e.target.files);
                        if (imageInputRef.current) imageInputRef.current.value = '';
                    }}
                    className="hidden"
                />

                {/* Drag-drop overlay */}
                {isDragOver && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-primary/90 backdrop-blur-sm">
                        <div className="text-center">
                            <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                                <ImagePlus className="w-10 h-10 text-white" />
                            </div>
                            <h2 className="text-xl font-semibold text-content-primary">Add images</h2>
                            <p className="text-content-secondary mt-1">Drop files here to add to your message</p>
                        </div>
                    </div>
                )}

                <div className="flex-1 flex items-center justify-center p-6">
                    <div className="w-full max-w-2xl text-center">
                        <div className="flex items-center justify-center gap-3 mb-2">
                            <div className="w-10 h-10 rounded-xl bg-gradient-premium flex items-center justify-center shadow-md shadow-accent-primary/20">
                                <Sparkles className="w-5 h-5 text-content-inverted" />
                            </div>
                            <h1 className="text-2xl font-bold text-content-primary">
                                {userName ? `Welcome, ${userName.trim().split(" ")[0].replace(/^./, c => c.toUpperCase())}` : 'Welcome to Prism AI'}
                            </h1>
                        </div>
                        <p className="text-content-secondary mb-8">
                            Tell me what you'd like to do with images, and I'll create an automation workflow for you.
                        </p>

                        {/* Centered Input */}
                        {InputField}

                        {/* Example prompts */}
                        <div className="mt-8 flex flex-wrap justify-center gap-2">
                            {['Find 10 cat images', 'Remove backgrounds', 'Upscale my photos'].map((prompt) => (
                                <button
                                    key={prompt}
                                    onClick={() => setInput(prompt)}
                                    className="px-4 py-2 text-sm bg-surface-secondary hover:bg-accent-primary/5 text-content-secondary hover:text-accent-primary 
                                               rounded-full transition-colors border border-stroke-subtle hover:border-accent-primary/30"
                                >
                                    {prompt}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Mobile Empty State
    if (isEmptyState && isMobile) {
        return (
            <div
                className="relative flex flex-col h-full bg-surface-primary"
                onDragOver={handleChatDragOver}
                onDragLeave={handleChatDragLeave}
                onDrop={handleChatDrop}
            >
                {/* Hidden file input */}
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                        handleImageFiles(e.target.files);
                        if (imageInputRef.current) imageInputRef.current.value = '';
                    }}
                    className="hidden"
                />

                {isDragOver && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-primary/90 backdrop-blur-sm">
                        <div className="text-center">
                            <div className="w-16 h-16 mx-auto mb-3 rounded-xl bg-gradient-premium flex items-center justify-center">
                                <ImagePlus className="w-8 h-8 text-white" />
                            </div>
                            <h2 className="text-lg font-semibold text-content-primary">Add images</h2>
                            <p className="text-content-secondary text-sm mt-1">Drop files here</p>
                        </div>
                    </div>
                )}

                <div className="flex-1 flex items-center justify-center p-6">
                    <div className="text-center">
                        <div className="flex items-center justify-center gap-2 mb-2">
                            <div className="w-8 h-8 rounded-lg bg-gradient-premium flex items-center justify-center shadow-md">
                                <Sparkles className="w-4 h-4 text-white" />
                            </div>
                            <h1 className="text-xl font-bold text-content-primary">
                                {userName ? `Welcome, ${userName.trim().split(" ")[0].replace(/^./, c => c.toUpperCase())}` : 'Welcome to Prism AI'}
                            </h1>
                        </div>
                        <p className="text-content-secondary text-sm">
                            Tell me what you'd like to do with images.
                        </p>
                    </div>
                </div>

                <div className="sticky bottom-0 border-t border-stroke-subtle p-4 bg-surface-primary/80 backdrop-blur-sm">
                    {InputField}
                </div>
            </div>
        );
    }

    // Normal chat state
    return (
        <div
            className="relative flex flex-col h-full bg-surface-primary"
            onDragOver={handleChatDragOver}
            onDragLeave={handleChatDragLeave}
            onDrop={handleChatDrop}
        >
            <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                    handleImageFiles(e.target.files);
                    if (imageInputRef.current) imageInputRef.current.value = '';
                }}
                className="hidden"
            />

            {isDragOver && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-primary/90 backdrop-blur-sm">
                    <div className="text-center">
                        <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-premium flex items-center justify-center">
                            <ImagePlus className="w-10 h-10 text-white" />
                        </div>
                        <h2 className="text-xl font-semibold text-content-primary">Add images</h2>
                        <p className="text-content-secondary mt-1">Drop files here to add to your message</p>
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-3xl mx-auto space-y-6">
                    {messages.map((message, index) => {
                        // Calculate undo target for User messages
                        let undoSnapshotId: string | undefined;
                        if (message.type === 'user') {
                            // Find closest preceding snapshot
                            let found = false;
                            for (let i = index - 1; i >= 0; i--) {
                                const m = messages[i];
                                if (m.type === 'assistant' && m.workflow) {
                                    undoSnapshotId = m.id;
                                    found = true;
                                    break;
                                }
                            }
                            // If no preceding snapshot found, allow reverting to INITIAL (empty) state
                            if (!found) {
                                undoSnapshotId = 'initial';
                            }
                        }

                        // Calculate disabled state for Edit Mode
                        const editingIndex = editingMessageId ? messages.findIndex(m => m.id === editingMessageId) : -1;
                        const isDisabled = editingIndex !== -1 && index > editingIndex;
                        const isEditing = message.id === editingMessageId;

                        return (
                            <MemoizedMessage
                                key={message.id}
                                message={message}
                                onRevert={handleRevert}
                                onEdit={handleEdit}
                                undoSnapshotId={undoSnapshotId}
                                isDisabled={isDisabled}
                                isEditing={isEditing}
                                serverStatus={statusMessage}
                            />
                        );
                    })}

                    {isLoading && !(messages.length > 0 && messages[messages.length - 1].type === 'assistant' && !messages[messages.length - 1].content) && (
                        <div className="flex gap-4">
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-premium flex items-center justify-center">
                                <Bot className="w-5 h-5 text-white" />
                            </div>
                            <div className="flex items-center gap-2 text-content-secondary">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <ExecutionUserFeedback serverStatus={statusMessage} />
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>
            </div>

            <div className="sticky bottom-0 border-t border-stroke-subtle p-4 bg-surface-primary/80 backdrop-blur-sm">
                {editingMessageId && (
                    <div className="flex items-center justify-between p-3 mb-3 bg-surface-secondary border border-stroke-subtle rounded-xl animate-in slide-in-from-bottom-2 shadow-lg">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-accent-primary/10 rounded-lg text-accent-primary">
                                <Pen className="w-4 h-4" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-sm font-medium text-content-primary">Edit this message and revert later changes</span>
                                <span className="text-xs text-content-secondary">Changes made after this message will be reverted.</span>
                            </div>
                        </div>
                        <button
                            onClick={cancelEdit}
                            className="p-2 hover:bg-surface-tertiary rounded-lg transition-colors text-content-secondary hover:text-content-primary"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                )}
                {InputField}
            </div>
        </div>
    );
}

// Dynamic execution status component
export function ExecutionUserFeedback({ serverStatus }: { serverStatus?: string | null }) {
    // Prefer server-provided status (from sessions.status_message via Realtime)
    const [dots, setDots] = useState('');

    useEffect(() => {
        const interval = setInterval(() => {
            setDots(prev => prev.length >= 3 ? '' : prev + '.');
        }, 500);
        return () => clearInterval(interval);
    }, []);

    const statusText = serverStatus || 'Creating workflow';

    return (
        <span className="text-sm min-w-[120px]">
            {statusText}{dots}
        </span>
    );
}

// ... MemoizedMessage definition ...

const MemoizedMessage = React.memo(function MemoizedMessage({
    message,
    onRevert,
    onEdit,
    undoSnapshotId,
    isDisabled,
    isEditing,
    serverStatus
}: {
    message: Message;
    onRevert?: (id: string, skipConfirmation?: boolean) => void;
    onEdit?: (message: Message) => void;
    undoSnapshotId?: string;
    isDisabled?: boolean;
    isEditing?: boolean;
    serverStatus?: string | null;
}) {
    // State for local relative time
    const [timeString, setTimeString] = React.useState('');

    // Update relative time every minute
    React.useEffect(() => {
        const updateTime = () => {
            setTimeString(formatRelativeTime(message.timestamp));
        };
        updateTime();
        const interval = setInterval(updateTime, 60000);
        return () => clearInterval(interval);
    }, [message.timestamp]);

    // Handler for Revert button click
    const handleRevertClick = (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent bubble click events
        if (onRevert && undoSnapshotId) {
            onRevert(undoSnapshotId);
        }
    };

    return (
        <div
            className={`flex gap-4 ${message.type === 'user' ? 'justify-end animate-fade-in' : 'justify-start'} 
                ${isDisabled ? 'opacity-40 grayscale pointer-events-none select-none filter blur-[1px]' : ''}
                ${isEditing ? 'z-10 relative' : ''}`}
        >
            {message.type === 'assistant' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-premium flex items-center justify-center mt-1">
                    <Bot className="w-5 h-5 text-white" />
                </div>
            )}

            <div className={`relative max-w-[85%] ${message.type === 'user' ? 'min-w-[200px]' : ''}`}>
                <div
                    className={`flex flex-col space-y-2 overflow-hidden transition-all duration-200 ${message.type === 'user'
                        ? 'bg-gradient-premium text-white px-5 py-4 rounded-2xl rounded-tr-sm relative shadow-lg shadow-accent-primary/10'
                        : ''
                        }`}
                >
                    {/* Image Attachments */}
                    {message.type === 'user' && message.images && message.images.length > 0 && (
                        <div className="flex gap-2 flex-wrap mb-1">
                            {message.images.map((img, index) => (
                                <div key={index} className="w-20 h-20 rounded-lg overflow-hidden bg-black/20 border border-white/10 shadow-sm">
                                    <img src={img} alt={`Attachment ${index + 1}`} className="w-full h-full object-cover" />
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Message Content */}
                    {message.content ? (
                        <p className={`text-[15px] leading-relaxed ${message.type === 'user' ? 'text-white/95 font-medium' : 'text-content-primary'}`}>
                            {message.content}
                        </p>
                    ) : message.type === 'assistant' && !message.result && (
                        <div className="flex items-center gap-2 text-content-primary py-1">
                            <Loader2 className="w-4 h-4 animate-spin text-accent-primary" />
                            <ExecutionUserFeedback serverStatus={serverStatus} />
                        </div>
                    )}

                    {/* Result (Assistant) */}
                    {message.result && (
                        <div className="mt-2">
                            <MessageRenderer data={message.result} />
                        </div>
                    )}

                    {/* Footer: Timestamp (Left) & Revert Button (Right) */}
                    {message.type === 'user' && (
                        <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/10">
                            {/* Timestamp - Bottom Left */}
                            <span className="text-[11px] text-white/60 font-medium tracking-wide">
                                {timeString}
                            </span>

                            {/* Revert Button - Bottom Right */}
                            <div className="flex items-center gap-2">
                                {onEdit && (
                                    <Tooltip content="Edit">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onEdit(message);
                                            }}
                                            className={`flex items-center justify-center p-1.5 rounded-lg 
                                                     transition-all duration-200 backdrop-blur-sm
                                                     border border-white/10 group
                                                     ${isEditing
                                                    ? 'bg-white/30 text-white ring-2 ring-white/50'
                                                    : 'bg-white/10 hover:bg-white/20 text-white/90 hover:text-white'}`}
                                        >
                                            <Pen className="w-3.5 h-3.5" />
                                        </button>
                                    </Tooltip>
                                )}

                                {undoSnapshotId && (
                                    <button
                                        onClick={handleRevertClick}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg 
                                                 bg-white/10 hover:bg-white/20 active:bg-white/30 
                                                 text-white/90 hover:text-white 
                                                 transition-all duration-200 backdrop-blur-sm
                                                 border border-white/10 group
                                                 cursor-pointer"
                                    >
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            width="14"
                                            height="14"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className="mb-[1px] group-hover:-rotate-90 transition-transform duration-300"
                                        >
                                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                                            <path d="M3 3v5h5" />
                                        </svg>
                                        <span className="text-xs font-semibold">Revert</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {message.type === 'user' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-surface-tertiary flex items-center justify-center mt-1">
                    <User className="w-5 h-5 text-content-primary" />
                </div>
            )}
        </div>
    );
});
