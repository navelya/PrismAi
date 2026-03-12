import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Standalone Supabase client for the DB layer (works in both client and server contexts).
// IMPORTANT: This client is NOT authenticated — it uses the anon key only.
// For server-side routes that need user-scoped access, use lib/supabase/server.ts instead.
// TODO (Phase 3): Migrate all client-side callers to use the BFF API layer,
// then replace this with a server-only import.
// Singleton instance using globalThis to survive Next.js HMR
const globalForSupabase = globalThis as unknown as {
    supabaseClient: any;
};

export const supabase = globalForSupabase.supabaseClient || (() => {
    if (supabaseUrl && supabaseAnonKey) {
        const client = createClient(supabaseUrl, supabaseAnonKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
            }
        });
        if (process.env.NODE_ENV !== 'production') {
            globalForSupabase.supabaseClient = client;
        }
        return client;
    }
    return null as any;
})();

/**
 * Database types matching our schema
 */
export interface Database {
    workflows: {
        id: string;
        user_id: string;
        name: string;
        description?: string;
        created_at: string;
        updated_at: string;
    };
    nodes: {
        id: string;
        workflow_id: string;
        node_type: string;
        position_x: number;
        position_y: number;
        config: any;
        created_at: string;
    };
    edges: {
        id: string;
        workflow_id: string;
        source_node_id: string;
        target_node_id: string;
        created_at: string;
    };
    executions: {
        id: string;
        workflow_id: string;
        status: string;
        result_data: any;
        error_message?: string;
        created_at: string;
        completed_at?: string;
    };
    sessions: {
        id: string;
        user_id: string;
        title: string;
        canvas_state: any;
        created_at: string;
        updated_at: string;
    };
    messages: {
        id: string;
        session_id: string;
        role: 'user' | 'assistant';
        content: string;
        images?: string[];
        canvas_state?: any; // Snapshot of the workflow
        created_at: string;
    };
}
