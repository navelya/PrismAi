import { supabase } from './supabase';
import { Workflow, WorkflowNode, WorkflowEdge, ExecutionRecord } from '../nodes/types';

/**
 * Save a workflow to the database
 */
export async function saveWorkflow(
    workflow: Workflow,
    userId: string = 'anonymous'
): Promise<{ success: boolean; workflowId?: string; error?: string }> {
    try {
        // Insert workflow
        const { data: workflowData, error: workflowError } = await supabase
            .from('workflows')
            .insert({
                user_id: userId,
                name: workflow.name,
                description: `Auto-generated workflow: ${workflow.name}`,
            })
            .select()
            .single();

        if (workflowError || !workflowData) {
            throw new Error(workflowError?.message || 'Failed to create workflow');
        }

        const workflowId = workflowData.id;

        // Insert nodes
        const nodesData = workflow.nodes.map(node => ({
            workflow_id: workflowId,
            node_type: node.type,
            position_x: node.position.x,
            position_y: node.position.y,
            config: node.data.config,
        }));

        const { data: insertedNodes, error: nodesError } = await supabase
            .from('nodes')
            .insert(nodesData)
            .select();

        if (nodesError || !insertedNodes) {
            throw new Error(nodesError?.message || 'Failed to create nodes');
        }

        // Map old node IDs to new database IDs
        const nodeIdMap = new Map<string, string>();
        workflow.nodes.forEach((node, index) => {
            nodeIdMap.set(node.id, insertedNodes[index].id);
        });

        // Insert edges with updated IDs
        if (workflow.edges.length > 0) {
            const edgesData = workflow.edges.map(edge => ({
                workflow_id: workflowId,
                source_node_id: nodeIdMap.get(edge.source)!,
                target_node_id: nodeIdMap.get(edge.target)!,
            }));

            const { error: edgesError } = await supabase
                .from('edges')
                .insert(edgesData);

            if (edgesError) {
                throw new Error(edgesError.message);
            }
        }

        return {
            success: true,
            workflowId,
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Get a workflow from the database
 */
export async function getWorkflow(workflowId: string): Promise<Workflow | null> {
    try {
        const { data: workflowData, error: workflowError } = await supabase
            .from('workflows')
            .select('*')
            .eq('id', workflowId)
            .single();

        if (workflowError || !workflowData) {
            return null;
        }

        const { data: nodesData } = await supabase
            .from('nodes')
            .select('*')
            .eq('workflow_id', workflowId);

        const { data: edgesData } = await supabase
            .from('edges')
            .select('*')
            .eq('workflow_id', workflowId);

        const nodes: WorkflowNode[] = (nodesData || []).map((node: any) => ({
            id: node.id,
            type: node.node_type as any,
            position: {
                x: node.position_x,
                y: node.position_y,
            },
            data: {
                label: node.node_type,
                config: node.config,
            },
        }));

        const edges: WorkflowEdge[] = (edgesData || []).map((edge: any) => ({
            id: edge.id,
            source: edge.source_node_id,
            target: edge.target_node_id,
        }));

        return {
            id: workflowData.id,
            name: workflowData.name,
            nodes,
            edges,
        };
    } catch (error) {
        console.error('Error fetching workflow:', error);
        return null;
    }
}

/**
 * Save execution result to database
 */
export async function saveExecution(
    workflowId: string,
    status: string,
    resultData: any,
    errorMessage?: string
): Promise<{ success: boolean; executionId?: string; error?: string }> {
    try {
        const { data, error } = await supabase
            .from('executions')
            .insert({
                workflow_id: workflowId,
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
 * Get execution history for a workflow
 */
export async function getExecutionHistory(workflowId: string): Promise<ExecutionRecord[]> {
    try {
        const { data, error } = await supabase
            .from('executions')
            .select('*')
            .eq('workflow_id', workflowId)
            .order('created_at', { ascending: false });

        if (error || !data) {
            return [];
        }

        return data.map((execution: any) => ({
            id: execution.id,
            workflowId: execution.workflow_id,
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
 * Get recent workflows
 */
export async function getRecentWorkflows(userId: string = 'anonymous', limit: number = 10) {
    try {
        const { data, error } = await supabase
            .from('workflows')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            throw new Error(error.message);
        }

        return data || [];
    } catch (error) {
        console.error('Error fetching recent workflows:', error);
        return [];
    }
}
