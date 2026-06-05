# Side navigation redesign — design

**Date:** 2026-06-05
**Status:** Approved
**Scope:** Slimmer, less-bulky side navigation on non-canvas pages.

## Goal

Redesign the two side-navigation rails used on full pages (`/templates`, `/assets`,
`/nodes`, `/settings`) to be more compact and less bulky, with a logo-aware header
that follows the common SaaS pattern (logo + sidebar-toggle). The floating
canvas/chat menu and the mobile drawer are explicitly **not** changed.

Two surfaces are in scope:

1. The **main docked rail** — `Sidebar.tsx` `variant='docked'`.
2. The **settings inner rail** — the `<aside>` inside `app/settings/page.tsx`.

## Decisions (resolved during brainstorming)

- Collapsed logo → toggle swap: **crossfade in place** (logo mark and `PanelLeft`
  occupy the same slot, opacity flipped on hover).
- Expanded header layout: **wordmark on the left, `PanelLeft` toggle pinned right**
  (matches the reference "image 1").
- Settings inner rail: **static, always-labels, no hover-expand**; slightly bigger
  than the new compact main rail.
- Main rail collapsed/expanded preference: **persisted in the store** (survives
  reloads, consistent across pages).

## 1. Main docked rail — `components/layout/Sidebar.tsx` (`variant === 'docked'`)

### Header (replaces the current burger row)

- Header height `h-14` → `h-12`.
- **Collapsed** (rail `w-16` → `w-14`): the header shows the **logo mark**
  (`<Logo variant="mark" />`) centered in the toggle button. On hover it
  **crossfades in place** to a `PanelLeft` icon — implemented as two absolutely
  positioned, stacked elements whose opacity flips on `group-hover` (no layout
  shift). Clicking the button expands the rail.
- **Expanded** (rail `w-60`): the **wordmark** (`<Logo variant="wordmark" />`)
  fades/slides in on the left; a `PanelLeft` toggle button is pinned to the
  **right** edge of the header. Clicking it collapses the rail.
- The wordmark uses the same `max-w` / opacity transition idiom already used for
  the nav labels so it animates smoothly with the width change.

### Nav items — less bulky

- Container spacing `space-y-1` → `space-y-0.5`.
- Item layout `gap-3 px-3 py-2.5 rounded-lg` → `gap-2.5 px-2 py-1.5 rounded-lg`.
- Icons `w-5 h-5` → `w-[18px] h-[18px]`.
- Label `text-sm` → `text-[13px]`.
- Active state unchanged in intent (`bg-interactive-hover` + accent text), just
  inherits the tighter padding.
- **Collapsed:** nav items render icon-only and `justify-center` within the
  narrower `w-14` rail.
- **Tooltips** (collapsed hover labels): `px-3 py-1.5 text-sm` → `px-2 py-1 text-xs`.

### Profile / skeleton row

- Apply the same tightening (smaller paddings / spacing) so the bottom profile
  block matches the slimmer nav. Avatar sizing logic stays driven by expanded
  state; only paddings shrink. No behavior change to the profile menu.

### Persistence

- Add to `UISlice` (`lib/store/types.ts`):
  - `sidebarExpanded: boolean`
  - `setSidebarExpanded: (expanded: boolean) => void`
- Implement in `lib/store/slices/ui-slice.ts` with a default of `false`
  (collapsed) and a trivial setter.
- The store uses a **blacklist** `partialize`, so the new key persists to
  localStorage automatically (it is not added to the exclude list).
- The docked variant reads `sidebarExpanded` / calls `setSidebarExpanded` instead
  of using the local `isExpanded` React state. The local `isExpanded` state is
  removed from the docked path.
- The **floating** variant's `menuOpen` state is independent and untouched. The
  mobile drawer is untouched.

## 2. Settings inner rail — `app/settings/page.tsx`

- **Remove hover-expand entirely:** delete the `sidebarHovered` state, the
  `onMouseEnter` / `onMouseLeave` handlers, and the `transition-[width]` /
  `md:w-14` ↔ `md:w-60` toggle.
- **Static width `md:w-52`, always labels:** labels, the "Soon" badges, and the
  active-item chevron are always visible — remove the `opacity-0` gating that was
  keyed on `sidebarHovered`. The footer ("System v1.0.0") is always visible.
- Update the layout spacer `div` from `md:w-14` to `md:w-52` so the main content
  does not shift.
- **A touch bigger than the compact main rail:** item text `text-[11px]` →
  `text-[13px]`, vertical padding `py-1.5` → `py-2`, icon container stays `w-5 h-5`.
- Keep the existing glass / `backdrop-blur` styling.

## Out of scope

- The floating canvas/chat app-menu (`variant === 'floating'`).
- The mobile slide-out drawer (`isMobile` branch).
- The unrelated, already-pending `userName` store changes.

## Verification

- `npx tsc --noEmit` clean (the repo's reliable check; `lint`/`build` are
  unreliable here).
- Manual: on `/templates`, `/assets`, `/nodes` — collapsed rail shows logo mark,
  hover swaps to `PanelLeft`, click expands to wordmark + right-pinned toggle;
  preference survives a reload. On `/settings` the inner rail is a static labeled
  rail with no hover animation.
