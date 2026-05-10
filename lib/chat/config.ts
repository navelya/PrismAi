/**
 * Tunable constants for the chat brain and approve/apply loop.
 * Kept in one place so they can be adjusted without grepping the codebase.
 */

/** Pause between sequential task applications, in milliseconds. */
export const STAGING_DELAY_MS = 600;

/** Padding around children when synthesizing a group_container. */
export const GROUP_PADDING_X = 24;
export const GROUP_PADDING_Y_TOP = 56;     // header
export const GROUP_PADDING_Y_BOTTOM = 24;
