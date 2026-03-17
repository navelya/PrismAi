'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { saveWorkflow } from '@/lib/db/workflows';
import { saveLocalBackup, removeLocalBackup } from '@/lib/db/local-backup';
import { stableStringify } from '@/lib/utils/stable-stringify';

const LOCAL_SAVE_INTERVAL = 1000; // 1s
const REMOTE_SAVE_DEBOUNCE = 2000; // 2s
const REMOTE_SAVE_THROTTLE = 30000; // 30s

/**
 * Multi-tier Auto-Save Hook
 * - Local: 1s interval to IndexedDB (non-blocking)
 * - Remote: 2s debounce / 30s throttle to Supabase
 * - Exit: sendBeacon for final sync
 */
export function useAutoSave() {
    const currentWorkflow = useAppStore(state => state.currentWorkflow);
    const activeSessionId = useAppStore(state => state.activeSessionId);
    
    const lastLocalSaveRef = useRef<string>('');
    const lastRemoteSaveRef = useRef<string>('');
    const lastRemoteSaveTimeRef = useRef<number>(0);
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

    // --- Helper: Save to Supabase (Remote) ---
    const commitRemoteSave = useCallback(async (workflow: any) => {
        if (!activeSessionId) return;
        
        const workflowStr = stableStringify(workflow);
        if (workflowStr === lastRemoteSaveRef.current) return;

        const result = await saveWorkflow(workflow, activeSessionId);
        if (result.success) {
            lastRemoteSaveRef.current = workflowStr;
            lastRemoteSaveTimeRef.current = Date.now();
            console.log('[AutoSave] Remote sync successful');
        }
    }, [activeSessionId]);

    // --- 1. Local Backup Logic (1s Interval) ---
    useEffect(() => {
        if (!currentWorkflow || !currentWorkflow.id) return;

        const interval = setInterval(async () => {
            const workflowStr = stableStringify(currentWorkflow);
            if (workflowStr !== lastLocalSaveRef.current) {
                await saveLocalBackup(currentWorkflow.id!, currentWorkflow, activeSessionId || undefined);
                lastLocalSaveRef.current = workflowStr;
            }
        }, LOCAL_SAVE_INTERVAL);

        return () => clearInterval(interval);
    }, [currentWorkflow, activeSessionId]);

    // --- 2. Remote Sync Logic (Debounce + Throttle) ---
    useEffect(() => {
        if (!currentWorkflow || !currentWorkflow.id) return;

        const workflowStr = stableStringify(currentWorkflow);
        if (workflowStr === lastRemoteSaveRef.current) return;

        const now = Date.now();
        const timeSinceLastSave = now - lastRemoteSaveTimeRef.current;

        // Clear existing debounce
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

        // a. Throttle: Force save if it's been > 30s
        if (timeSinceLastSave >= REMOTE_SAVE_THROTTLE) {
            commitRemoteSave(currentWorkflow);
        } else {
            // b. Debounce: Wait for 2s of inactivity
            debounceTimerRef.current = setTimeout(() => {
                commitRemoteSave(currentWorkflow);
            }, REMOTE_SAVE_DEBOUNCE);
        }

        return () => {
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        };
    }, [currentWorkflow, commitRemoteSave]);

    // --- 3. Exit Hook (Navigator.sendBeacon) ---
    // Note: sendBeacon is limited in payload size and only supports POST.
    // For true reliability on exit, we'd need a background worker or a robust API route.
    // Since workflows can be large, we'll try a regular fetch with 'keepalive' flag.
    useEffect(() => {
        const handleUnload = () => {
            if (!currentWorkflow || !activeSessionId) return;
            
            const workflowStr = stableStringify(currentWorkflow);
            if (workflowStr === lastRemoteSaveRef.current) return;

            // Use fetch with keepalive: true for final save on exit
            // This is more reliable than sendBeacon for JSON payloads
            fetch('/api/workflow/save-final', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workflow: currentWorkflow,
                    sessionId: activeSessionId
                }),
                keepalive: true
            }).catch(() => {
                // Ignore errors on exit
            });
        };

        window.addEventListener('beforeunload', handleUnload);
        return () => window.removeEventListener('beforeunload', handleUnload);
    }, [currentWorkflow, activeSessionId]);
}
