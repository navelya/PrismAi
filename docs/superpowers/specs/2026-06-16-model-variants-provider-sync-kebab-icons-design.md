# Model variants + provider menu-sync + kebab lucide icons

**Date:** 2026-06-16
**Status:** Approved — ready for implementation

Three independent admin-side features. They share the admin model-management surface but are otherwise decoupled and can be built in any order.

---

## Feature 1 — Model variants

### Problem
An admin wants several *views* of the same model identity — same name, different settings
(default control values, a different sub-category `node_type_id`, possibly a different
provider binding). Only ONE view (the "primary"/"main") should appear in user-facing model
lists; the rest are hidden but fully usable by the engine and visible to the chat brain via
their sub-category. Any view can be promoted to main with one click; deleting the main
promotes a sibling rather than destroying the group.

### Decision — symmetric group + flag (panel-unanimous; NOT a parent FK)
A variant group is a *set of peer rows that elect one representative*, not a hierarchy. Two
new columns on `ai_models`:

- `variant_group_id uuid NOT NULL DEFAULT gen_random_uuid()` — shared identity.
- `is_primary boolean NOT NULL DEFAULT true` — which row shows in user lists / is "main".
- partial unique index `(variant_group_id) WHERE is_primary` — the DB guarantees exactly one
  main per group.

The column defaults make every existing row, and every newly-created plain model, its own
singleton group that is already primary — **zero backfill, zero ceremony**. A "variant" is
just another `ai_models` row sharing a `variant_group_id` with `is_primary = false`.

### The make-or-break rule: filter at display, never at the data/cost layer
The client cost estimate builds its model map from the full `store.models`
(`buildModelsMap`), and every server cost/dispatch path resolves models by raw `id` with no
visibility filter (verified: `app/api/executions/start/route.ts` ~L474 `.in('id', …)`,
`resolve-provider.ts`, `orchestrator.ts`, `output-type.ts`, `run-details.ts`). Therefore:

- `/api/models/list` keeps returning **all** active rows (incl. variants) so every
  brain-wired `model_id` stays resolvable on the client → no `COST_DRIFT`.
- The "primary-only" rule is applied **only at user-facing render sites**, via one shared
  selector, and **never** when building the cost map.

### Data
- Migration `supabase/migrations/20260616_add_model_variants.sql`: the two columns + the
  partial unique index + a plain `(variant_group_id)` lookup index. `gen_random_uuid()` is
  available on Supabase Postgres.
- `AiModel` type ([lib/nodes/types.ts](../../../lib/nodes/types.ts)) gains
  `variant_group_id: string` and `is_primary: boolean` (additive).

### Display filter — one shared selector
Add `selectVisibleModels(models)` (a pure helper, e.g. in
[lib/billing/cost.ts](../../../lib/billing/cost.ts) is wrong — put it in a UI util such as
`lib/store/selectors.ts` or alongside the store) returning one row per group: keep
`m.is_primary !== false` (treat `undefined` as primary so pre-migration cached store data
still renders). Apply it at these enumerated leak sites — and nowhere near `buildModelsMap`:

- [lib/nodes/plugins/ai_generator/properties.tsx](../../../lib/nodes/plugins/ai_generator/properties.tsx#L98) — the `filteredModels` source (and thus the default-select at ~L104).
- [components/editor/NodeLibraryPanel.tsx](../../../components/editor/NodeLibraryPanel.tsx#L194) — search `modelHits` (L194) and the provider flyout `items` (L219).
- [app/api/marketing/models/route.ts](../../../app/api/marketing/models/route.ts) — add `.eq('is_primary', true)` (public marketing list; safe to filter at source — not a cost path).
- [components/admin/ContextMenuBuilder.tsx](../../../components/admin/ContextMenuBuilder.tsx#L365) — `refreshProviderModels` must add only primaries to the menu (ties into Feature 2).

The admin Registry list ([app/admin/page.tsx](../../../app/admin/page.tsx#L898)) is handled
separately (it groups + nests, see below), not via the plain selector.

### Admin management UI ([app/admin/page.tsx](../../../app/admin/page.tsx))
- Top-level model grid shows **primaries only**, grouped by `variant_group_id`.
- Each primary card gains:
  - **Create variant** — clones the row (full `inputs_schema`, bindings, control defaults,
    `credit_cost`, etc.) into the same `variant_group_id` with `is_primary = false`, same
    `display_name`, then opens it in `ModelForm` to edit.
  - an expandable **Variants (N)** section listing the group's non-primary rows, each with
    **Edit** (opens ModelForm), **Make main** (promote), **Delete**.
- `ModelForm` accepts/preserves `variant_group_id` and `is_primary` on create/save.

### API routes (all call `invalidateRegistryCache()`)
- Create ([app/api/admin/models/route.ts](../../../app/api/admin/models/route.ts)): accept
  optional `variant_group_id` + `is_primary`; default group to a new uuid (DB default) and
  `is_primary` true when omitted.
- Promote — new `POST /api/admin/models/[id]/promote`: in one transaction, demote the
  group's current primary and set this row primary
  (`UPDATE ai_models SET is_primary = (id = $target) WHERE variant_group_id = $g`, single
  statement, evaluated against the partial index → never a transient two-primary state).
- Delete ([app/api/admin/models/[id]/route.ts](../../../app/api/admin/models/[id]/route.ts)):
  if deleting a primary that has siblings, delete it then promote a deterministic survivor
  (`ORDER BY is_active DESC, id ASC LIMIT 1`) in the same transaction. Non-primary delete =
  plain delete. Last-in-group delete = plain delete (group ceases).
  - These multi-statement transactions need the service-role/RPC path or a Postgres function;
    if a single round-trip transaction isn't ergonomic via the JS client, add a small
    `promote_model_variant(target_id)` / `delete_model_and_reseat_primary(target_id)` SQL
    function in the migration and call it via `.rpc()`. (Admin routes use the RLS-scoped
    session client + `is_admin()` policies — keep that; the SQL function runs with the
    caller's rights.)

### Brain — no change
`lib/chat/registry-cache.ts` selects `is_active` rows grouped by `node_type_id`; variants are
`is_active` so they appear automatically under their sub-category. The brain selects by
numeric `model_id`, so same-named rows in different sub-categories are unambiguous.

### Edge cases
- Promote a row already primary → no-op (single-statement form handles it).
- Delete a non-primary → no reseat.
- Concurrency: row locks + the partial unique index serialize concurrent promotes/deletes;
  worst case is last-writer-wins on *which* row is primary — never two primaries. The
  delete+promote transaction prevents a zero-primary group; the selector's
  `!== false` default is defensive cover.

---

## Feature 2 — "Sync all providers" button (menu builder)

### Problem
In the menu builder, adding each provider and syncing its models is per-provider and manual.
Want one top button that (a) adds any provider not yet in the menu and (b) refreshes every
provider's model list (new and existing).

### Decision
Reuse the existing per-provider `refreshProviderModels()`
([components/admin/ContextMenuBuilder.tsx](../../../components/admin/ContextMenuBuilder.tsx#L358))
— it syncs a provider's already-registered DB models into the menu tree (no external API).

- Add one **Sync all providers** button to the menu builder's top toolbar.
- On click, for each provider in the providers list: if no `provider` menu item exists for it
  (`item_type === 'provider' && action_value === provider.id`), create one at root
  (`createContextMenuItem`); then call `refreshProviderModels()` for **every** provider item
  (new + existing). Reload the tree once at the end. Disable + spinner while running.
- `refreshProviderModels` filters its provider models to **primaries** (Feature 1), so
  variants never enter the menu.

The component must have the providers list available (load it the same way it loads models if
not already present).

---

## Feature 3 — Lucide kebab icon names (`pen-line`)

### Problem
Admins copy lucide icon names in kebab-case (`pen-line`) but the menu builder requires the
`PenLineIcon` form. A normalizer `parseIconName()`
([lib/utils/schema-parser.ts](../../../lib/utils/schema-parser.ts)) already converts
kebab → `PascalCase`+`Icon` and is applied when saving **sub-categories** (node_types) at
[app/admin/page.tsx](../../../app/admin/page.tsx#L681). lucide-react exports the `…Icon` alias
for every icon, so the normalized name always resolves. Gaps: the **menu builder** stores and
previews the raw string; the sub-category **live preview** doesn't normalize while typing.

### Decision
- Menu builder ([ContextMenuBuilder.tsx](../../../components/admin/ContextMenuBuilder.tsx)):
  apply `parseIconName()` when saving the item `icon`, and wrap the live icon preview
  (~L444) in `parseIconName()` so the typed `pen-line` previews instantly.
- Sub-category form ([app/admin/page.tsx](../../../app/admin/page.tsx)): wrap the live icon
  preview (~L1403/the form preview at ~L1296) in `parseIconName()` (save already normalizes).
- Both keep accepting the existing `PenLineIcon` form (`parseIconName` returns names already
  containing `Icon` unchanged). Render sites read the canonical stored value — unchanged.

---

## Verification
- `npx tsc --noEmit` clean (lint/build are unreliable here).
- Manual (post-migration):
  - **Variants:** create a variant of a model, give it a different sub-category, save →
    user model picker still shows only the primary; the brain catalog (and a node wired to the
    variant) runs and bills correctly; promote the variant → it becomes the shown one; delete
    the main → a sibling becomes main.
  - **Sync all:** click the top button → missing providers get menu items and every
    provider's primary models populate.
  - **Icons:** type `pen-line` in both the sub-category and a menu item → previews and
    persists as the correct lucide glyph.

## Out of scope (YAGNI)
- No external provider-API model discovery (Feature 2 syncs DB rows only).
- No multi-sub-category-per-model (replaced by variants).
- No variant nesting beyond one logical group (a variant of a variant joins the same group).
- `computeModelMenuCost` and per-model cost UI unchanged.
