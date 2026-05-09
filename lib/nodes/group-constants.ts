/**
 * Shared constants for group node geometry. Imported by the slice (for
 * sizing math) and by the GroupNode component (for layout). Keep these
 * in lockstep — drift between the two would cause snap-back on first drag.
 */
export const GROUP_PADDING = 24;
export const GROUP_TITLE_BAR_HEIGHT = 40;
export const GROUP_RESIZE_HANDLE_SIZE = 8;
export const GROUP_DEFAULT_LABEL = 'Group';
export const GROUP_Z_INDEX = -1;
