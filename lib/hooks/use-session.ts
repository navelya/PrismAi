import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store/app-store';
import { Workflow } from '@/lib/nodes/types';
import { sessionsApi } from '@/lib/api/client';

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

                // Clear workflow and other state for fresh start
                store.setCurrentWorkflow(null, false);
                store.clearMessages();
                store.clearExecutionResults();
                store.resetNodeStatuses();
                store.clearNodeOutputs();
                store.setEditorState({ isCanvasOpen: false, splitRatio: 50 });

                router.push(`/chat/${session.id}`);
                // Notify sidebar to refresh immediately
                window.dispatchEvent(new Event('session-updated'));
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

        // ⚠️ CRITICAL: Immediately clear current workflow state BEFORE async operations
        // This prevents stale data from leaking between session switches
        const store = useAppStore.getState();
        store.setActiveSessionId(sessionId);
        store.setCurrentWorkflow(null, false);  // Clear workflow first!


        try {
            // Fetch session with messages via BFF API
            const { session, messages } = await sessionsApi.load(sessionId);

            // Hydrate Workflow from Session State (primary source of truth for canvas)
            if (session.canvas_state && session.canvas_state.nodes && session.canvas_state.nodes.length > 0) {
                const workflow = session.canvas_state as Workflow;
                store.setCurrentWorkflow(workflow, false);
            } else {
                // Clear workflow if no valid canvas_state
                store.setCurrentWorkflow(null, false);
            }

            // Hydrate Messages
            const formattedMessages: any[] = messages.map((msg: any) => {
                // Restore image paths to URLs
                const images = msg.images?.map((path: string) => getStoragePublicUrl(path));

                // For assistant messages, if we have images from the result, convert to ImageObject format
                let result = undefined;
                if (msg.role === 'assistant' && images && images.length > 0) {
                    // Convert URL strings to ImageObject format for MessageRenderer
                    result = images.map((url: string, idx: number) => ({
                        url,
                        resolution: { width: 800, height: 600 }, // Placeholder dimensions
                        metadata: { title: `Image ${idx + 1}` }
                    }));
                }

                return {
                    id: msg.id,
                    type: msg.role, // 'user' | 'assistant'
                    content: msg.content || '',
                    timestamp: new Date(msg.created_at),
                    images: msg.role === 'user' ? images : undefined, // Only user messages show inline images
                    result: result // Assistant messages use result for image display
                };
            });

            // Clear existing and add new
            store.clearMessages();

            // Attach workflow to last assistant message (for Editor button visibility)
            if (formattedMessages.length > 0 && session.canvas_state?.nodes?.length > 0) {
                const lastAssistantIndex = formattedMessages.map((m: any) => m.type).lastIndexOf('assistant');
                if (lastAssistantIndex !== -1) {
                    formattedMessages[lastAssistantIndex].workflow = session.canvas_state;
                }
            }

            formattedMessages.forEach((msg: any) => store.addMessage(msg));

            setCurrentSessionId(sessionId);

        } catch (error) {
            console.error('Failed to load session:', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Delete a session
    const deleteSession = useCallback(async (sessionId: string) => {
        try {
            // Delete via BFF API (server handles message & storage cleanup)
            await sessionsApi.delete(sessionId);

            // Update UI — if deleting current session, redirect home
            if (currentSessionId === sessionId) {
                router.push('/chat');
                setCurrentSessionId(null);
                useAppStore.getState().clearMessages();
                useAppStore.getState().setCurrentWorkflow(null);
            }
        } catch (error) {
            console.error("Failed to delete session", error);
        }
    }, [currentSessionId, router]);

    return {
        createNewSession,
        loadSession,
        deleteSession,
        isLoading,
        currentSessionId
    };
}
