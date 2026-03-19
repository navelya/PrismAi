'use client';

import React, { useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { getLocalBackup, removeLocalBackup, cleanupOrphanedBackups } from '@/lib/db/local-backup';
import { sessionsApi } from '@/lib/api/client';
import { useAutoSave } from '@/hooks/useAutoSave';
import { Toast } from '@/components/ui/Toast';
import type { Workflow } from '@/lib/nodes/types';

interface CrashRecoveryProviderProps {
    children: React.ReactNode;
}

/**
 * CrashRecoveryProvider
 * 
 * Manages crash recovery and automatic state restoration.
 * 
 * Dual-Storage Architecture:
 * - **IndexedDB (via localforage):** High-frequency local snapshots (1s) for crash recovery
 * - **Supabase (PostgreSQL):** Canonical source of truth, durable cloud storage
 * - **localStorage (via Zustand persist):** UI preferences only (zoom, theme, etc.)
 * 
 * Recovery Flow:
 * 1. On session load, checks for local backup in IndexedDB
 * 2. Compares local backup timestamp with server session.updated_at
 * 3. If local is newer (crash/sync failure), automatically restores it
 * 4. Shows success toast after restore
 * 5. Cleans up local backup after successful sync
 * 
 * Also initializes the global auto-save hook.
 */
export function CrashRecoveryProvider({ children }: CrashRecoveryProviderProps) {
    // Initialize the auto-save engine globally
    useAutoSave();

    const activeSessionId = useAppStore(state => state.activeSessionId);
    const setCurrentWorkflow = useAppStore(state => state.setCurrentWorkflow);
    const [hasCheckedRecovery, setHasCheckedRecovery] = useState<Set<string>>(new Set());
    const [showSuccessToast, setShowSuccessToast] = useState(false);
    const [toastMessage, setToastMessage] = useState('');

    // --- Orphaned Backup Cleanup (runs once on mount) ---
    // Removes stale IndexedDB backups whose sessions no longer exist server-side.
    useEffect(() => {
        const runOrphanCleanup = async () => {
            try {
                const { sessions } = await sessionsApi.list();
                const activeIds = sessions.map((s: any) => s.id as string);
                await cleanupOrphanedBackups(activeIds);
            } catch (err) {
                // Non-critical — never let cleanup failure block the app.
                console.warn('[CrashRecovery] Orphan cleanup skipped:', err);
            }
        };
        runOrphanCleanup();
    }, []); // empty deps = run only once on mount

    useEffect(() => {
        const attemptRecovery = async () => {
            if (!activeSessionId || hasCheckedRecovery.has(activeSessionId)) {
                return;
            }

            try {
                const localBackup = await getLocalBackup(activeSessionId);
                if (!localBackup) {
                    setHasCheckedRecovery(prev => new Set(prev).add(activeSessionId));
                    return;
                }

                const { session } = await sessionsApi.load(activeSessionId);
                if (!session) {
                    setHasCheckedRecovery(prev => new Set(prev).add(activeSessionId));
                    return;
                }

                const serverTime = session.updated_at 
                    ? new Date(session.updated_at).getTime() 
                    : 0;
                const localTime = localBackup.updatedAt;

                // Compare timestamps (5-second tolerance for network lag)
                if (localTime > (serverTime + 5000)) {
                    // Automate recovery: Skip the prompt and restore directly
                    console.log('[CrashRecovery] Newer local backup found. Auto-restoring...');
                    await executeRestore(localBackup.workflow, localTime);
                } else {
                    await removeLocalBackup(activeSessionId);
                }

            } catch (error) {
                console.error('[CrashRecovery] Recovery check failed:', error);
            } finally {
                setHasCheckedRecovery(prev => new Set(prev).add(activeSessionId));
            }
        };

        attemptRecovery();
    }, [activeSessionId, hasCheckedRecovery]);

    const executeRestore = async (workflow: Workflow, timestamp: number) => {
        if (!activeSessionId) return;

        try {
            setCurrentWorkflow(workflow);
            await sessionsApi.update(activeSessionId, {
                canvas_state: workflow
            });
            await removeLocalBackup(activeSessionId);
            
            // Calculate time ago for toast message
            const timeDiff = Date.now() - timestamp;
            const minutesAgo = Math.floor(timeDiff / 60000);
            const timeAgo = minutesAgo < 1 ? 'less than a minute' : 
                           minutesAgo === 1 ? '1 minute' : 
                           `${minutesAgo} minutes`;
            
            const nodeCount = workflow.nodes?.length || 0;
            setToastMessage(`Automatically restored workflow (${nodeCount} nodes) from ${timeAgo} ago`);
            setShowSuccessToast(true);
        } catch (error) {
            console.error('[CrashRecovery] Auto-restore failed:', error);
        }
    };

    return (
        <>
            {children}
            {showSuccessToast && (
                <Toast
                    message={toastMessage}
                    duration={5000}
                    onClose={() => setShowSuccessToast(false)}
                />
            )}
        </>
    );
}
