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
        apiFetch<{ session: any; messages: any[] }>(`/api/sessions/${id}`),

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
