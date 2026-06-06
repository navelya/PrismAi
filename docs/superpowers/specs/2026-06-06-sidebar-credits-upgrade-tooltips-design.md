# Sidebar: token count + Upgrade button, smoother tooltips

**Date:** 2026-06-06
**Status:** Approved (design)
**Scope:** `components/layout/Sidebar.tsx` only. No store / API / DB / schema changes.

## Goal

Three changes to the left navigation rail:

1. Make the docked nav-item tooltips animate with a smooth zoom-in (on appear) and
   zoom-out (on disappear / reappear) transition, instead of the current plain
   opacity fade.
2. Add a token/credits count above the profile section. Collapsed: icon only, with
   a hover tooltip showing the count. Expanded: the count is shown inline. The count
   does **not** appear in the workflow-session (floating/canvas) side nav.
3. Add an Upgrade button that fits both collapsed and expanded states, positioned
   above the profile.

## Context (current state)

- `Sidebar.tsx` renders three desktop/mobile presentations off one component:
  - **mobile** (`isMobile`) — slide-out drawer, profile + logout footer.
  - **docked** (`variant === 'docked'`) — collapsible left column (`w-14` collapsed
    / `w-60` expanded via `sidebarExpanded` store flag). Used on
    `/templates`, `/assets`, `/nodes`, `/settings`. Profile section is a
    `border-t` block at the bottom.
  - **floating** (default) — compact top-left overlay menu used on `/chat/*`
    canvas routes. This is the "workflow session side nav".
- Docked nav-item tooltips today are hand-rolled inline `<div>`s with only
  `transition-opacity` (Sidebar.tsx ~L535–539).
- A shared Radix tooltip already exists at `components/ui/Tooltip.tsx` with
  `animate-in fade-in-0 zoom-in-95` + `data-[state=closed]:... zoom-out-95`, and a
  global `TooltipProvider` (`delayDuration=400`, `skipDelayDuration=100`) wraps the
  app in `app/layout.tsx`. The skip-delay gives smooth tooltip **re-appearance**
  when moving between adjacent triggers.
- Credits UI already exists on the canvas in `EditorToolbar.tsx` (L121–153):
  `useTokenBalance()` → `{ balance, loading }`, `formatCredits(balance)`, a `Coins`
  icon, an Upgrade button, and `PlansModal`. `Coins` (lucide) is the established
  credits icon (also used in `AccountModal.tsx`).

## Design

### 1. Tooltips → shared Radix `<Tooltip>`

Replace the inline tooltip `<div>` on each docked nav item with the shared
`<Tooltip content={...} position="right">` component. Show the label only when the
rail is collapsed by passing `content={isExpanded ? '' : item.name}` (the component
returns children unwrapped when `content` is empty, so no tooltip fires when
expanded). This gives zoom-in/zoom-out on enter and exit for free, and the global
provider's `skipDelayDuration=100` handles smooth reappearance between items.

The same `<Tooltip>` is reused for the new collapsed credits/upgrade icons so all
rail tooltips animate identically.

### 2 + 3. Credits + Upgrade block

A new block inserted **directly above the profile section** in the docked rail, and
a parallel block in the mobile drawer footer. **Not rendered** in the floating
variant (canvas toolbar already provides credits + Upgrade). Rendered only when a
`user` exists; the balance shows a `Skeleton` while `useTokenBalance().loading`.

Both the count and the Upgrade button open `PlansModal` (new local
`showPlans` state).

**Docked — collapsed (`w-14`):** two stacked icon buttons, each centered on the
shared 28px centerline (the `w-10` leading slot used by nav icons + avatar):
- `Coins` icon button — `<Tooltip>` content = the formatted credit count
  (e.g. `"1,234 credits"`); click → `PlansModal`.
- `Sparkles` icon button — `<Tooltip>` content = `"Upgrade"`; click → `PlansModal`.

**Docked — expanded (`w-60`):** a single subtle row mirroring the EditorToolbar
credits island — `Coins` + `formatCredits(balance)` on the left (click → Plans),
an accent **Upgrade** pill on the right (click → Plans).

**Mobile drawer:** above the existing profile/logout footer, a credits row
(`Coins` + count) and a full-width **Upgrade** button; both open `PlansModal`.

```
DOCKED — collapsed (w-14)      DOCKED — expanded (w-60)
┌────┐                         ┌──────────────────────────┐
│ 🪙 │ ← tooltip: count        │ 🪙  1,234        [Upgrade]│
│ ✨ │ ← tooltip: "Upgrade"    ├──────────────────────────┤
├────┤                         │ 👤  Name / email      ⚙  │  (profile, unchanged)
│ 👤 │                         └──────────────────────────┘
└────┘
```

### Imports / state added to Sidebar.tsx

- lucide: `Coins`, `Sparkles`
- `useTokenBalance` from `@/lib/billing/use-balance`
- `formatCredits` from `@/lib/billing/cost`
- `PlansModal` from `@/components/billing/PlansModal`
- `Tooltip` from `@/components/ui/Tooltip`
- `Skeleton` from `@/components/ui/Skeleton`
- `const [showPlans, setShowPlans] = React.useState(false)`
- `const { balance, loading: balanceLoading } = useTokenBalance()`

## Out of scope (YAGNI)

- No credit-breakdown hover panel in the sidebar (canvas toolbar already has one).
- No changes to the floating/canvas variant.
- No store, API, billing, or schema changes.

## Verification

- `npx tsc --noEmit` clean (lint/build are unreliable in this repo).
- Manual: collapsed rail shows two icons with animated tooltips + count tooltip;
  expanded shows count + Upgrade pill; clicking either opens PlansModal; mobile
  drawer shows the row + button; `/chat/*` canvas menu shows neither.
