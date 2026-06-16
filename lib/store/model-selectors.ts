/**
 * Shared model display selectors.
 *
 * `selectVisibleModels` returns the models to show in USER-FACING pickers/menus:
 * one row per variant group — the primary. Variants (`is_primary === false`) are
 * hidden from humans but MUST stay in the store, because the client cost estimate
 * resolves a brain-wired variant by `model_id` via `buildModelsMap(store.models)`.
 * NEVER feed this filtered list into the cost map, or hidden variants become
 * unresolvable and the estimate drifts from the server debit.
 *
 * Pre-migration cached rows have no `is_primary` field → treated as primary
 * (`!== false`), so the catalog never silently empties after a deploy.
 */
export function selectVisibleModels<T extends { is_primary?: boolean }>(models: T[]): T[] {
    return models.filter(m => m.is_primary !== false);
}
