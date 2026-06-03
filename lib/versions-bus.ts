/**
 * Tiny pub/sub so workflow-version mutations from one place (e.g. the toolbar
 * "Save checkpoint" button) refresh the version list shown elsewhere (e.g. an
 * already-open History panel). Deliberately a standalone module rather than
 * store state — it's a transient signal with no value to persist, and keeping
 * it out of the Zustand store avoids re-render churn on subscribers that only
 * care about "something changed", not about what.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe to version-list changes. Returns an unsubscribe fn. */
export function onVersionsChanged(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Notify all subscribers that the version list for the active canvas changed. */
export function emitVersionsChanged(): void {
    listeners.forEach((l) => {
        try {
            l();
        } catch {
            // A bad subscriber must not break the others.
        }
    });
}
