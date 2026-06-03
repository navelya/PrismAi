'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { versionsApi, type WorkflowVersion } from '@/lib/api/client';
import { onVersionsChanged, emitVersionsChanged } from '@/lib/versions-bus';

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

    // Initial load + reload when the canvas changes.
    useEffect(() => {
        void refresh();
    }, [refresh]);

    // Stay in sync when a version is created/restored/deleted elsewhere
    // (e.g. the toolbar "Save checkpoint" button while this panel is open).
    useEffect(() => onVersionsChanged(() => { void refresh(); }), [refresh]);

    const createCheckpoint = useCallback(async (label: string) => {
        if (!canvasId) return;
        await versionsApi.createCheckpoint(canvasId, label);
        emitVersionsChanged();
    }, [canvasId]);

    const restore = useCallback(async (id: string) => {
        const { canvasState } = await versionsApi.restore(id);
        // Adopt as the new baseline (isDirty=false so autosave doesn't re-save).
        setCurrentWorkflow(canvasState, false);
        clearHistory();
        // Restore creates a safety auto-version server-side, so the list changed.
        emitVersionsChanged();
    }, [setCurrentWorkflow, clearHistory]);

    const remove = useCallback(async (id: string) => {
        await versionsApi.remove(id);
        emitVersionsChanged();
    }, []);

    return { versions, loading, refresh, createCheckpoint, restore, remove };
}
