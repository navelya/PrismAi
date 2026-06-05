'use client';

import { useCallback } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { versionsApi } from '@/lib/api/client';
import { emitVersionsChanged } from '@/lib/versions-bus';

/**
 * Versions are preloaded into the store when the canvas opens and kept in sync
 * via the versions bus (see WorkspaceLayout), so this hook is a thin reader —
 * opening the History panel never refetches. Mutations emit the bus; the store
 * refresh is handled centrally.
 */
export function useVersions() {
    const canvasId = useAppStore((s) => s.activeCanvasId);
    const setCurrentWorkflow = useAppStore((s) => s.setCurrentWorkflow);
    const clearHistory = useAppStore((s) => s.clearHistory);

    const versions = useAppStore((s) => s.versions);
    const loading = useAppStore((s) => s.versionsLoading);
    const fetchVersions = useAppStore((s) => s.fetchVersions);

    const refresh = useCallback(async () => {
        if (canvasId) await fetchVersions(canvasId, true);
    }, [canvasId, fetchVersions]);

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
