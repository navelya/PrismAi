/**
 * Typed API client for the BFF layer.
 * Replaces all direct Supabase client calls from frontend components.
 * 
 * All calls go through authenticated Next.js API routes — the frontend
 * never directly queries the database.
 */

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options?.headers,
        },
    });

    const data = await res.json();

    if (!res.ok) {
        throw new Error(data.error || `API error: ${res.status}`);
    }

    return data as T;
}

// ─── Session APIs ──────────────────────────────────────────────────────

export const sessionsApi = {
    /** List all sessions for the current user */
    list: () =>
        apiFetch<{ sessions: any[] }>('/api/sessions', { cache: 'no-store' }),

    /** Create a new session */
    create: (title?: string) =>
        apiFetch<{ session: any }>('/api/sessions', {
            method: 'POST',
            body: JSON.stringify({ title }),
        }),

    /** Load a session with its messages */
    load: (id: string) =>
        apiFetch<{ session: any; messages: any[] }>(`/api/sessions/${id}`, { cache: 'no-store' }),

    /** Update session fields (title, canvas_state) */
    update: (id: string, data: { title?: string; canvas_state?: any }) =>
        apiFetch<{ session: any }>(`/api/sessions/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        }),

    /** Delete a session */
    delete: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/sessions/${id}`, {
            method: 'DELETE',
        }),
    /** Update session title (Auto-Generate) */
    generateTitle: (data: { sessionId: string; message: string; assistantResponse?: string; workflowName?: string }) =>
        apiFetch<{ success: boolean; title: string }>('/api/session/generate-title', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    /** Reset session (clear all messages) */
    reset: (id: string) =>
        apiFetch<{ success: boolean; message: string }>(`/api/sessions/${id}/reset`, {
            method: 'POST',
        }),
};

// ─── Message APIs ──────────────────────────────────────────────────────

export const messagesApi = {
    /** Get all messages for a session */
    list: (sessionId: string) =>
        apiFetch<{ messages: any[] }>(`/api/sessions/${sessionId}/messages`),

    /** Insert a new message into a session */
    create: (sessionId: string, data: {
        role: 'user' | 'assistant';
        content: string;
        images?: string[];
        created_at?: string;
        canvas_state?: any;
    }) =>
        apiFetch<{ message: any }>(`/api/sessions/${sessionId}/messages`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    /** Update a message */
    update: (messageId: string, data: { images?: string[]; content?: string; metadata?: any }) =>
        apiFetch<{ message: any }>(`/api/messages/${messageId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        }),

    /** Revert session to a specific message's state */
    revert: (messageId: string) =>
        apiFetch<{ success: boolean; workflow: any }>(`/api/messages/${messageId}/revert`, {
            method: 'POST',
        }),
};

// ─── Upload APIs ───────────────────────────────────────────────────────

export const uploadApi = {
    /** Upload an image (pass a Blob) */
    upload: async (file: Blob, filename?: string) => {
        const formData = new FormData();
        formData.append('file', file);
        if (filename) formData.append('filename', filename);

        const res = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
            // Don't set Content-Type — browser will set it with boundary
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        return data as { path: string; publicUrl: string };
    },

    /** Upload an external image URL server-side */
    uploadUrl: async (url: string, filename?: string) => {
        const formData = new FormData();
        formData.append('url', url);
        if (filename) formData.append('filename', filename);

        const res = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        return data as { path: string; publicUrl: string };
    },

    /** Delete an uploaded image by its storage path */
    delete: (path: string) =>
        apiFetch<{ success: boolean }>('/api/upload', {
            method: 'DELETE',
            body: JSON.stringify({ path }),
        }),
};

// ─── User APIs ─────────────────────────────────────────────────────────

export const userApi = {
    /** Get the current authenticated user */
    me: () =>
        apiFetch<{ user: any }>('/api/user/me'),
};

// ─── Chat APIs (Async Fire-and-Forget) ─────────────────────────────────

export const chatApi = {
    /** Send a message and trigger async AI generation */
    send: async (data: {
        sessionId: string;
        prompt: string;
        previousWorkflow?: any;
        attachedImages?: string[];
        imagePaths?: string[];
    }): Promise<{
        success: boolean;
        userMessage: any;
        assistantMessage: any;
    }> => {
        const response = await fetch('/api/chat/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const text = await response.text();
            let errorMessage = `Request failed: ${response.status}`;
            try { errorMessage = JSON.parse(text).error || errorMessage; } catch { }
            throw new Error(errorMessage);
        }

        // Read ONLY the first chunk from the stream (contains the initial JSON response)
        // The server keeps the stream alive for background processing,
        // but we don't need to wait for it to finish.
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let jsonText = '';

        // Read chunks until we have complete JSON
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            jsonText += decoder.decode(value, { stream: true });

            // Try to parse — if valid JSON, we have the full initial response
            try {
                const parsed = JSON.parse(jsonText);
                // Release the reader (don't wait for stream to finish)
                reader.releaseLock();
                return parsed;
            } catch {
                // Not complete JSON yet, read more
                continue;
            }
        }

        // If we get here, the stream ended — parse whatever we have
        return JSON.parse(jsonText);
    },
};
