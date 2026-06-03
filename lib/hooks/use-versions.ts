'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { versionsApi, type WorkflowVersion } from '@/lib/api/client';

export function useVersions() {
    const canvasId = useAppStore((s) => s.activeCanvasId);
    const setCurrentWorkflow = useAppStore((s) => s.setCurrentWorkflow);
    const clearHistory = useAppStore((s) => s.clearHistory);

    const [versions, setVersions] = useState<WorkflowVersion[]>([]);
    const [loading, setLoading] = useState(false);

    const refresh = useCallback(async () => {
        if (!canvasId) return;
        setLoading(true);
        try {
            const { versions } = await versionsApi.list(canvasId);
            setVersions(versions);
        } catch (err) {
            console.error('[useVersions] list failed:', err);
        } finally {
            setLoading(false);
        }
    }, [canvasId]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const createCheckpoint = useCallback(async (label: string) => {
        if (!canvasId) return;
        await versionsApi.createCheckpoint(canvasId, label);
        await refresh();
    }, [canvasId, refresh]);

    const restore = useCallback(async (id: string) => {
        const { canvasState } = await versionsApi.restore(id);
        // Adopt as the new baseline (isDirty=false so autosave doesn't re-save).
        setCurrentWorkflow(canvasState, false);
        clearHistory();
        await refresh();
    }, [setCurrentWorkflow, clearHistory, refresh]);

    const remove = useCallback(async (id: string) => {
        await versionsApi.remove(id);
        await refresh();
    }, [refresh]);

    return { versions, loading, refresh, createCheckpoint, restore, remove };
}
