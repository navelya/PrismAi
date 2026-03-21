import { createClient } from '../supabase/client';

// Shared instance from @/lib/supabase/client (handles singleton/HMR)
export const supabase = createClient();

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
        created_at: string;
    };
    node_executions: {
        id: string;
        session_id: string;
        node_id: string;
        status: string;
        output: any;
        error?: string;
        created_at: string;
        updated_at: string;
        user_id?: string;
    };
}
