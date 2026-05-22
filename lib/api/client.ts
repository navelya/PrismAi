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

let listSessionsPromise: Promise<{ sessions: any[] }> | null = null;

export const sessionsApi = {
    /** List all sessions for the current user */
    list: () => {
        if (!listSessionsPromise) {
            listSessionsPromise = apiFetch<{ sessions: any[] }>('/api/sessions', { cache: 'no-store' }).catch(err => {
                listSessionsPromise = null;
                throw err;
            });
            // Clear the promise cache after 2 seconds to allow fresh refetches later while surviving the mount storm
            setTimeout(() => {
                listSessionsPromise = null;
            }, 2000);
        }
        return listSessionsPromise;
    },

    /** Create a new session */
    create: (title?: string, id?: string) =>
        apiFetch<{ session: any }>('/api/sessions', {
            method: 'POST',
            body: JSON.stringify({ title, id }),
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
    /** Upload an image (pass a Blob or File) */
    upload: async (file: Blob, options?: { filename?: string; sessionId?: string; nodeId?: string }) => {
        const formData = new FormData();
        formData.append('file', file);
        if (options?.filename) formData.append('filename', options.filename);
        if (options?.sessionId) formData.append('sessionId', options.sessionId);
        if (options?.nodeId) formData.append('nodeId', options.nodeId);

        const res = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        return data as { path: string; publicUrl: string };
    },

    /** Upload an external image URL server-side */
    uploadUrl: async (url: string, options?: { filename?: string; sessionId?: string; nodeId?: string }) => {
        const formData = new FormData();
        formData.append('url', url);
        if (options?.filename) formData.append('filename', options.filename);
        if (options?.sessionId) formData.append('sessionId', options.sessionId);
        if (options?.nodeId) formData.append('nodeId', options.nodeId);

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

    /** Delete an entire storage folder by its prefix */
    deleteFolder: (prefix: string) =>
        apiFetch<{ success: boolean }>('/api/upload', {
            method: 'DELETE',
            body: JSON.stringify({ path: prefix, isFolder: true }),
        }),
};

// ─── User APIs ─────────────────────────────────────────────────────────

let mePromise: Promise<{ user: any }> | null = null;

export const userApi = {
    /** Get the current authenticated user */
    me: () => {
        if (!mePromise) {
            mePromise = apiFetch<{ user: any }>('/api/user/me').catch(err => {
                mePromise = null;
                throw err;
            });
            // Clear the promise cache after 2 seconds to allow fresh refetches later
            setTimeout(() => {
                mePromise = null;
            }, 2000);
        }
        return mePromise;
    },
};

// ─── Character APIs ────────────────────────────────────────────────────

export interface CharacterRefImage { url: string; path: string; }

export interface Character {
    id: string;
    name: string;
    description: string | null;
    reference_images: CharacterRefImage[];
    thumbnail_url: string | null;
    weight: number;
    created_at: string;
    updated_at: string;
    last_used_at: string | null;
}

export interface CharacterInput {
    name: string;
    description?: string | null;
    referenceImages: CharacterRefImage[];
    thumbnailUrl?: string;
    weight?: number;
}

export const charactersApi = {
    list: () => apiFetch<{ characters: Character[] }>('/api/characters', { cache: 'no-store' }),

    create: (input: CharacterInput) =>
        apiFetch<{ character: Character }>('/api/characters', {
            method: 'POST',
            body: JSON.stringify(input),
        }),

    update: (id: string, input: Partial<CharacterInput>) =>
        apiFetch<{ character: Character }>(`/api/characters/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(input),
        }),

    delete: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/characters/${id}`, { method: 'DELETE' }),

    autoDescribe: (imageUrl: string) =>
        apiFetch<{ description: string }>('/api/characters/auto-describe', {
            method: 'POST',
            body: JSON.stringify({ imageUrl }),
        }),
};

export interface GenerateCharacterHandlers {
    /** Total number of poses that will be generated (fires once, first). */
    onStart?: (total: number) => void;
    /** A pose finished and uploaded — fill slot `index` (0 = primary). */
    onImage: (img: { index: number; url: string; path: string }) => void;
    /** A non-base pose failed to generate (its slot will stay empty). */
    onPoseFailed?: (index: number) => void;
    /** Fatal error (no images, or a pre-stream 4xx/5xx). */
    onError?: (message: string) => void;
    /** Stream finished. */
    onDone?: () => void;
}

/**
 * Stream character-reference generation. The server emits NDJSON, one line per
 * event, so each pose can fill its slot the moment it's ready instead of
 * waiting for the whole set.
 */
export async function generateCharacterStream(
    description: string,
    handlers: GenerateCharacterHandlers,
): Promise<void> {
    const res = await fetch('/api/characters/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
    });

    if (!res.ok || !res.body) {
        let message = `Generation failed (${res.status})`;
        try { const j = await res.json(); if (j?.error) message = j.error; } catch { /* not json */ }
        handlers.onError?.(message);
        return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    const handleLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let evt: any;
        try { evt = JSON.parse(trimmed); } catch { return; }
        switch (evt.type) {
            case 'start': handlers.onStart?.(typeof evt.total === 'number' ? evt.total : 0); break;
            case 'image': handlers.onImage({ index: evt.index, url: evt.url, path: evt.path }); break;
            case 'pose_failed': handlers.onPoseFailed?.(evt.index); break;
            case 'error': handlers.onError?.(evt.message || 'Generation failed'); break;
            case 'done': handlers.onDone?.(); break;
        }
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
            handleLine(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
        }
    }
    if (buf.trim()) handleLine(buf);
}

