'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { saveWorkflow } from '@/lib/db/workflows';
import { stableStringify } from '@/lib/utils/stable-stringify';
import { saveLocalBackup, removeLocalBackup } from '@/lib/db/local-backup';
import { throttle } from '@/lib/utils/performance';
import { setServerWorkflowHash, markLocalSave } from '@/lib/hooks/use-chat-realtime';

/**
 * useAutoSave Hook
 *
 * Centralizes persistence for the workflow editor.
 *
 * Strategy (pure debounce, no special-casing):
 * - **Local (IndexedDB via localforage):** throttled to 1s while dirty for
 *   crash recovery. Cheap, async, non-blocking.
 * - **Remote (Supabase):** fires only after the workflow has been stable for
 *   2 seconds. No force-save, no isDragging gate — continuous edits naturally
 *   keep resetting the debounce timer until the user pauses.
 * - **localStorage (Zustand persist):** UI prefs only (see app-store.ts).
 *
 * Emergency save on `beforeunload` uses `navigator.sendBeacon` so any pending
 * dirty state lands even if the user closes the tab during a debounce window.
 */
export function useAutoSave() {
    const currentWorkflow = useAppStore((state) => state.currentWorkflow);
    const activeSessionId = useAppStore((state) => state.activeSessionId);
    const activeCanvasId = useAppStore((state) => state.activeCanvasId);
    const isWorkflowDirty = useAppStore((state) => state.isWorkflowDirty);
    const setWorkflowDirty = useAppStore((state) => state.setWorkflowDirty);
    const isLoadingSession = useAppStore((state) => state.isLoadingSession);

    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lastRemoteSavedHashRef = useRef<string>('');
    const lastLocalSavedHashRef = useRef<string>('');
    const isSavingRemoteRef = useRef(false);

    // Store refs for current values to avoid stale closures
    const currentWorkflowRef = useRef(currentWorkflow);
    const activeSessionIdRef = useRef(activeSessionId);
    const activeCanvasIdRef = useRef(activeCanvasId);

    useEffect(() => {
        currentWorkflowRef.current = currentWorkflow;
        activeSessionIdRef.current = activeSessionId;
    }, [currentWorkflow, activeSessionId]);

    useEffect(() => {
        activeCanvasIdRef.current = activeCanvasId;
    }, [activeCanvasId]);

    // Local backup function (will be throttled)
    const saveLocal = useCallback(async () => {
        const workflow = currentWorkflowRef.current;
        const sessionId = activeSessionIdRef.current;

        if (!workflow || !sessionId) return;

        const currentHash = stableStringify(workflow);
        if (currentHash === lastLocalSavedHashRef.current) return;

        try {
            // Non-blocking local save to IndexedDB
            await saveLocalBackup(
                workflow.id || sessionId,
                workflow,
                sessionId
            );
            lastLocalSavedHashRef.current = currentHash;
        } catch (err) {
            console.error('[AutoSave] Local backup failed:', err);
        }
    }, []); // No dependencies - uses refs

    // Create throttled version once and keep it stable
    const saveLocalThrottledRef = useRef<(() => void) | null>(null);
    if (!saveLocalThrottledRef.current) {
        saveLocalThrottledRef.current = throttle(saveLocal, 1000);
    }

    // Remote persist to Supabase
    // IMPORTANT: reads currentWorkflow and activeSessionId from refs (not closed-over render
    // values) so that a mid-flight session switch cannot cause a stale ID to be written.
    const persistRemote = useCallback(async (isEmergency = false) => {
        const workflow = currentWorkflowRef.current;
        const sessionId = activeSessionIdRef.current;
        const store = useAppStore.getState();

        // V3: No longer block auto-save during execution
        // Execution state is in node_results table (separate from canvas_state)
        // Canvas modifications won't affect running executions

        if (!workflow || !sessionId || isSavingRemoteRef.current) return;

        // Use the shared canvas id when available (collab decoupling); fall back
        // to the thread session id for non-collab sessions.
        const saveTarget = activeCanvasIdRef.current || sessionId;

        // ✅ PHASE 1 FIX: Sanitize execution state before saving
        // CRITICAL: Never save node status/output client-side
        // These are managed by the execution engine and should only come from the server
        const sanitizedWorkflow = {
            ...workflow,
            nodes: workflow.nodes.map(n => ({
                ...n,
                data: {
                    ...n.data,
                    // Remove execution state - these are read-only from client perspective
                    // IMPORTANT: We keep outputMetadata because it contains storage URLs (thumbnails)
                    status: undefined,
                    output: undefined,
                }
            }))
        };

        const currentHash = stableStringify(sanitizedWorkflow);
        if (currentHash === lastRemoteSavedHashRef.current) {
            setWorkflowDirty(false);
            return;
        }

        try {
            isSavingRemoteRef.current = true;

            const result = await saveWorkflow(sanitizedWorkflow, saveTarget);

            if (result.success) {
                lastRemoteSavedHashRef.current = currentHash;
                setServerWorkflowHash(sanitizedWorkflow);
                // Stamp the save time so the realtime handler can ignore the
                // self-echo (and any stale echoes from prior saves) for a
                // short grace window — the hash check alone misses the case
                // where dirty has just been cleared but the user has already
                // started a new edit.
                markLocalSave();

                // Only clear the dirty flag if the workflow hasn't changed
                // during the in-flight save. If the user made an edit between
                // persistRemote starting and the response landing, leave dirty
                // true so the debounce re-fires and saves the latest state.
                const latestWorkflow = currentWorkflowRef.current;
                if (latestWorkflow) {
                    const latestSanitized = {
                        ...latestWorkflow,
                        nodes: latestWorkflow.nodes.map((n: any) => ({
                            ...n,
                            data: { ...n.data, status: undefined, output: undefined },
                        })),
                    };
                    const latestHash = stableStringify(latestSanitized);
                    if (latestHash === currentHash) {
                        setWorkflowDirty(false);
                    }
                } else {
                    setWorkflowDirty(false);
                }

                // Cleanup local backup after successful remote sync
                try {
                    await removeLocalBackup(workflow.id || sessionId);
                } catch (cleanupErr) {
                    console.error('[AutoSave] Cleanup failed:', cleanupErr);
                }
            }
        } catch (err) {
            console.error('[AutoSave] Save failed:', err);

            // Telemetry: fire-and-forget to capture failures in server logs.
            // sendBeacon is guaranteed not to block the current execution context.
            try {
                const payload = JSON.stringify({
                    sessionId,
                    errorMessage: err instanceof Error ? err.message : String(err),
                    timestamp: new Date().toISOString(),
                });
                if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
                    navigator.sendBeacon(
                        '/api/telemetry/save-error',
                        new Blob([payload], { type: 'application/json' })
                    );
                }
            } catch {
                // Never let telemetry reporting cause a secondary failure.
            }
        } finally {
            isSavingRemoteRef.current = false;
        }
    }, [setWorkflowDirty]); // refs are stable — no need to list currentWorkflow/activeSessionId

    // 1. Local Backup Effect (high-frequency, throttled)
    useEffect(() => {
        if (!isWorkflowDirty || !activeSessionId || !currentWorkflow || isLoadingSession) return;
        saveLocalThrottledRef.current?.();
    }, [isWorkflowDirty, activeSessionId, currentWorkflow, isLoadingSession]);

    // 2. Debounced Remote Save Effect — fires 2s after the LAST change to
    //    currentWorkflow. Continuous editing keeps resetting the timer; the
    //    user pausing for 2s triggers the save. No isDragging gate, no force.
    useEffect(() => {
        if (!isWorkflowDirty || !activeSessionId || isLoadingSession) return;

        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        debounceTimerRef.current = setTimeout(() => {
            persistRemote();
        }, 2000);

        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
        };
    }, [isWorkflowDirty, currentWorkflow, activeSessionId, persistRemote, isLoadingSession]);

    // (force-save throttle removed — pure debounce only)

    // 3. Emergency Save on Exit (beforeunload with sendBeacon)
    useEffect(() => {
        const handleBeforeUnload = () => {
            if (isWorkflowDirty && currentWorkflow && activeSessionId) {
                const payload = JSON.stringify({
                    sessionId: activeSessionId,
                    canvas_state: currentWorkflow,
                });

                const blob = new Blob([payload], { type: 'application/json' });
                const url = '/api/sessions/beacon';

                if (navigator.sendBeacon) {
                    navigator.sendBeacon(url, blob);
                } else {
                    // Fallback for older browsers
                    fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: payload,
                        keepalive: true,
                    }).catch(() => { });
                }
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [isWorkflowDirty, currentWorkflow, activeSessionId]);
}
