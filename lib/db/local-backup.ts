import localforage from 'localforage';
import { Workflow } from '../nodes/types';

/**
 * Local Backup Module
 * 
 * Provides high-frequency crash recovery backups using IndexedDB.
 * 
 * Storage Architecture:
 * - **IndexedDB (via localforage):** Fast, non-blocking browser storage
 *   - Stores complete workflow snapshots with timestamps
 *   - Key format: `backup_${workflowId}` or `backup_${sessionId}`
 *   - Survives page refreshes and browser crashes
 *   - NOT synced across devices (browser-local only)
 * 
 * - **When used:** Auto-save writes here every 1 second (throttled)
 * - **When cleaned:** After successful Supabase sync OR when server version is newer
 * - **Recovery:** CrashRecoveryProvider checks on session load
 * 
 * Note: This is separate from localStorage (Zustand persist), which only stores UI preferences.
 */

// Configure localforage
localforage.config({
    name: 'PrismAi',
    storeName: 'workflow_backups',
    description: 'Local backups for Prism workflows to prevent data loss'
});

export interface LocalBackup {
    workflow: Workflow;
    updatedAt: number;
    sessionId?: string;
}

/**
 * Save a workflow snapshot to local IndexedDB storage.
 * This is non-blocking and intended for high-frequency saves (e.g., 1s interval).
 */
export async function saveLocalBackup(workflowId: string, workflow: Workflow, sessionId?: string): Promise<void> {
    try {
        const backup: LocalBackup = {
            workflow,
            updatedAt: Date.now(),
            sessionId
        };
        await localforage.setItem(`backup_${workflowId}`, backup);
    } catch (error) {
        console.error('[LocalBackup] Failed to save backup:', error);
    }
}

/**
 * Retrieve the latest local backup for a workflow.
 */
export async function getLocalBackup(workflowId: string): Promise<LocalBackup | null> {
    try {
        return await localforage.getItem<LocalBackup>(`backup_${workflowId}`);
    } catch (error) {
        console.error('[LocalBackup] Failed to retrieve backup:', error);
        return null;
    }
}

/**
 * Remove local backup after successful sync or workflow deletion.
 */
export async function removeLocalBackup(workflowId: string): Promise<void> {
    try {
        await localforage.removeItem(`backup_${workflowId}`);
    } catch (error) {
        console.error('[LocalBackup] Failed to remove backup:', error);
    }
}

/**
 * Get all local backups (useful for recovery manager).
 */
export async function getAllLocalBackups(): Promise<LocalBackup[]> {
    try {
        const backups: LocalBackup[] = [];
        await localforage.iterate<LocalBackup, void>((value) => {
            backups.push(value);
        });
        return backups;
    } catch (error) {
        console.error('[LocalBackup] Failed to list backups:', error);
        return [];
    }
}
