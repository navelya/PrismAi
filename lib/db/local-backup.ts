import localforage from 'localforage';
import { Workflow } from '../nodes/types';

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
