import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Standalone Supabase client for the DB layer (works in both client and server contexts).
// IMPORTANT: This client is NOT authenticated — it uses the anon key only.
// For server-side routes that need user-scoped access, use lib/supabase/server.ts instead.
// TODO (Phase 3): Migrate all client-side callers to use the BFF API layer,
// then replace this with a server-only import.
export const supabase = supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null as any;

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
}
