'use client';

import { useState, useEffect } from 'react';
import { getRecentWorkflows } from '@/lib/db/workflows';

export function useWorkflowLibrary() {
    const [workflows, setWorkflows] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadWorkflows = async () => {
        try {
            setLoading(true);
            const data = await getRecentWorkflows('anonymous', 50);
            setWorkflows(data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load workflows');
        } finally {
            setLoading(false);
        }
    };

    const deleteWorkflow = async (id: string) => {
        // Placeholder for delete functionality
        // Placeholder for delete functionality
        // After implementing delete API, reload workflows
    };

    useEffect(() => {
        loadWorkflows();
    }, []);

    return {
        workflows,
        loading,
        error,
        loadWorkflows,
        deleteWorkflow,
    };
}
