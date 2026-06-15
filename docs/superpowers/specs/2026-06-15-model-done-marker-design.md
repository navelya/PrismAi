# AI Model "Done" Marker — Design

Date: 2026-06-15

## Goal

Let admins mark an AI model as "done" (an internal bookkeeping flag — e.g. "this
model is finished/configured"). Admins can toggle it from two places and filter the
management list by it. All models default to **not done**.

## Semantics

- `is_done` is a **purely internal admin marker**. It is independent of `is_active`
  and has **no functional effect** — it does not change end-user visibility, dispatch,
  the chat brain, or any runtime behavior. It exists only for admin organization and
  filtering.

## Data layer

- Migration adds `is_done BOOLEAN NOT NULL DEFAULT false` to `public.ai_models`.
  Existing rows default to `false` (off).
- `POST /api/admin/models` and `PATCH /api/admin/models/[id]` accept and persist
  `is_done`. The PATCH route already supports partial updates, so a body of just
  `{ is_done }` works for the inline toggle.
- `lib/api/admin.ts` `listModels()` already returns full rows, so `is_done` flows
  through without change beyond confirming it is selected.

## Management list (`app/admin/page.tsx`)

- **Inline one-click toggle** per model card: a small `Switch`
  (`components/ui/Switch`) labeled "Done" in the card action/badge row. Clicking fires
  `modelsAdminApi.updateModel(id, { is_done })` optimistically, then refreshes the list.
- **New filter dropdown** beside the existing active-status `Select`:
  "All / Done / Not done", backed by a new `doneFilter` state and added to the existing
  `.filter()` chain.

## Model editor (`components/admin/ModelForm.tsx`)

- Add `is_done: initialData?.is_done ?? false` to form state.
- Add a "Done" `Switch` **at the top of the editor** (near the form header, above the
  existing sections) so it is prominent — not buried in the "Cost & Status" section.
- Include `is_done` in the submit payload.

## Non-goals

- No bulk toggle, no per-category done state — per-model only.
- No effect on visibility, dispatch, chat brain, or `is_active`.
