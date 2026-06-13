/**
 * The workflow title and the session/history title are mirrors of one value.
 * These placeholder names mean "no real title yet" — they must never override a
 * generated title, and a generated title may freely replace them.
 *
 * Shared by the client (adoption guard in use-chat-messages) and the server
 * (manual-name detection in /api/session/generate-title) so both agree on what
 * counts as "unset".
 */
const DEFAULT_TITLES = new Set(['', 'untitled workflow', 'new workflow', 'new session']);

/** True when `name` is empty or one of the default placeholders. */
export function isDefaultWorkflowTitle(name: string | null | undefined): boolean {
    return DEFAULT_TITLES.has((name || '').trim().toLowerCase());
}
