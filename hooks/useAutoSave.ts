'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { saveWorkflow } from '@/lib/db/workflows';
import { stableStringify } from '@/lib/utils/stable-stringify';
import { saveLocalBackup, removeLocalBackup } from '@/lib/db/local-backup';
import { throttle } from '@/lib/utils/performance';

/**
 * useAutoSave Hook
 * 
 * Centralizes the persistence logic for the workflow editor.
 * 
 * Dual-Storage Strategy:
 * - **Local (IndexedDB via localforage):** High-frequency snapshots (1s throttle) for crash recovery
 *   - Non-blocking, async writes to browser's IndexedDB
 *   - Survives page refreshes and browser crashes
 *   - Automatically cleaned up after successful remote sync
 * 
 * - **Remote (Supabase PostgreSQL):** Durable storage with debounce (2s) + maxWait (30s throttle)
 *   - Canonical source of truth for all workflows
 *   - Debounced to reduce unnecessary network calls
 *   - Force-saved every 30 seconds during continuous editing
 * 
 * - **localStorage (Zustand persist):** UI preferences ONLY (zoom, viewport, theme, etc.)
 *   - NOT used for workflow data - see app-store.ts partialize config
 *   - Persists across sessions for user convenience
 * 
 * Features:
 * 1. Local backup to IndexedDB every 1 second (throttled).
 * 2. Debounced saving to Supabase (2 second delay after last change).
 * 3. Max-wait throttle ensuring Supabase save every 30 seconds during continuous editing.
 * 4. Emergency save on exit using navigator.sendBeacon() with keepalive fallback.
 * 5. Prevents redundant saves using content-hash comparison.
 * 6. Cleanup of local backups after successful remote sync.
 */
export function useAutoSave() {
    const currentWorkflow = useAppStore((state) => state.currentWorkflow);
    const activeSessionId = useAppStore((state) => state.activeSessionId);
    const isWorkflowDirty = useAppStore((state) => state.isWorkflowDirty);
    const setWorkflowDirty = useAppStore((state) => state.setWorkflowDirty);
    const isDragging = useAppStore((state) => state.isDragging);

    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const throttleTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lastRemoteSavedHashRef = useRef<string>('');
    const lastLocalSavedHashRef = useRef<string>('');
    const isSavingRemoteRef = useRef(false);
    const lastRemoteSaveTimeRef = useRef<number>(0);
    
    // Store refs for current values to avoid stale closures
    const currentWorkflowRef = useRef(currentWorkflow);
    const activeSessionIdRef = useRef(activeSessionId);
    
    useEffect(() => {
        currentWorkflowRef.current = currentWorkflow;
        activeSessionIdRef.current = activeSessionId;
    }, [currentWorkflow, activeSessionId]);

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
    const persistRemote = useCallback(async (isEmergency = false) => {
        if (!currentWorkflow || !activeSessionId || isSavingRemoteRef.current) return;

        const currentHash = stableStringify(currentWorkflow);
        if (currentHash === lastRemoteSavedHashRef.current) {
            setWorkflowDirty(false);
            return;
        }

        try {
            isSavingRemoteRef.current = true;
            
            const result = await saveWorkflow(currentWorkflow, activeSessionId);
            
            if (result.success) {
                lastRemoteSavedHashRef.current = currentHash;
                lastRemoteSaveTimeRef.current = Date.now();
                setWorkflowDirty(false);
                
                // Cleanup local backup after successful remote sync
                try {
                    await removeLocalBackup(currentWorkflow.id || activeSessionId);
                } catch (cleanupErr) {
                    console.error('[AutoSave] Cleanup failed:', cleanupErr);
                }
            }
        } catch (err) {
            console.error('[AutoSave] Save failed:', err);
        } finally {
            isSavingRemoteRef.current = false;
        }
    }, [currentWorkflow, activeSessionId, setWorkflowDirty]);

    // 1. Local Backup Effect (high-frequency, throttled)
    useEffect(() => {
        if (!isWorkflowDirty || !activeSessionId || !currentWorkflow) return;
        saveLocalThrottledRef.current?.();
    }, [isWorkflowDirty, activeSessionId, currentWorkflow]);

    // 2. Debounced Remote Save Effect (2s after last change)
    useEffect(() => {
        if (!isWorkflowDirty || isDragging || !activeSessionId) return;

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
    }, [isWorkflowDirty, isDragging, activeSessionId, persistRemote]);

    // 3. Max-Wait Throttle Effect (force save every 30s during continuous editing)
    useEffect(() => {
        if (!isWorkflowDirty || !activeSessionId) return;

        if (throttleTimerRef.current) {
            clearTimeout(throttleTimerRef.current);
        }

        const timeSinceLastSave = Date.now() - lastRemoteSaveTimeRef.current;
        const maxWaitMs = 30000; // 30 seconds

        if (timeSinceLastSave >= maxWaitMs) {
            persistRemote();
        } else {
            const remainingTime = maxWaitMs - timeSinceLastSave;
            throttleTimerRef.current = setTimeout(() => {
                if (isWorkflowDirty) {
                    persistRemote();
                }
            }, remainingTime);
        }

        return () => {
            if (throttleTimerRef.current) {
                clearTimeout(throttleTimerRef.current);
            }
        };
    }, [isWorkflowDirty, activeSessionId, persistRemote]);

    // 4. Emergency Save on Exit (beforeunload with sendBeacon)
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
                    }).catch(() => {});
                }
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [isWorkflowDirty, currentWorkflow, activeSessionId]);
}
