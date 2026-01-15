import { useState, useCallback, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store/app-store';
import { Workflow } from '@/lib/nodes/types';

export interface Session {
    id: string;
    title: string;
    updated_at: string;
    created_at: string;
}

export function useSession() {
    const supabase = createClient();
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

    // Create a new session and redirect
    const createNewSession = useCallback(async () => {
        setIsLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('User not authenticated');

            const { data, error } = await supabase
                .from('sessions')
                .insert({
                    user_id: user.id,
                    title: 'New Workflow',
                    canvas_state: { nodes: [], edges: [] }
                })
                .select()
                .single();

            if (error) throw error;

            if (data) {
                // Reset ALL local store state before navigating
                const store = useAppStore.getState();

                // Set active session to the new session ID
                store.setActiveSessionId(data.id);

                // Clear workflow and other state for fresh start
                store.setCurrentWorkflow(null, false);
                store.clearMessages();
                store.clearExecutionResults();
                store.resetNodeStatuses();
                store.clearNodeOutputs();
                store.setEditorState({ isCanvasOpen: false, splitRatio: 50 });

                router.push(`/chat/${data.id}`);
                // Notify sidebar to refresh immediately
                window.dispatchEvent(new Event('session-updated'));
            }
        } catch (error) {
            console.error('Failed to create session:', error);
        } finally {
            setIsLoading(false);
        }
    }, [router, supabase]);

    // Load a session by ID
    const loadSession = useCallback(async (sessionId: string) => {

        setIsLoading(true);

        // ⚠️ CRITICAL: Immediately clear current workflow state BEFORE async operations
        // This prevents stale data from leaking between session switches
        const store = useAppStore.getState();
        store.setActiveSessionId(sessionId);
        store.setCurrentWorkflow(null, false);  // Clear workflow first!


        try {
            // 1. Fetch Session (Metadata + Canvas)
            const { data: session, error: sessionError } = await supabase
                .from('sessions')
                .select('*')
                .eq('id', sessionId)
                .single();

            if (sessionError) throw sessionError;

            // 2. Fetch Messages
            const { data: messages, error: messagesError } = await supabase
                .from('messages')
                .select('*')
                .eq('session_id', sessionId)
                .order('created_at', { ascending: true });

            if (messagesError) throw messagesError;

            // 3. Hydrate Store with loaded data
            // Hydrate Workflow from Session State (primary source of truth for canvas)


            if (session.canvas_state && session.canvas_state.nodes && session.canvas_state.nodes.length > 0) {
                const workflow = session.canvas_state as Workflow;

                store.setCurrentWorkflow(workflow, false);

            } else {
                // Clear workflow if no valid canvas_state
                store.setCurrentWorkflow(null, false);

            }

            // Hydrate Messages
            const formattedMessages = messages.map((msg: any) => {
                // Restore image paths to URLs
                const images = msg.images?.map((path: string) => {
                    if (path.startsWith('http') || path.startsWith('data:')) return path;
                    return supabase.storage.from('chat-assets').getPublicUrl(path).data.publicUrl;
                });

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
    }, [supabase]);

    // Delete a session
    const deleteSession = useCallback(async (sessionId: string) => {
        try {


            // 1. Fetch messages to find images
            const { data: messages } = await supabase
                .from('messages')
                .select('role, images')
                .eq('session_id', sessionId);

            const pathsToDelete: Set<string> = new Set();

            // Helper to extract path
            const extractPath = (urlOrPath: string) => {
                if (!urlOrPath) return null;
                if (urlOrPath.includes('chat-assets/')) {
                    const parts = urlOrPath.split('chat-assets/');
                    return parts.length > 1 ? parts[1] : null;
                }
                if (!urlOrPath.startsWith('http')) return urlOrPath;
                return null;
            };

            // Collect paths
            messages?.forEach((msg: any) => {
                if (msg.images && Array.isArray(msg.images)) {
                    msg.images.forEach((img: any) => {
                        const path = extractPath(img);
                        if (path) pathsToDelete.add(path);
                    });
                }
            });

            const paths = Array.from(pathsToDelete);


            // 2. Delete from Storage
            if (paths.length > 0) {
                const { error: storageError } = await supabase.storage
                    .from('chat-assets')
                    .remove(paths);

                if (storageError) console.error('[deleteSession] Storage delete error:', storageError);
            }

            // 3. Delete Session from DB
            const { error } = await supabase.from('sessions').delete().eq('id', sessionId);
            if (error) throw error;


            // 4. Update UI
            // If deleting current session, redirect home
            if (currentSessionId === sessionId) {
                router.push('/chat');
                setCurrentSessionId(null);
                useAppStore.getState().clearMessages();
                useAppStore.getState().setCurrentWorkflow(null);
            }
        } catch (error) {
            console.error("Failed to delete session", error);
        }
    }, [supabase, currentSessionId, router]);

    return {
        createNewSession,
        loadSession,
        deleteSession,
        isLoading,
        currentSessionId
    };
}
