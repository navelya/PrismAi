'use client';

import React, { useEffect } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { getLocalBackup } from '@/lib/db/local-backup';
import { getWorkflow } from '@/lib/db/workflows';
import { useAutoSave } from '@/hooks/useAutoSave';

interface CrashRecoveryProviderProps {
    children: React.ReactNode;
}

/**
 * Manages silent crash recovery and automatic state restoration.
 * Also initializes the global auto-save hook.
 */
export function CrashRecoveryProvider({ children }: CrashRecoveryProviderProps) {
    // Initialize the auto-save engine globally
    useAutoSave();

    const currentWorkflow = useAppStore(state => state.currentWorkflow);
    const setCurrentWorkflow = useAppStore(state => state.setCurrentWorkflow);
    const activeSessionId = useAppStore(state => state.activeSessionId);

    useEffect(() => {
        const recoverSession = async () => {
            // Only attempt recovery if we have a workflow ID in the store but it's empty or stale
            if (!currentWorkflow?.id) return;

            try {
                // 1. Fetch Local Backup
                const localBackup = await getLocalBackup(currentWorkflow.id);
                if (!localBackup) return;

                // 2. Fetch Server Record (to compare timestamps)
                const serverWorkflow = await getWorkflow(currentWorkflow.id);
                
                // Note: serverWorkflow will have nodes/edges, we need to compare metadata
                // We'll assume workflows table has an updated_at
                const serverTime = serverWorkflow ? new Date((serverWorkflow as any).updated_at || 0).getTime() : 0;
                const localTime = localBackup.updatedAt;

                // 3. Automatic Restore: If local is newer (> 5s difference to account for transit lag)
                if (localTime > (serverTime + 5000)) {
                    console.log(`[CrashRecovery] Local backup is newer (${localTime} vs ${serverTime}). Restoring...`);
                    setCurrentWorkflow(localBackup.workflow);
                }
            } catch (error) {
                console.error('[CrashRecovery] Failed to recover session:', error);
            }
        };

        recoverSession();
    }, [activeSessionId, currentWorkflow?.id, setCurrentWorkflow]);

    return <>{children}</>;
}
