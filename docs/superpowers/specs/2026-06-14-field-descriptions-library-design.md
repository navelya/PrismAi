# Field Descriptions Library — Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)

## Summary

A reusable, global library of named **descriptions** (title + body) that an admin can
attach to any model **property** (control), **input handle**, or **output handle** in the
model editor. Attached descriptions surface to end users at runtime as minimal hover
tooltips on the live `ai_generator` canvas node (and in the admin live preview).

Three user decisions fixed the architecture:

1. **Live link** — fields store a *reference by id*; editing a description updates the
   tooltip on every field that uses it. One source of truth.
2. **Global scope** — one library, shared across all models. A description created while
   editing model X is selectable on model Y.
3. **Runtime surface** — tooltips render on the real canvas `ai_generator` node *and* in
   the admin `ModelForm` live preview.
4. **Delete in use** — deletion is always allowed; the confirm dialog shows how many fields
   use it, and those fields simply lose their tooltip (no cascade — lookup returns
   `undefined` → no icon/trigger).

Tooltip content shows the **body** text only (the title is the library handle used for
selection).

## Data model

### New table `field_descriptions`

```sql
create table public.field_descriptions (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.field_descriptions enable row level security;

-- Any authenticated user may READ (runtime tooltips need the text on the canvas).
create policy "field_descriptions_read" on public.field_descriptions
  for select using (auth.role() = 'authenticated');

-- Only admins may write.
create policy "field_descriptions_admin_write" on public.field_descriptions
  for all using (public.is_admin()) with check (public.is_admin());
```

> Migration file: `supabase/migrations/<timestamp>_field_descriptions.sql`. Confirm the
> existing `public.is_admin()` helper and the `auth.role()`/authenticated-read convention
> against a sibling table's policies before finalizing (see the
> "admin routes need RLS policies" note).

### Field reference (no migration — JSONB)

In [lib/nodes/types.ts](../../../lib/nodes/types.ts), add an optional reference to the three
field types. The value is the `field_descriptions.id`. These live inside the existing
`ai_models.inputs_schema` / `outputs_schema` JSONB — **no schema migration for the fields
themselves**.

```ts
export interface Control      { /* … */ description_id?: string; }
export interface InputHandle  { /* … */ description_id?: string; }
export interface OutputHandle { /* … */ description_id?: string; }

export interface FieldDescription {
  id: string;
  title: string;
  body: string;
}
```

## Client catalog (instant, no page refresh)

A new **SWR catalog** `descriptions`, loaded and persisted exactly like `models`
(persisted to localStorage, **always revalidates** — never early-returns on a non-empty
cache, per the persisted-catalog-must-be-SWR rule).

- **State** in [lib/store/slices/ui-slice.ts](../../../lib/store/slices/ui-slice.ts):
  `descriptions: FieldDescription[]`, `isDescriptionsLoading: boolean`.
- **Action** `fetchDescriptions()` following the existing `fetchModelCatalog` SWR pattern
  (cold-start loader only; background revalidate; overwrite when fresh).
- **Selector** `descriptionsById` — a memoized `Record<string, FieldDescription>` for O(1)
  lookup by id at render time.
- **Optimistic mutators** so admin changes appear with no refresh:
  `upsertDescriptionLocal(desc)` and `removeDescriptionLocal(id)`. Admin create/edit/delete
  calls these immediately, then `fetchDescriptions()` reconciles.
- **Persistence**: leave `descriptions` *out* of the `partialize` exclude list in
  [lib/store/app-store.ts](../../../lib/store/app-store.ts) so it persists like `models`.

## API routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/descriptions/list` | GET | any authenticated (session client) | return all descriptions for the runtime catalog |
| `/api/admin/descriptions` | POST | admin (session client) | create `{ title, body }`, return the new row |
| `/api/admin/descriptions/[id]` | PATCH | admin | update `{ title?, body? }`, bump `updated_at` |
| `/api/admin/descriptions/[id]` | DELETE | admin | delete the row (fields referencing it auto-detach at render) |

Admin routes use the **RLS-scoped session client** (not the service-role client), matching
the existing `/api/admin/*` convention. A thin `descriptionsAdminApi` client wrapper sits
alongside `modelsAdminApi`.

## Admin UI

### A. Per-field dropdown — `components/admin/DescriptionPicker.tsx`

Rendered once per **property row**, **input handle row**, and **output handle row** in
[components/admin/ModelForm.tsx](../../../components/admin/ModelForm.tsx).

- **Trigger**: a small chip. Shows the attached description's **title**, or a faint
  `+ description` affordance when none is attached.
- **Dropdown** (anchored popover — *not* the shared Modal; menus are deliberately out of
  Modal's scope): a search box filtering by title, the filtered title list (click to
  attach), a **＋** button beside the search, and a **Detach** option when one is attached.
- **Attach** writes `description_id` onto that field's schema object (the same patch path
  the row already uses for label/type edits). **Detach** clears it.
- **＋** opens `DescriptionFormModal` in create mode. On save, the new description is
  optimistically added to the store **and auto-selected for the field you were editing**.

> The dropdown is admin-only and needs search + a create affordance, which the existing
> `Select` primitive doesn't provide; it reuses `Select`/menu styling but is a small
> bespoke combobox. (The shared `Modal` mandate applies to the *create form*, which uses it.)

### B. Create/edit form — `components/admin/DescriptionFormModal.tsx`

Built on the shared [components/ui/Modal.tsx](../../../components/ui/Modal.tsx). Fields:
**Title** (single line) and **Description** (textarea). Used in both create mode (from the
picker's ＋ and from the Descriptions tab) and edit mode (from the Descriptions tab). On
submit it calls the admin API + optimistic store mutator.

### C. "Descriptions" tab — `components/admin/DescriptionsManager.tsx`

A new tab in the Models admin tab bar in
[app/admin/page.tsx](../../../app/admin/page.tsx) (alongside Registry / Management /
Providers / Sub Categories / Menu Builder), value e.g. `'descriptions'`.

- A searchable list of every description showing **title + body**.
- **New description** button → `DescriptionFormModal` (create).
- Per row: **Edit** → `DescriptionFormModal` (edit); **Delete** → `ConfirmationModal`.
- **Usage count**: computed client-side by scanning the loaded `models` catalog's
  `inputs_schema.controls`, `inputs_schema.handles`, and `outputs_schema.handles` for
  `description_id === row.id`. Shown in the delete confirm ("Used by N fields — they'll lose
  this tooltip.").

## Runtime behavior

Both tooltips reuse the shared [components/ui/Tooltip.tsx](../../../components/ui/Tooltip.tsx)
(Radix). It already provides the **smooth zoom-in / zoom-out** animation and **stays within
screen edges** (`collisionPadding`, automatic side-flip). It is rendered with a
description-style `popupClassName` (normal-case, wrapping, `max-w-xs`, `leading-snug`) — the
same override already used for the run-error tooltip — instead of the default uppercase
nowrap.

Text is resolved live: `descriptionsById[field.description_id]?.body`. If the id is missing
(deleted description), no icon/trigger renders.

### (1) Properties — `ai_generator` properties panel

In `ControlRenderer` within
[lib/nodes/plugins/ai_generator/properties.tsx](../../../lib/nodes/plugins/ai_generator/properties.tsx):
when a control resolves to a description, render a small minimal **ⓘ** (lucide `Info`,
circled, low-opacity) next to the control's label. Hover → `Tooltip position="bottom"`,
centered under the icon, auto-fitting within the viewport. Applies in both the live canvas
node and the admin live preview (same component).

### (2) Inputs & outputs — canvas node handle labels

In [lib/nodes/core/canvas/BaseNode.tsx](../../../lib/nodes/core/canvas/BaseNode.tsx):
**no icon**. The handle's **label text** is the hover trigger. Tooltip points *toward the
node body*:

- **Input** labels (rendered on the node's left, `right-full mr-6`) → `position="right"`.
- **Output** labels (rendered on the node's right, `left-full ml-6`) → `position="left"`.

The label divs are currently `pointer-events-none`. Enable pointer events **only on labels
that have a resolved description**, so canvas dragging/interaction is otherwise unaffected.
Thread `description_id` from the model's `inputs_schema`/`outputs_schema` into the handle
objects BaseNode consumes (the same place `label`/`isMandatory` are mapped), and resolve the
body via `descriptionsById` from the store.

## Files touched

**New**
- `supabase/migrations/<timestamp>_field_descriptions.sql`
- `app/api/descriptions/list/route.ts`
- `app/api/admin/descriptions/route.ts`
- `app/api/admin/descriptions/[id]/route.ts`
- `components/admin/DescriptionPicker.tsx`
- `components/admin/DescriptionFormModal.tsx`
- `components/admin/DescriptionsManager.tsx`
- `descriptionsAdminApi` client wrapper (alongside `modelsAdminApi`)

**Edited**
- [lib/nodes/types.ts](../../../lib/nodes/types.ts) — `description_id?` on Control/InputHandle/OutputHandle; `FieldDescription` type
- [lib/store/slices/ui-slice.ts](../../../lib/store/slices/ui-slice.ts) — `descriptions` slice, `fetchDescriptions`, `descriptionsById`, optimistic mutators
- [lib/store/app-store.ts](../../../lib/store/app-store.ts) — keep `descriptions` persisted (SWR)
- [components/admin/ModelForm.tsx](../../../components/admin/ModelForm.tsx) — `DescriptionPicker` on each property / input / output row
- [app/admin/page.tsx](../../../app/admin/page.tsx) — `'descriptions'` tab → `DescriptionsManager`
- [lib/nodes/plugins/ai_generator/properties.tsx](../../../lib/nodes/plugins/ai_generator/properties.tsx) — ⓘ + bottom tooltip on controls
- [lib/nodes/core/canvas/BaseNode.tsx](../../../lib/nodes/core/canvas/BaseNode.tsx) — hover tooltip on input/output labels (right/left); thread `description_id`
- ai_generator handle-building — thread `description_id` into BaseNode handle objects

## Constraints / things that bite

- **RLS read must include normal users** — runtime tooltips render on end-user canvas nodes,
  not just admin. SELECT policy is authenticated-wide; writes are admin-only.
- **Catalog must stay SWR** — never early-return on a non-empty `descriptions` cache, or new
  descriptions become permanently invisible after the first load (persisted-catalog rule).
- **Pointer events on handle labels** — enable only when a description exists, to avoid
  blocking canvas drag/interaction.
- **No `description_id` migration** — the references live in existing JSONB; only the
  `field_descriptions` table is a new migration. Apply that migration before deploy.
- **Live link, not snapshot** — never copy body text onto the field; always resolve through
  `descriptionsById` so edits propagate.

## Out of scope (YAGNI)

- Per-model description scoping (chose global).
- Snapshot/versioning of descriptions.
- Descriptions on node types other than `ai_generator` properties/handles.
- Rich text / markdown in the body (plain text tooltip).
- Title shown inside the tooltip (body only; revisit if desired).
