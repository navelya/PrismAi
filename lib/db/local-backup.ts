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
/** Returns true if the error is a storage quota error across browser vendors. */
function isQuotaError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return (
        error.name === 'QuotaExceededError' ||
        error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        error.message.toLowerCase().includes('quota')
    );
}

export async function saveLocalBackup(workflowId: string, workflow: Workflow, sessionId?: string): Promise<void> {
    const backup: LocalBackup = {
        workflow,
        updatedAt: Date.now(),
        sessionId
    };

    try {
        await localforage.setItem(`backup_${workflowId}`, backup);
    } catch (error) {
        if (!isQuotaError(error)) {
            console.error('[LocalBackup] Failed to save backup:', error);
            return;
        }

        // Quota hit — evict the oldest entry and retry once.
        console.warn('[LocalBackup] Quota exceeded, retrying after eviction...');
        try {
            let oldestKey: string | null = null;
            let oldestTime = Infinity;

            await localforage.iterate<LocalBackup, void>((value, key) => {
                if (value.updatedAt < oldestTime) {
                    oldestTime = value.updatedAt;
                    oldestKey = key;
                }
            });

            if (oldestKey) {
                await localforage.removeItem(oldestKey);
                await localforage.setItem(`backup_${workflowId}`, backup);
            }
        } catch (retryError) {
            // Silent fail — local backup is best-effort; remote Supabase is the source of truth.
            console.error('[LocalBackup] Eviction retry failed, skipping local save:', retryError);
        }
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

/**
 * Remove any local backups whose session ID is not in the provided active set.
 * Call once on app load with the user's current session list to prevent
 * IndexedDB from growing indefinitely with stale snapshots.
 */
export async function cleanupOrphanedBackups(activeSessionIds: string[]): Promise<void> {
    try {
        const activeSet = new Set(activeSessionIds);
        const keysToDelete: string[] = [];

        await localforage.iterate<LocalBackup, void>((value, key) => {
            // Each key is `backup_<id>`. The session ID stored in the backup
            // data is checked first; fall back to parsing the key itself.
            const backupSessionId = value.sessionId ?? key.replace(/^backup_/, '');
            if (!activeSet.has(backupSessionId)) {
                keysToDelete.push(key);
            }
        });

        for (const key of keysToDelete) {
            await localforage.removeItem(key);
            console.log(`[LocalBackup] Removed orphaned backup: ${key}`);
        }

        if (keysToDelete.length > 0) {
            console.log(`[LocalBackup] Cleaned up ${keysToDelete.length} orphaned backup(s).`);
        }
    } catch (error) {
        console.error('[LocalBackup] Orphan cleanup failed:', error);
    }
}
