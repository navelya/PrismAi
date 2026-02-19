'use client';

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Send, Loader2, Bot, User, Mic, Sparkles, MicOff, Square, Plus, X, Image, ImagePlus, ChevronUp, Pen } from 'lucide-react';
import MessageRenderer from './MessageRenderer';
import { Workflow } from '@/lib/nodes/types';
import { useAppStore } from '@/lib/store/app-store';
import { Tooltip } from '@/components/ui/Tooltip';
import { generateNodeId, generateEdgeId } from '@/lib/utils';
import { stableStringify } from '@/lib/utils/stable-stringify';
import { executeWorkflow } from '@/lib/workflow-engine';
import { autoLayoutNodesAsync } from '@/lib/utils/graph-layout';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { NodeStatus } from '@/lib/nodes/types';
import { sessionsApi, messagesApi, uploadApi, userApi } from '@/lib/api/client';
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

    // Helper to save messages via BFF API
    const saveMessageToDb = async (msg: Message, imagePaths?: string[]) => {
        const activeSessionId = createdSessionIdRef.current || sessionId;
        if (!activeSessionId) return;

        // Map UI message type to DB role
        const role = msg.type;

        // Use uploaded paths if available
        const imagesToSave = imagePaths || [];

        // Insert message via API (also updates session timestamp)
        await messagesApi.create(activeSessionId, {
            role,
            content: msg.content || '',
            images: imagesToSave,
            created_at: msg.timestamp.toISOString(),
            canvas_state: msg.workflow || undefined, // Update canvas_state if workflow present
        }).catch((err: any) => console.error('Failed to save message:', err));
    };

    const isMobile = useIsMobile();

    // ... existing code ...

    // Use global store for messages
    const messages = useAppStore((state) => state.chatMessages);
    const addMessage = useAppStore((state) => state.addMessage);

    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
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

    const handleSend = async () => {
        const trimmedInput = input.trim();
        if (!trimmedInput || isLoading) return;

        // Capture state
        const blobsToSend = [...attachedBlobsRef.current];
        const imagesToSend = [...attachedImages]; // Base64

        // Clear state
        setAttachedImages([]);
        attachedBlobsRef.current = [];
        setInput('');

        // Optimistic UI Update
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
                    // ⚠️ CRITICAL: Instantly update active session in store
                    useAppStore.getState().setActiveSessionId(session.id);
                }
            } catch (err) {
                console.error('Failed to create session:', err);
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
                console.error("[DEBUG] Image upload failed", e);
            }
        }

        // Save to DB
        saveMessageToDb(userMessage, uploadedPaths);

        // Create abort controller for this request
        abortControllerRef.current = new AbortController();

        try {
            // Generate workflow from user input (with current workflow as context)
            const generateResponse = await fetch('/api/workflow/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: trimmedInput,
                    previousWorkflow: currentWorkflow,
                    attachedImages: imagesToSend.length > 0 ? imagesToSend : undefined,
                }),
            });

            const generateData = await generateResponse.json();

            if (!generateData.success) {
                throw new Error(generateData.error || 'Failed to generate workflow');
            }

            // HANDLE CONVERSATIONAL RESPONSE
            if (generateData.type === 'chat') {
                const assistantMessage: Message = {
                    id: Date.now().toString(),
                    type: 'assistant',
                    content: generateData.message || "I'm not sure how to respond to that.",
                    timestamp: new Date(),
                };
                addMessage(assistantMessage);
                saveMessageToDb(assistantMessage);
                setIsLoading(false);

                // Seamlessly update URL if this was the first message (no reload)
                if (!sessionId && createdSessionIdRef.current) {
                    window.history.replaceState({}, '', `/chat/${createdSessionIdRef.current}`);

                    console.log('[DEBUG] Requesting title generation for new session:', createdSessionIdRef.current);

                    // Generate smart title
                    sessionsApi.generateTitle({
                        sessionId: createdSessionIdRef.current,
                        message: trimmedInput,
                        assistantResponse: generateData.message
                    }).then(data => {
                        console.log('[DEBUG] Title generation result:', data);
                        window.dispatchEvent(new Event('session-updated'));
                    }).catch(console.error);
                }
                return;
            }

            let workflow = generateData.workflow;

            // Apply auto-layout if needed (e.g. if generic linear layout from AI)
            // This ensures the editor shows a nice graph and the execution engine (if it uses positions later) is synced.
            // More importantly, it ensures the `currentWorkflow` we set in the store is fully "baked".
            if (workflow.nodes.length > 0) {
                const positions = await autoLayoutNodesAsync(workflow.nodes, workflow.edges, 'elk');
                workflow.nodes = workflow.nodes.map((n: any) => {
                    const pos = positions.get(n.id);
                    return pos ? { ...n, position: pos } : n;
                });
            }

            onWorkflowGenerated(workflow);

            // Execute workflow CLIENT-SIDE with live status updates
            const resetNodeStatuses = useAppStore.getState().resetNodeStatuses;
            const clearExecutionResults = useAppStore.getState().clearExecutionResults;
            const clearNodeOutputs = useAppStore.getState().clearNodeOutputs;
            const setNodeStatus = useAppStore.getState().setNodeStatus;
            const invalidateNodes = useAppStore.getState().invalidateNodes;

            // Smart Execution Logic (Partial Runs)
            // We compare the new workflow with the previous one to find what changed
            const changedNodeIds = new Set<string>();
            const currentWorkflowProp = currentWorkflow; // Context passed to AI
            let forceFullRun = !currentWorkflowProp || currentWorkflowProp.nodes.length === 0;

            if (!forceFullRun && currentWorkflowProp) {
                // 1. Detect Node Changes (Config)
                workflow.nodes.forEach((newNode: any) => {
                    const oldNode = currentWorkflowProp.nodes.find(n => n.id === newNode.id);
                    if (!oldNode) {
                        changedNodeIds.add(newNode.id); // New node
                    } else {
                        // Compare config
                        if (JSON.stringify(newNode.data.config) !== JSON.stringify(oldNode.data.config)) {
                            changedNodeIds.add(newNode.id);
                        }
                    }
                });

                // 2. Detect Edge Changes (Topology)
                const getEdgeSig = (e: any) => `${e.source}->${e.target}${e.targetHandle ? ':' + e.targetHandle : ''}`;
                const oldEdgeSigs = new Set(currentWorkflowProp.edges.map(getEdgeSig));
                const newEdgeSigs = new Set(workflow.edges.map(getEdgeSig));

                workflow.edges.forEach((e: any) => {
                    if (!oldEdgeSigs.has(getEdgeSig(e))) changedNodeIds.add(e.target);
                });

                currentWorkflowProp.edges.forEach((e: any) => {
                    if (!newEdgeSigs.has(getEdgeSig(e))) {
                        // If target still exists in new workflow, it needs update
                        if (workflow.nodes.find((n: any) => n.id === e.target)) {
                            changedNodeIds.add(e.target);
                        }
                    }
                });
            }

            let executeData;
            const changedIdsArr = Array.from(changedNodeIds);
            const isPartial = !forceFullRun && changedIdsArr.length > 0;

            if (isPartial) {
                console.log('[Partial Run] Invalidating nodes:', changedIdsArr);
                invalidateNodes(changedIdsArr);

                // Get valid cache (dirty nodes were removed by invalidateNodes)
                const cachedOutputs = useAppStore.getState().nodeOutputs;

                // Mark dirty nodes as pending visual
                // Note: We don't know the full descendant list here easily without re-calculating,
                // but executeWorkflow will set them to 'running' soon.
                // We'll trust the engine status updates.

                executeData = await executeWorkflow(
                    workflow,
                    generateNodeId(),
                    (nodeId: string, status: NodeStatus) => setNodeStatus(nodeId, status),
                    (nodeId: string, output: any) => useAppStore.getState().setNodeOutput(nodeId, output),
                    cachedOutputs // Pass cache for smart skipping
                );
            } else {
                // FALLBACK: FULL RUN
                console.log('[Full Run] Clearing all status');
                resetNodeStatuses();
                clearExecutionResults();
                clearNodeOutputs();

                workflow.nodes.forEach((node: any) => setNodeStatus(node.id, 'pending'));

                executeData = await executeWorkflow(
                    workflow,
                    generateNodeId(),
                    (nodeId: string, status: NodeStatus) => setNodeStatus(nodeId, status),
                    (nodeId: string, output: any) => useAppStore.getState().setNodeOutput(nodeId, output)
                );
            }

            if (!executeData.success) {
                throw new Error(executeData.error || 'Failed to execute workflow');
            }

            // Construct success/partial execution message
            let responseContent = '';
            if (executeData.error) {
                responseContent = `⚠️ Workflow executed partially.\n${executeData.error}`;
            } else if (!executeData.result && workflow.nodes.length > 0) {
                responseContent = `✅ Workflow finished, but produced no output.`;
            }

            // Process result images - upload base64 to storage via BFF API
            let processedResult = executeData.result;
            let resultImagePaths: string[] = [];

            if (executeData.result) {
                try {
                    // Extract base64 images from result and upload them
                    const results = executeData.result;
                    if (Array.isArray(results)) {
                        for (let i = 0; i < results.length; i++) {
                            const item = results[i];
                            const isDataUri = item.url?.startsWith('data:');
                            // Upload external images (e.g., scraped) to our storage to persist them
                            // Check if it's a URL but NOT our own storage (approximate check using origin or common keywords)
                            const isExternalUrl = item.url?.startsWith('http') &&
                                !item.url.includes(window.location.hostname) &&
                                !item.url.includes('.supabase.co'); // Standard Supabase domain

                            if (item?.url && (isDataUri || isExternalUrl)) {
                                try {
                                    const response = await fetch(item.url);
                                    const blob = await response.blob();
                                    const uploaded = await uploadApi.upload(blob);
                                    resultImagePaths.push(uploaded.path);
                                    // Replace base64/external URL with our persistent storage URL
                                    results[i] = { ...item, url: uploaded.publicUrl };
                                } catch (e) {
                                    console.error('[DEBUG] Failed to upload result image:', e);
                                }
                            }
                        }
                        processedResult = results;
                    }
                } catch (e) {
                    console.error('[DEBUG] Failed to process result images:', e);
                }
            }

            const assistantMessage: Message = {
                id: (Date.now() + 1).toString(),
                type: 'assistant',
                content: responseContent,
                timestamp: new Date(),
                result: processedResult,
                workflow,
            };
            addMessage(assistantMessage);
            saveMessageToDb(assistantMessage, resultImagePaths);

            // Generate smart title for Workflow
            if (!sessionId && createdSessionIdRef.current) {
                console.log('[DEBUG] Requesting title generation for new workflow session:', createdSessionIdRef.current);

                sessionsApi.generateTitle({
                    sessionId: createdSessionIdRef.current,
                    message: trimmedInput,
                    workflowName: workflow.name, // Use generated workflow name
                    assistantResponse: responseContent
                }).then(data => {
                    console.log('[DEBUG] Title generation result:', data);
                    window.dispatchEvent(new Event('session-updated'));
                }).catch(console.error);
            }
        } catch (error) {
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                type: 'assistant',
                content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                timestamp: new Date(),
            };
            addMessage(errorMessage);
            saveMessageToDb(errorMessage);
        } finally {
            setIsLoading(false);
            abortControllerRef.current = null;

            if (!sessionId && createdSessionIdRef.current) {
                window.history.replaceState({}, '', `/chat/${createdSessionIdRef.current}`);
                // Notify sidebar to refresh
                window.dispatchEvent(new Event('session-updated'));
            }

            // Get most recent assistant message for context if needed (it was added to local state 'messages' but better to just use the data we have)
            // Actually, accessing 'workflow' variable from here is tricky if it's outside scope. 
            // Ideally this call should be inside the try block after workflow generation.
            // Moving it up to line 494 area.
        }
    };

    const handleStop = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsLoading(false);

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

                            // Update URL silently
                            window.history.replaceState({}, '', `/chat/${session.id}`);
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

    // Auto-resize textarea and detect multi-line
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        const textarea = textareaRef.current;
        const ghost = ghostRef.current;
        setInput(newValue);

        if (textarea) {
            const hasNewlines = newValue.includes('\n');

            // Optimize: Avoid layout thrashing in single-line mode
            if (!isMultiLine && !hasNewlines) {
                if (textarea.scrollHeight > 40) {
                    setIsMultiLine(true);
                }
            } else {
                // Multi-line mode: needs robust measurement to handle shrinking
                textarea.style.height = 'auto';
                const contentHeight = textarea.scrollHeight;

                if (!hasNewlines && contentHeight < 60 && ghost) {
                    // Configure ghost to mimic single-line state
                    ghost.textContent = newValue;
                    const singleLineAvailableWidth = textarea.clientWidth - 144;
                    ghost.style.width = `${singleLineAvailableWidth}px`;

                    // Check if it fits in 1 line (~40px)
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
        }
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
                    {messages.map((message) => (
                        <MemoizedMessage key={message.id} message={message} />
                    ))}

                    {isLoading && (
                        <div className="flex gap-4 animate-fade-in">
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-premium flex items-center justify-center">
                                <Bot className="w-5 h-5 text-white" />
                            </div>
                            <div className="flex items-center gap-2 text-content-secondary">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <ExecutionUserFeedback />
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>
            </div>

            <div className="sticky bottom-0 border-t border-stroke-subtle p-4 bg-surface-primary/80 backdrop-blur-sm">
                {InputField}
            </div>
        </div>
    );
}

// Dynamic execution status component
function ExecutionUserFeedback() {
    const nodeStatuses = useAppStore((state) => state.nodeStatuses);
    const workflow = useAppStore((state) => state.currentWorkflow);

    // Map node types to present continuous action verbs
    const actionDescriptions: Record<string, string> = {
        scrape_images: 'Searching for images',
        remove_background: 'Removing background',
        filter_sort: 'Filtering results',
        ai_generate_image: 'Generating AI image',
        upscale_image: 'Upscaling image',
        merge_image: 'Merging images',
        media_input: 'Processing upload',
    };

    // Find currently running node
    // We prioritize 'running' nodes. If none, we check if we are in a 'pending' state implying transition.
    const runningNodeId = Object.entries(nodeStatuses).find(([_, status]) => status === 'running')?.[0];
    const runningNode = workflow?.nodes.find(n => n.id === runningNodeId);

    const [dots, setDots] = useState('');

    useEffect(() => {
        const interval = setInterval(() => {
            setDots(prev => prev.length >= 3 ? '' : prev + '.');
        }, 500);
        return () => clearInterval(interval);
    }, []);

    let statusText = 'Creating workflow';
    if (runningNode) {
        statusText = actionDescriptions[runningNode.type] || 'Processing';
    } else if (workflow && Object.keys(nodeStatuses).length > 0) {
        // Workflow exists and execution started (statuses exist), but nothing currently 'running' (maybe between nodes)
        statusText = 'Finalizing';
    }

    return (
        <span className="text-sm min-w-[120px]">
            {statusText}{dots}
        </span>
    );
}

// Memoized message component
const MemoizedMessage = React.memo(function MemoizedMessage({ message }: { message: Message }) {
    return (
        <div
            className={`flex gap-4 animate-fade-in ${message.type === 'user' ? 'justify-end' : 'justify-start'
                }`}
        >
            {message.type === 'assistant' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-premium flex items-center justify-center">
                    <Bot className="w-5 h-5 text-white" />
                </div>
            )}

            <div
                className={`max-w-[80%] space-y-3 overflow-hidden ${message.type === 'user'
                    ? 'bg-gradient-premium text-white px-6 py-3 rounded-2xl rounded-tr-sm'
                    : ''
                    }`}
            >
                {message.type === 'user' && message.images && message.images.length > 0 && (
                    <div className="flex gap-2 flex-wrap mb-2">
                        {message.images.map((img, index) => (
                            <div key={index} className="w-16 h-16 rounded-lg overflow-hidden bg-white/20">
                                <img src={img} alt={`Attachment ${index + 1}`} className="w-full h-full object-cover" />
                            </div>
                        ))}
                    </div>
                )}

                {message.content && (
                    <p className={message.type === 'user' ? 'text-white' : 'text-content-primary'}>
                        {message.content}
                    </p>
                )}

                {message.result && (
                    <MessageRenderer data={message.result} />
                )}
            </div>

            {message.type === 'user' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-surface-tertiary flex items-center justify-center">
                    <User className="w-5 h-5 text-content-primary" />
                </div>
            )}
        </div>
    );
});
