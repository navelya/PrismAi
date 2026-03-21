import { supabase } from './supabase';
import { Workflow, ExecutionRecord } from '../nodes/types';

/**
 * Save a workflow snapshot to the sessions table (Primary Source of Truth)
 */
export async function saveWorkflow(
    workflow: Workflow,
    sessionId: string
): Promise<{ success: boolean; sessionId?: string; error?: string }> {
    try {
        if (!sessionId) {
            throw new Error('Missing sessionId context for save');
        }

        // 1. Update the session with the latest canvas state
        const { error: sessionError } = await supabase
            .from('sessions')
            .update({
                canvas_state: workflow,
                updated_at: new Date().toISOString(),
            })
            .eq('id', sessionId);

        if (sessionError) {
            throw new Error(sessionError.message);
        }

        return {
            success: true,
            sessionId,
        };
    } catch (error) {
        console.error('[saveWorkflow] Error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Get a workflow from the sessions table
 */
export async function getWorkflow(sessionId: string): Promise<Workflow | null> {
    try {
        const { data: sessionData, error: sessionError } = await supabase
            .from('sessions')
            .select('canvas_state')
            .eq('id', sessionId)
            .single();

        if (sessionError || !sessionData) {
            return null;
        }

        return sessionData.canvas_state as Workflow;
    } catch (error) {
        console.error('Error fetching session workflow:', error);
        return null;
    }
}

/**
 * Save execution result to database (links to sessions)
 */
export async function saveExecution(
    sessionId: string,
    status: string,
    resultData: any,
    errorMessage?: string
): Promise<{ success: boolean; executionId?: string; error?: string }> {
    try {
        const { data, error } = await supabase
            .from('executions')
            .insert({
                session_id: sessionId,
                status,
                result_data: resultData,
                error_message: errorMessage,
                completed_at: status === 'completed' || status === 'failed' ? new Date().toISOString() : null,
            })
            .select()
            .single();

        if (error || !data) {
            throw new Error(error?.message || 'Failed to save execution');
        }

        return {
            success: true,
            executionId: data.id,
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Get execution history for a session
 */
export async function getExecutionHistory(sessionId: string): Promise<ExecutionRecord[]> {
    try {
        const { data, error } = await supabase
            .from('executions')
            .select('*')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: false });

        if (error || !data) {
            return [];
        }

        return data.map((execution: any) => ({
            id: execution.id,
            sessionId: execution.session_id,
            status: execution.status as any,
            resultData: execution.result_data,
            errorMessage: execution.error_message,
            createdAt: execution.created_at,
            completedAt: execution.completed_at,
        }));
    } catch (error) {
        console.error('Error fetching execution history:', error);
        return [];
    }
}

/**
 * Get recent active sessions
 */
export async function getRecentWorkflows(userId: string = 'anonymous', limit: number = 10) {
    try {
        const { data, error } = await supabase
            .from('sessions')
            .select('id, title, canvas_state, created_at, updated_at')
            .eq('user_id', userId)
            .eq('is_deleted', false)
            .order('updated_at', { ascending: false })
            .limit(limit);

        if (error) {
            throw new Error(error.message);
        }

        return data || [];
    } catch (error) {
        console.error('Error fetching recent sessions:', error);
        return [];
    }
}

// ✅ PHASE 3 FIX: Node Execution Functions (Table-Based)
// Separate table for execution state - complete isolation from canvas_state
// These should ONLY be called by the execution engine, never by client auto-save

/**
 * Upsert node execution (insert or update)
 */
export async function upsertNodeExecution(
    sessionId: string,
    nodeId: string,
    status: string,
    output?: any,
    error?: string
): Promise<{ success: boolean; error?: string }> {
    try {
        if (!sessionId || !nodeId) {
            throw new Error('Missing sessionId or nodeId for execution upsert');
        }

        const { error: rpcError } = await supabase
            .rpc('upsert_node_execution', {
                p_session_id: sessionId,
                p_node_id: nodeId,
                p_status: status,
                p_output: output,
                p_error: error
            });

        if (rpcError) {
            throw new Error(rpcError.message);
        }

        return { success: true };
    } catch (err) {
        console.error('[upsertNodeExecution] Error:', err);
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
        };
    }
}

/**
 * Get all node executions for a session
 */
export async function getSessionExecutions(
    sessionId: string
): Promise<Array<{ nodeId: string; status: string; output: any; error?: string; updatedAt: string }>> {
    try {
        const { data, error } = await supabase
            .rpc('get_session_executions', {
                p_session_id: sessionId
            });

        if (error) {
            console.error('[getSessionExecutions] Error:', error);
            return [];
        }

        return (data || []).map((row: any) => ({
            nodeId: row.node_id,
            status: row.status,
            output: row.output,
            error: row.error,
            updatedAt: row.updated_at
        }));
    } catch (err) {
        console.error('[getSessionExecutions] Error:', err);
        return [];
    }
}

/**
 * Clear all executions for a session (for workflow reset)
 */
export async function clearSessionExecutions(
    sessionId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const { error } = await supabase
            .rpc('clear_session_executions', {
                p_session_id: sessionId
            });

        if (error) {
            throw new Error(error.message);
        }

        return { success: true };
    } catch (err) {
        console.error('[clearSessionExecutions] Error:', err);
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
        };
    }
}

/**
 * Batch upsert executions (for initial load or bulk updates)
 */
export async function batchUpsertExecutions(
    sessionId: string,
    executions: Array<{ nodeId: string; status: string; output?: any; error?: string }>
): Promise<{ success: boolean; error?: string }> {
    try {
        const { error } = await supabase
            .rpc('batch_upsert_executions', {
                p_session_id: sessionId,
                p_executions: executions
            });

        if (error) {
            throw new Error(error.message);
        }

        return { success: true };
    } catch (err) {
        console.error('[batchUpsertExecutions] Error:', err);
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
        };
    }
}


