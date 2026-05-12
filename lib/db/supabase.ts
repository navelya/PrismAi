import { createClient } from '../supabase/client';

type SupabaseClient = ReturnType<typeof createClient>;

let _client: SupabaseClient | undefined;

export const supabase = new Proxy({} as SupabaseClient, {
    get(_target, prop) {
        if (!_client) _client = createClient();
        const value = Reflect.get(_client, prop);
        return typeof value === 'function' ? value.bind(_client) : value;
    },
});

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
        session_id: string;
        status: string;
        created_at: string;
        updated_at: string;
        graph_json?: any; // To be added for V3 compatibility
    };
    node_results: {
        id: string;
        execution_id: string;
        node_id: string;
        status: string;
        result_type?: 'image' | 'video' | 'audio' | '3d' | 'text' | 'json';
        result_data?: any[];
        result_url?: string; // legacy
        error?: string;
        replicate_id?: string;
        created_at: string;
        updated_at: string;
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
}
