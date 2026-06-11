# Unified Modal Primitive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ~15 divergently-styled popup implementations with one shared, glass-styled, Framer-animated `<Modal>` primitive, and add a CLAUDE.md policy so future UI reuses shared components first.

**Architecture:** A single `components/ui/Modal.tsx` built on Radix Dialog (focus-trap, ESC, scroll-lock, ARIA) with one canonical Framer Motion spring driven by `AnimatePresence` + `forceMount`. Compound parts (`Modal.Header/Title/Description/Body/Footer`) supply spacing; the panel owns the glass surface and a built-in close button. `ConfirmationModal` becomes a thin preset over it. Every existing modal/dialog migrates onto it.

**Tech Stack:** Next.js (client components), React, TypeScript, Tailwind, `@radix-ui/react-dialog` ^1.1.15, `@radix-ui/react-visually-hidden` ^1.2.4, `framer-motion` ^12, `cn()` from `lib/utils.ts`.

**Verification note:** This repo has no test runner. Per repo convention `npm run lint` / `next build` are unreliable; verify every task with `npx tsc --noEmit` (expected: clean, no new errors) plus a visual pass when running the app.

---

## File Structure

- **Create** `components/ui/Modal.tsx` — the primitive + compound parts + a shared z-index scale.
- **Rewrite** `components/ui/ConfirmationModal.tsx` — thin preset over `Modal`, same public props.
- **Migrate (standard Radix dialogs)**: `components/editor/SaveCheckpointModal.tsx`, `components/ui/TableModal.tsx`, `components/ui/ImageModal.tsx`, `components/admin/AdjustTokensModal.tsx`, `components/collab/ShareDialog.tsx`, `components/admin/UserDetailDrawer.tsx`, `components/ui/MobileActionSheet.tsx`, `components/account/AccountModal.tsx`.
- **Migrate (Framer portals)**: `components/billing/BillingProcessingModal.tsx`, `components/billing/CancelConfirmModal.tsx`, `components/billing/PlansModal.tsx`, `components/assets/CharacterModal.tsx`, `components/editor/TemplatesModal.tsx`.
- **Edit** `CLAUDE.md` — add "UI components — reuse first" section.
- **Out of scope:** `Toast.tsx`, `ChatPlusMenu.tsx`, `ChatPreferencesMenu.tsx`, `CanvasContextMenu.tsx`, `ImageLightbox.tsx`, `Tooltip.tsx`.

Public API contract (used by every later task — names are fixed here):

```tsx
<Modal open onOpenChange size="sm|md|lg|xl|full" level="base|elevated|top"
       showClose dismissable modal contentClassName>
  <Modal.Header><Modal.Title/><Modal.Description/></Modal.Header>
  <Modal.Body/>
  <Modal.Footer/>
</Modal>
```
- `size` → max-width: sm=`max-w-sm`, md=`max-w-md`, lg=`max-w-2xl`, xl=`max-w-4xl`, full=`max-w-6xl`.
- `level` → z-index: base=`z-[100]`, elevated=`z-[110]`, top=`z-[120]`.
- `showClose` (default true), `dismissable` (default true; false ⇒ block ESC + outside-click), `modal` (default true; Radix passthrough for non-modal stacking), `contentClassName` (sizing/layout escape hatch only).

---

## Task 1: Build the `Modal` primitive

**Files:**
- Create: `components/ui/Modal.tsx`

- [ ] **Step 1: Write the full primitive**

```tsx
'use client';

import React, { createContext, useContext } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';
export type ModalLevel = 'base' | 'elevated' | 'top';

const SIZE_MAX_WIDTH: Record<ModalSize, string> = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-6xl',
};

// Single source of truth for popup stacking — replaces the old ad-hoc
// z-50 … z-[9999] ladder. base = ordinary modal; elevated = a modal that
// opens over another (e.g. billing over plans); top = always-on-top status.
const LEVEL_Z: Record<ModalLevel, string> = {
    base: 'z-[100]',
    elevated: 'z-[110]',
    top: 'z-[120]',
};

interface ModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: React.ReactNode;
    size?: ModalSize;
    level?: ModalLevel;
    /** Show the built-in top-right close button. Default true. */
    showClose?: boolean;
    /** Allow ESC / outside-click to close. Default true. */
    dismissable?: boolean;
    /** Radix `modal` passthrough — set false for non-modal stacking. Default true. */
    modal?: boolean;
    /** Sizing/layout escape hatch for the panel (e.g. max-w / max-h / flex). */
    contentClassName?: string;
    /** Accessible name when no visible <Modal.Title> is rendered. */
    srTitle?: string;
}

// Lets compound parts (Header close affordance etc.) reach the close handler
// if ever needed; primarily future-proofing.
const ModalContext = createContext<{ onOpenChange: (o: boolean) => void } | null>(null);

function ModalRoot({
    open,
    onOpenChange,
    children,
    size = 'md',
    level = 'base',
    showClose = true,
    dismissable = true,
    modal = true,
    contentClassName,
    srTitle,
}: ModalProps) {
    const z = LEVEL_Z[level];
    return (
        <ModalContext.Provider value={{ onOpenChange }}>
            <RadixDialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
                <AnimatePresence>
                    {open && (
                        <RadixDialog.Portal forceMount>
                            <RadixDialog.Overlay asChild forceMount>
                                <motion.div
                                    className={cn('fixed inset-0 bg-black/60 backdrop-blur-sm', z)}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.15 }}
                                />
                            </RadixDialog.Overlay>

                            {/* Centering layer. pointer-events-none so clicks on
                                empty space fall through to the overlay; Radix
                                still detects pointer-down-outside on Content. */}
                            <div className={cn('fixed inset-0 flex items-center justify-center p-4 overflow-y-auto pointer-events-none', z)}>
                                <RadixDialog.Content
                                    asChild
                                    forceMount
                                    onEscapeKeyDown={(e) => { if (!dismissable) e.preventDefault(); }}
                                    onPointerDownOutside={(e) => { if (!dismissable) e.preventDefault(); }}
                                    onInteractOutside={(e) => { if (!dismissable) e.preventDefault(); }}
                                >
                                    <motion.div
                                        className={cn(
                                            'pointer-events-auto relative w-full my-auto bg-bg-primary/80 backdrop-blur-2xl rounded-2xl shadow-premium border border-white/10',
                                            SIZE_MAX_WIDTH[size],
                                            contentClassName,
                                        )}
                                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                                        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                                    >
                                        {srTitle && (
                                            <VisuallyHidden.Root asChild>
                                                <RadixDialog.Title>{srTitle}</RadixDialog.Title>
                                            </VisuallyHidden.Root>
                                        )}
                                        {showClose && (
                                            <RadixDialog.Close asChild>
                                                <button
                                                    className="absolute top-4 right-4 z-10 p-2 text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary rounded-full transition-colors"
                                                    aria-label="Close"
                                                >
                                                    <X className="w-5 h-5" />
                                                </button>
                                            </RadixDialog.Close>
                                        )}
                                        {children}
                                    </motion.div>
                                </RadixDialog.Content>
                            </div>
                        </RadixDialog.Portal>
                    )}
                </AnimatePresence>
            </RadixDialog.Root>
        </ModalContext.Provider>
    );
}

function ModalHeader({ className, children }: { className?: string; children: React.ReactNode }) {
    return <div className={cn('flex flex-col gap-1.5 px-8 pt-8 pr-12', className)}>{children}</div>;
}

function ModalTitle({ className, children, asChild }: { className?: string; children: React.ReactNode; asChild?: boolean }) {
    return (
        <RadixDialog.Title asChild={asChild} className={cn('text-lg font-bold text-content-primary', className)}>
            {children}
        </RadixDialog.Title>
    );
}

function ModalDescription({ className, children }: { className?: string; children: React.ReactNode }) {
    return (
        <RadixDialog.Description className={cn('text-content-secondary leading-relaxed', className)}>
            {children}
        </RadixDialog.Description>
    );
}

function ModalBody({ className, children }: { className?: string; children: React.ReactNode }) {
    return <div className={cn('px-8 py-6', className)}>{children}</div>;
}

function ModalFooter({ className, children }: { className?: string; children: React.ReactNode }) {
    return <div className={cn('flex items-center justify-end gap-3 px-8 pb-8 pt-2', className)}>{children}</div>;
}

export const Modal = Object.assign(ModalRoot, {
    Header: ModalHeader,
    Title: ModalTitle,
    Description: ModalDescription,
    Body: ModalBody,
    Footer: ModalFooter,
});

export { useModalContext };
function useModalContext() {
    return useContext(ModalContext);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `components/ui/Modal.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/ui/Modal.tsx
git commit -m "feat(ui): add unified glass Modal primitive"
```

---

## Task 2: Rewrite `ConfirmationModal` over `Modal`

**Files:**
- Modify: `components/ui/ConfirmationModal.tsx` (full rewrite, same props)

- [ ] **Step 1: Replace the file body** — keep the exact public interface (`isOpen`, `onClose`, `onConfirm`, `title`, `message`, `confirmText`, `cancelText`, `variant`). Render the icon + title in `Modal.Header`, message in `Modal.Body`, buttons in `Modal.Footer`:

```tsx
'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    variant?: 'danger' | 'warning' | 'info';
}

export function ConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'danger',
}: ConfirmationModalProps) {
    const iconWrap =
        variant === 'danger'
            ? 'bg-accent-error/10 text-accent-error border-accent-error/20 shadow-[0_0_15px_rgba(239,68,68,0.1)]'
            : variant === 'warning'
                ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20 shadow-[0_0_15px_rgba(234,179,8,0.1)]'
                : 'bg-accent-primary/10 text-accent-primary border-accent-primary/20 shadow-[0_0_15px_rgba(6,182,212,0.1)]';
    const confirmBtn =
        variant === 'danger'
            ? 'bg-accent-error shadow-accent-error/20'
            : variant === 'warning'
                ? 'bg-yellow-600 shadow-yellow-600/20'
                : 'bg-accent-primary shadow-accent-primary/20';

    return (
        <Modal open={isOpen} onOpenChange={(o) => !o && onClose()} size="md">
            <Modal.Header>
                <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 border ${iconWrap}`}>
                        <AlertTriangle className="w-6 h-6" />
                    </div>
                    <Modal.Title>{title}</Modal.Title>
                </div>
            </Modal.Header>
            <Modal.Body className="pt-2">
                <Modal.Description>{message}</Modal.Description>
            </Modal.Body>
            <Modal.Footer>
                <button
                    onClick={onClose}
                    className="px-4 py-2 text-sm font-medium text-content-secondary hover:text-content-primary hover:bg-surface-tertiary rounded-lg transition-colors"
                >
                    {cancelText}
                </button>
                <button
                    onClick={() => { onConfirm(); onClose(); }}
                    className={`px-5 py-2.5 text-xs font-black uppercase tracking-widest text-white rounded-lg shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all ${confirmBtn}`}
                >
                    {confirmText}
                </button>
            </Modal.Footer>
        </Modal>
    );
}
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit` (clean). Confirm no call site passed props we dropped (none — interface unchanged).
- [ ] **Step 3: Commit** — `git commit -am "refactor(ui): ConfirmationModal over Modal primitive"`

---

## Task 3: Migrate the standard Radix dialogs

For each file below: replace the `RadixDialog.Root/Portal/Overlay/Content` shell with `<Modal …>`, drop the hand-written backdrop/panel/animation/close-button classes, and move the existing inner markup into `Modal.Header/Body/Footer` (or pass as raw children for table/grid layouts, using `contentClassName` for sizing). Preserve every behavior: controlled open mapping, `onOpenAutoFocus`, submit/disable logic, `dismissable` where the original blocked close during submit.

- [ ] **3a `SaveCheckpointModal.tsx`** — `size="md"`. Header = Save icon + "Save checkpoint" `Modal.Title` + `Modal.Description`. Body = the `<input>` + inline error. Footer = Cancel + Save buttons (keep submit/disabled/`Loader2` logic). Keep the `onOpenAutoFocus` select-text behavior by passing it through — add an optional `onOpenAutoFocus` passthrough to `Modal` if needed, OR keep focus via a `useEffect` on `open`. Set `dismissable={!submitting}` and `showClose` close button `disabled` is no longer separately controllable, so instead set `dismissable={!submitting}` (blocks ESC/outside while saving) and keep the footer Cancel disabled during submit.
- [ ] **3b `TableModal.tsx`** — `size="full"`, `contentClassName="max-w-7xl max-h-[90vh] flex flex-col overflow-hidden"`, `showClose={false}` (it has its own header close + footer Close). Children = existing header bar (`Modal.Title` for the heading), scroll body, footer bar. Keep `RadixDialog.Close` → use `onOpenChange(false)` via the close buttons (`onClick={onClose}`).
- [ ] **3c `ImageModal.tsx`** — full-screen image preview. `size="full"`, `contentClassName` to taste, `srTitle="Image preview"` (no visible title), keep nav arrows + the dark circular close (`showClose={false}`, keep its own). Preserve keyboard nav.
- [ ] **3d `AdjustTokensModal.tsx`** — `size="md"`, Header/Body/Footer split mirroring its form. Preserve submit logic.
- [ ] **3e `ShareDialog.tsx`** — `size="lg"` (it already used the glass classes, so visual parity). Header/Body/Footer split.
- [ ] **3f `UserDetailDrawer.tsx`** — `size="xl"` (admin detail). Keep its sections; it also renders a `ConfirmationModal` inside — that nested one should use `level="elevated"` (pass through ConfirmationModal? No — ConfirmationModal has no level prop). Leave nested ConfirmationModal at default `base`; if it renders behind, add a `level` prop to ConfirmationModal in a follow-up. Note inline.
- [ ] **3g `MobileActionSheet.tsx`** — this is a bottom sheet, not centered. Keep it OUT of the centered `Modal` for now (its layout differs) — but unify its backdrop/z to the new scale: replace `z-[60]` with the `LEVEL_Z` equivalent by importing nothing; simplest: leave as-is and note it's a sheet variant for a later pass. **Skip migration; add a TODO comment** pointing at `Modal` for a future Sheet variant.
- [ ] **3h `AccountModal.tsx`** — `modal={false}` (preserve non-modal so nested billing modals interact), `level="base"`, `size="full"` with `contentClassName` for its sidebar layout + height. Nested modals it spawns (PlansModal etc.) use `level="elevated"`.

After each sub-file: `npx tsc --noEmit` (clean). Commit per file: `git commit -am "refactor(ui): migrate <File> to Modal"`.

---

## Task 4: Migrate the Framer-portal modals

These currently hand-roll `createPortal` + overlay + `motion.div`. Replace the outer portal/overlay/wrapper with `<Modal …>`; **keep all inner content and inner animations**. Remove now-redundant inner card classes (`bg-surface-elevated border rounded-3xl shadow-2xl`) since the panel provides the glass surface. Remove the manual ESC `useEffect` and `createPortal`/`mounted` guard (Radix handles both).

- [ ] **4a `BillingProcessingModal.tsx`** — `level="top"` (must sit above plans), `size="md"`, `dismissable` per its current behavior (processing usually blocks close). Map its `status` null → `open={false}`.
- [ ] **4b `CancelConfirmModal.tsx`** — `level="elevated"`, `size="md"`. Map `open`/`onClose`/`loading`. Block dismiss while `loading` (`dismissable={!loading}`).
- [ ] **4c `PlansModal.tsx`** — `level="elevated"` (opens over AccountModal), `size="full"`, `contentClassName="max-w-6xl"`. Replace the `<h2>Choose your plan</h2>` with `<Modal.Title>` (keep its classes via `className`). Keep the decorative gradient, cycle toggle, plan grid, packs, footer as children. Drop the outer `motion.div`s, `createPortal`, `mounted`, ESC effect, and the manual close button (use built-in `showClose`, or keep its custom one with `showClose={false}` — prefer built-in). Nested `BillingProcessingModal`/`CancelConfirmModal` already render via their own `Modal` (4a/4b) so stacking is handled by `level`.
- [ ] **4d `CharacterModal.tsx`** — multi-step wizard. `size="full"` (or `xl`) + `contentClassName` for its height/scroll. Keep ALL internal step state + step transition animations; only the outer shell changes. `dismissable` should match current (likely block during in-flight generation).
- [ ] **4e `TemplatesModal.tsx`** — `size="full"`, keep search + gallery + load-confirm. Replace outer Framer shell.

After each: `npx tsc --noEmit` (clean). Commit per file.

---

## Task 5: Add the CLAUDE.md reuse policy

**Files:**
- Modify: `CLAUDE.md` (add a section near "Things that bite")

- [ ] **Step 1: Insert this section**

```markdown
## UI components — reuse first

Before building any UI, check `components/ui/` for a primitive that fits and use it. For **any** overlay/popup — modal, dialog, confirmation, info/message, wizard — use [components/ui/Modal.tsx](components/ui/Modal.tsx) (or `ConfirmationModal` for confirms). **Never** hand-roll a Radix Dialog shell or a `createPortal` + overlay + `motion.div` popup; that is exactly how the app drifted into ~15 divergent popup styles (backdrops `black/60…/80`, radii `2xl/3xl`, a `z-50…z-[9999]` ladder). The `Modal` primitive owns the house glass style, the spring animation, the close button, and the `level` z-scale.

When a piece of UI will be shared across the app, build it as a shared component in `components/ui/` rather than inline — and if a near-identical primitive already exists, extend it instead of duplicating its styling. A bespoke one-off component is a last resort, reserved for genuinely single-use UI.
```

- [ ] **Step 2: Commit** — `git commit -am "docs(claude): add UI reuse-first policy (Modal primitive)"`

---

## Task 6: Final verification

- [ ] **Step 1:** `npx tsc --noEmit` → clean.
- [ ] **Step 2:** Grep for stragglers — `git grep -n "createPortal\|RadixDialog.Overlay\|backdrop-blur-2xl" -- components/` — confirm remaining hits are only the intentional out-of-scope files (MobileActionSheet sheet, Toast, lightbox, menus) and `Modal.tsx` itself.
- [ ] **Step 3:** Visual pass in the running app: open ConfirmationModal, SaveCheckpoint, Table, Account → Plans → Billing-processing (stacking via `level`), Character wizard, Templates. Check open/close spring, backdrop, ESC, click-outside, and that nested billing modals stack above plans.

---

## Self-review notes
- **Spec coverage:** glass style (panel classes in Task 1) ✓; migrate-all (Tasks 2–4) ✓; modals-only (Sheet/Toast/popovers explicitly skipped) ✓; Framer spring baked in (Task 1 motion) ✓; centralized z-scale (`LEVEL_Z`) ✓; AccountModal `modal={false}` preserved (3h) ✓; AI policy (Task 5) ✓.
- **Known follow-ups (noted, not blocking):** `ConfirmationModal` has no `level` prop, so a confirm nested inside an elevated modal (UserDetailDrawer 3f) may need a `level` passthrough later; `MobileActionSheet` deferred as a future `Modal` Sheet variant.
- **Type consistency:** `Modal` props (`open`, `onOpenChange`, `size`, `level`, `showClose`, `dismissable`, `modal`, `contentClassName`, `srTitle`) are referenced consistently across Tasks 2–4.
