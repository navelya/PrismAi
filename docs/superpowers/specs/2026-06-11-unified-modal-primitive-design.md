# Unified Modal Primitive + UI Reuse Policy — Design

**Date:** 2026-06-11
**Status:** Approved (design), pending implementation plan

## Problem

Popup windows across the app — modals, dialogs, confirmations, info/message
popups, wizards — are each implemented independently. There is **no shared base
modal component**. ~15 popups split across two patterns (direct Radix Dialog, and
hand-rolled portal + Framer Motion), and they have drifted into divergent styling:

- **Backdrop opacity** varies: `bg-black/60`, `/70`, `/80`
- **Backdrop blur** varies: `backdrop-blur-sm`, `-md`
- **Panel surface** varies: glass (`bg-bg-primary/80 backdrop-blur-2xl`) vs solid
  (`bg-surface-primary` / `bg-surface-elevated`, no blur)
- **Radius** varies: `rounded-2xl` vs `rounded-3xl`
- **Shadow** varies: `shadow-premium` vs `shadow-2xl`
- **Border** varies: `border-white/10` vs `border-stroke-subtle`
- **Close button** varies: circular `rounded-full` vs `rounded-xl`
- **Animation** varies: Radix `data-[state]` CSS vs Framer spring
- **Z-index** is a fragmented ladder: `z-50`, `z-[60]`, `z-[80]`, `z-[9998]`, `z-[9999]`

Separately, future AI-assisted work keeps re-creating one-off overlays instead of
reusing shared components, which is how the drift happened. We want the AI to
prefer shared/custom components first.

## Goals

1. One canonical popup **look and motion**, owned by a single primitive.
2. Migrate all existing modal/dialog popups onto it.
3. Persist an instruction so future work reuses shared components first and only
   builds bespoke one-offs as a last resort.

## Decisions (locked with user)

- **House style:** Glass (translucent blurred panel).
- **Scope:** Foundation **+ migrate all** ~15 modal/dialog popups, in reviewable
  batches.
- **Coverage:** Modals / dialogs only. Toasts, popovers/menus, and the mobile
  action sheet are explicitly **out of scope** for this pass (they can adopt the
  same pattern later).
- **Animation:** A single Framer Motion spring, **baked into the base** — uniform
  motion for every popup.

## Architecture

### The primitive — `components/ui/Modal.tsx`

Built on **Radix Dialog** (`Root`/`Portal`/`Overlay`/`Content`) for free
accessibility: focus-trap, ESC handling, scroll-lock, ARIA wiring. **Framer
Motion** (already a dependency) drives the single canonical open/close animation
via `AnimatePresence` + Radix `forceMount`, so the exit spring runs on close.

Compound-component API:

```tsx
<Modal open={open} onOpenChange={setOpen} size="md">
  <Modal.Header>
    <Modal.Title>Rename checkpoint</Modal.Title>
    <Modal.Description>Optional subtext</Modal.Description>
  </Modal.Header>
  <Modal.Body> …content… </Modal.Body>
  <Modal.Footer>
    <Button variant="ghost">Cancel</Button>
    <Button>Save</Button>
  </Modal.Footer>
</Modal>
```

**Baked-in house style (not overridable):**

- Backdrop: `bg-black/60 backdrop-blur-sm`
- Panel: `bg-bg-primary/80 backdrop-blur-2xl rounded-2xl shadow-premium border border-white/10`
- Close button: circular, positioned `top-4 right-4` (toggle via `showClose`)
- Motion: spring `{ opacity: 0→1, scale: 0.95→1, y: 20→0 }` (the current PlansModal feel)

**Props:**

| Prop | Type | Default | Purpose |
|------|------|---------|---------|
| `open` / `onOpenChange` | controlled | — | Radix-style control |
| `size` | `sm \| md \| lg \| xl \| full` | `md` | maps to a max-width token |
| `showClose` | `boolean` | `true` | render the built-in close button |
| `dismissable` | `boolean` | `true` | maps to Radix `onInteractOutside` / `onEscapeKeyDown` |
| `level` | `base \| elevated \| top` | `base` | centralized z-scale: `z-[100] / z-[110] / z-[120]` |
| `modal` | `boolean` | `true` | Radix `modal` passthrough (for non-modal stacking cases) |
| `contentClassName` | `string` | — | **narrow** escape hatch for sizing only — not for restyling the surface |

`Modal.Title` is **required** for accessibility. A `hideTitle` option uses Radix
`VisuallyHidden` for cases where no visible title is desired.

The `level` prop replaces the ad-hoc `z-50 … z-[9999]` values with a documented
3-tier scale.

### `ConfirmationModal` becomes a thin preset

Rewritten as a small wrapper over `<Modal>`, **keeping its current public props**
(`variant: danger | warning | info`, title/body, confirm/cancel labels and
callbacks) so existing call sites do not change.

## Migration

Refactor every modal/dialog popup onto `Modal` / `ConfirmationModal`. The
hand-rolled Framer portals drop their bespoke portal + overlay + outer motion and
use `Modal`; their **internal** step/content animations are preserved.

Done in reviewable batches:

- **Batch A — foundation:** build `Modal.tsx`; rewrite `ConfirmationModal` over it.
- **Batch B — standard Radix dialogs:** `ImageModal`, `TableModal`,
  `SaveCheckpointModal`, `AdjustTokensModal`, `ShareDialog`, `UserDetailDrawer`,
  `AccountModal` (preserving its `modal={false}` + nested-stacking behavior via
  `modal` passthrough and `level`).
- **Batch C — Framer premium modals:** `PlansModal`, `BillingProcessingModal`,
  `CancelConfirmModal`, `CharacterModal`, `TemplatesModal` — drop the outer
  portal/overlay/motion, keep inner content animation.

**Out of scope (this pass):** `Toast`, `ChatPlusMenu`, `ChatPreferencesMenu`,
`CanvasContextMenu`, `MobileActionSheet`, `ImageLightbox`, `Tooltip`.

## AI reuse policy (CLAUDE.md)

Add a **"UI components — reuse first"** section to `CLAUDE.md` (loaded every
session, so it governs future work):

> Before building any UI, check `components/ui/` for a primitive that fits. For
> **any** overlay/popup (modal, dialog, confirm, info, wizard) use
> `components/ui/Modal.tsx` (or `ConfirmationModal` for confirms) — never
> hand-roll a Radix Dialog or a portal+motion overlay; that is how we drifted into
> 15 divergent popup styles. If a piece of UI will be shared across the app, build
> it as a shared component in `components/ui/` rather than inline. A bespoke
> one-off component is a last resort — and never duplicate an existing primitive's
> styling.

## Risks / notes

- **Radix + Framer exit animation:** requires `forceMount` on `Portal`/`Overlay`/
  `Content` plus `AnimatePresence`, so the spring runs on close. Solved once in
  the primitive.
- **`AccountModal` is `modal={false}`** (non-modal so nested billing modals work).
  `Modal` exposes the `modal` passthrough and the `level` z-scale to preserve this
  stacking.
- **Stacked modals** (billing flow opens over plans over account) rely on the
  `level` tiers being respected; verify the billing stack during Batch C.

## Verification

- `npx tsc --noEmit` (repo note: `npm run lint` / `next build` are unreliable here).
- Visual pass on each migrated popup: open/close motion, backdrop, escape /
  click-outside, and the nested billing stack.
