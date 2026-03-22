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
            resultData: {}, // V3 stores node-specific results in node_results
            errorMessage: undefined,
            createdAt: execution.created_at,
            completedAt: undefined,
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

        // V3: We must find the latest execution for this session
        const { data: latestExec } = await supabase
            .from('executions')
            .select('id')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (!latestExec) {
            throw new Error('No execution found for session');
        }

        const resultUrl = typeof output === 'string' ? output : (output?.url || output?.[0]?.url);

        const { error: upsertError } = await supabase
            .from('node_results')
            .upsert({
                execution_id: latestExec.id,
                node_id: nodeId,
                status: status,
                result_url: resultUrl,
                error: error,
                updated_at: new Date().toISOString(),
            }, {
                onConflict: 'execution_id,node_id'
            });

        if (upsertError) {
            throw new Error(upsertError.message);
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
): Promise<{ 
    executions: Array<{ nodeId: string; status: string; output: any; outputMetadata?: any; error?: string; updatedAt: string }>;
    latestExecutionId: string | null;
}> {
    try {
        // V3: Get all executions for this session
        const { data: executions, error: execError } = await supabase
            .from('executions')
            .select('id')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: false });

        if (execError || !executions || executions.length === 0) {
            if (execError) console.error('[getSessionExecutions] Exec fetch error:', execError);
            return { executions: [], latestExecutionId: null };
        }

        // Map execution IDs array and query all node results 
        // belonging to these executions, ordered by newest first
        const executionIds = executions.map((e: any) => e.id);
        const { data, error } = await supabase
            .from('node_results')
            .select('*')
            .in('execution_id', executionIds)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('[getSessionExecutions] Results fetch error:', error);
            return { executions: [], latestExecutionId: null };
        }

        // Keep only the latest result per node (first seen due to descending order)
        const latestResults = new Map();
        for (const row of (data || [])) {
            if (!latestResults.has(row.node_id)) {
                latestResults.set(row.node_id, row);
            }
        }

        return {
            executions: Array.from(latestResults.values()).map((row: any) => ({
                nodeId: row.node_id,
                status: row.status,
                output: row.result_url ? { url: row.result_url } : undefined,
                outputMetadata: {
                    preview_urls: row.result_url ? [row.result_url] : [],
                    resultUrls: row.result_url ? [row.result_url] : []
                },
                error: row.error,
                updatedAt: row.updated_at
            })),
            latestExecutionId: executions[0].id
        };
    } catch (err) {
        console.error('[getSessionExecutions] Exception:', err);
        return { executions: [], latestExecutionId: null };
    }
}

/**
 * Clear all executions for a session (for workflow reset)
 */
export async function clearSessionExecutions(
    sessionId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        // Cascade will handle node_results
        const { error } = await supabase
            .from('executions')
            .delete()
            .eq('session_id', sessionId);

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
        const { data: latestExec } = await supabase
            .from('executions')
            .select('id')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (!latestExec) throw new Error('No execution found');

        const { error } = await supabase
            .from('node_results')
            .upsert(
                executions.map(exec => ({
                    execution_id: latestExec.id,
                    node_id: exec.nodeId,
                    status: exec.status,
                    result_url: typeof exec.output === 'string' ? exec.output : (exec.output?.url || exec.output?.[0]?.url),
                    error: exec.error,
                    updated_at: new Date().toISOString(),
                })),
                { onConflict: 'execution_id,node_id' }
            );

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


