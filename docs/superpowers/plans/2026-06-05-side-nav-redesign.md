# Side Navigation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the docked side rail (templates/assets/nodes/settings) slimmer with a logo-aware header (logo mark ↔ `PanelLeft` toggle), and turn the settings inner rail into a static labeled rail with no hover-expand.

**Architecture:** Edit the existing `Sidebar.tsx` `variant === 'docked'` branch and the `<aside>` in `app/settings/page.tsx`. Replace the docked rail's local `isExpanded` React state with a persisted `sidebarExpanded` flag in the Zustand `UISlice` (auto-persists via the store's blacklist `partialize`). No new files.

**Tech Stack:** Next.js (client components), React, Zustand (`lib/store`), Tailwind, `framer-motion`, `lucide-react`.

**Note on verification:** This repo has no test runner. Verify each task with `npx tsc --noEmit` (the reliable check here — `lint`/`build` are unreliable) plus the manual browser checks noted. Commit after each task.

---

### Task 1: Add persisted `sidebarExpanded` to the store

**Files:**
- Modify: `lib/store/types.ts` (UISlice interface)
- Modify: `lib/store/slices/ui-slice.ts` (initial state + setter)

- [ ] **Step 1: Add the type to `UISlice`**

In `lib/store/types.ts`, find the `creditBreakdown` / `fetchCreditBreakdown` block inside `interface UISlice` and add the new members right after `fetchCreditBreakdown`:

```typescript
    creditBreakdown: { balance: number; monthly: number; topup: number } | null;
    isCreditBreakdownLoading: boolean;
    fetchCreditBreakdown: () => Promise<void>;
    // Docked side-rail open/collapsed preference. Persisted (survives reloads,
    // consistent across pages) via the store's blacklist partialize. Defaults
    // to collapsed. Only the docked variant uses it; the floating menu and the
    // mobile drawer manage their own open state.
    sidebarExpanded: boolean;
    setSidebarExpanded: (expanded: boolean) => void;
```

- [ ] **Step 2: Add the initial state and setter to the slice**

In `lib/store/slices/ui-slice.ts`, find the initial-state line `isCreditBreakdownLoading: false,` and add `sidebarExpanded: false,` right after it:

```typescript
    creditBreakdown: null,
    isCreditBreakdownLoading: false,
    sidebarExpanded: false,
```

Then add the setter. Place it next to `fetchCreditBreakdown` (or anywhere among the other action implementations in this slice):

```typescript
    setSidebarExpanded: (expanded: boolean) => set({ sidebarExpanded: expanded }),
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `sidebarExpanded` / `setSidebarExpanded`.

- [ ] **Step 4: Commit**

```bash
git add lib/store/types.ts lib/store/slices/ui-slice.ts
git commit -m "feat(store): persisted sidebarExpanded preference for docked rail"
```

---

### Task 2: Docked rail — store-backed state + new logo header

**Files:**
- Modify: `components/layout/Sidebar.tsx`

- [ ] **Step 1: Import `PanelLeft`**

In the `lucide-react` import at the top of `components/layout/Sidebar.tsx`, add `PanelLeft`:

```typescript
import { MessageSquare, Pen, LayoutTemplate, Boxes, Settings, Menu, X, Trash2, Loader2, LogOut, User as UserIcon, Plus, Image, ChevronDown, PanelLeft } from 'lucide-react';
```

- [ ] **Step 2: Replace local `isExpanded` state with the store**

Find this line near the top of the `Sidebar` component:

```typescript
    const [isExpanded, setIsExpanded] = React.useState(false);
```

Replace it with store-backed reads (keep the `isExpanded` name so the rest of the docked branch is unchanged):

```typescript
    const isExpanded = useAppStore((s) => s.sidebarExpanded);
    const setSidebarExpanded = useAppStore((s) => s.setSidebarExpanded);
```

- [ ] **Step 3: Replace the docked header (burger row) and shrink the rail width**

In the `if (variant === 'docked')` branch, change the container width from `w-16` to `w-14`:

```typescript
                    ${isExpanded ? 'w-60' : 'w-14'}
```

Then replace the entire `{/* Burger Menu */}` block:

```jsx
                {/* Burger Menu */}
                <div className="h-14 flex items-center px-3">
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="p-2 rounded-lg hover:bg-interactive-hover transition-colors text-content-primary"
                        aria-label="Toggle menu"
                    >
                        <Menu className="w-5 h-5" />
                    </button>
                </div>
```

with the new logo header:

```jsx
                {/* Header: logo + collapse toggle */}
                <div className="h-12 flex items-center px-2.5">
                    {!isExpanded ? (
                        // Collapsed: logo mark that crossfades to a PanelLeft toggle
                        // on hover (stacked, same slot → no layout shift). Click expands.
                        <button
                            onClick={() => setSidebarExpanded(true)}
                            className="group relative w-9 h-9 mx-auto flex items-center justify-center rounded-lg hover:bg-interactive-hover transition-colors"
                            aria-label="Expand sidebar"
                            title="Expand"
                        >
                            <Logo
                                variant="mark"
                                className="absolute w-5 h-5 transition-opacity duration-200 group-hover:opacity-0"
                            />
                            <PanelLeft className="absolute w-5 h-5 text-content-primary opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                        </button>
                    ) : (
                        // Expanded: wordmark left, collapse toggle pinned right.
                        <div className="flex items-center w-full gap-2">
                            <Logo
                                variant="wordmark"
                                className="h-5 w-auto text-content-primary flex-1 min-w-0"
                            />
                            <button
                                onClick={() => setSidebarExpanded(false)}
                                className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg hover:bg-interactive-hover transition-colors text-content-primary"
                                aria-label="Collapse sidebar"
                                title="Collapse"
                            >
                                <PanelLeft className="w-5 h-5" />
                            </button>
                        </div>
                    )}
                </div>
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors. (`Menu` may now be unused in the docked path but is still used by the mobile header in `AppLayout.tsx`, not here — if `tsc`/lint flags `Menu` as unused *in this file*, leave the import; it is also referenced by the mobile drawer's `X`/`Menu` usage. If genuinely unused, remove `Menu` from the import.)

- [ ] **Step 5: Commit**

```bash
git add components/layout/Sidebar.tsx
git commit -m "feat(sidebar): logo-aware docked header with PanelLeft toggle, store-backed expand"
```

---

### Task 3: Docked rail — compact nav items, tooltips, profile

**Files:**
- Modify: `components/layout/Sidebar.tsx`

- [ ] **Step 1: Tighten the nav list spacing**

In the docked branch, find the nav `<ul>`:

```jsx
                        <ul className="space-y-1 mb-2">
```

Change to:

```jsx
                        <ul className="space-y-0.5 mb-2">
```

- [ ] **Step 2: Compact the nav item link + icon + collapsed centering**

Find the nav item `<Link>` className in the docked branch:

```jsx
                                            className={`
                                                group relative flex items-center gap-3 px-3 py-2.5 rounded-lg
                                                transition-all duration-200
                                                ${isActive
                                                    ? 'bg-interactive-hover text-accent-primary font-semibold'
                                                    : 'text-content-primary hover:bg-interactive-hover'
                                                }
                                            `}
```

Replace with (tighter padding/gap + center icons when collapsed):

```jsx
                                            className={`
                                                group relative flex items-center gap-2.5 px-2 py-1.5 rounded-lg
                                                transition-all duration-200
                                                ${!isExpanded ? 'justify-center' : ''}
                                                ${isActive
                                                    ? 'bg-interactive-hover text-accent-primary font-semibold'
                                                    : 'text-content-primary hover:bg-interactive-hover'
                                                }
                                            `}
```

Then find the nav icon:

```jsx
                                            <Icon className="w-5 h-5 flex-shrink-0" />
```

Change to:

```jsx
                                            <Icon className="w-[18px] h-[18px] flex-shrink-0" />
```

Then find the label span and reduce the font size from `text-sm` to `text-[13px]`:

```jsx
                                            <span
                                                className={`
                                                    font-medium text-[13px] whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out
                                                    ${isExpanded ? 'max-w-[200px]' : 'max-w-0'}
                                                `}
                                            >
                                                {item.name}
                                            </span>
```

- [ ] **Step 3: Minimize the collapsed tooltip**

Find the tooltip div in the docked nav item:

```jsx
                                                <div className="absolute left-full ml-2 px-3 py-1.5 bg-content-primary text-surface-primary text-sm rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-[100] shadow-lg">
                                                    {item.name}
                                                </div>
```

Change to (smaller padding + `text-xs`):

```jsx
                                                <div className="absolute left-full ml-2 px-2 py-1 bg-content-primary text-surface-primary text-xs rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-[100] shadow-lg">
                                                    {item.name}
                                                </div>
```

- [ ] **Step 4: Lightly tighten the profile + skeleton padding**

In the docked branch's profile block, find the authenticated wrapper:

```jsx
                    {user ? (
                        <div className="p-2">
```

Change to:

```jsx
                    {user ? (
                        <div className="p-1.5">
```

And the skeleton wrapper:

```jsx
                    ) : (
                        <div className="p-3">
```

Change to:

```jsx
                    ) : (
                        <div className="p-2">
```

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/layout/Sidebar.tsx
git commit -m "style(sidebar): slimmer docked nav items, smaller icons + tooltips"
```

---

### Task 4: Settings inner rail — static, always-labeled, no hover-expand

**Files:**
- Modify: `app/settings/page.tsx`

- [ ] **Step 1: Remove the hover state**

Find and delete this line (around line 778):

```typescript
    const [sidebarHovered, setSidebarHovered] = useState(false);
```

- [ ] **Step 2: Widen the layout spacer**

Find the spacer div:

```jsx
            {/* Spacer reserves the collapsed-rail width on desktop so main content doesn't shift on hover */}
            <div className="hidden md:block md:w-14 md:shrink-0" aria-hidden="true" />
```

Change to:

```jsx
            {/* Spacer reserves the static rail width on desktop so main content doesn't shift */}
            <div className="hidden md:block md:w-52 md:shrink-0" aria-hidden="true" />
```

- [ ] **Step 3: Make the `<aside>` a static labeled rail**

Replace the `<aside ...>` opening tag and its inner wrapper div:

```jsx
            <aside
                onMouseEnter={() => setSidebarHovered(true)}
                onMouseLeave={() => setSidebarHovered(false)}
                className={`
                    md:absolute md:left-0 md:top-0 md:bottom-0 md:z-30
                    md:border-r md:border-stroke-subtle/60 bg-surface-primary/70 backdrop-blur-3xl md:overflow-hidden md:block shadow-xl
                    transition-[width] duration-150 ease-out
                    ${sidebarHovered ? 'md:w-60' : 'md:w-14'}
                    ${mobileShowContent ? 'hidden' : 'w-full bg-surface-primary overflow-y-auto z-20'}
                `}
            >
                <div className={`md:h-full md:flex md:flex-col ${sidebarHovered ? 'md:overflow-y-auto' : 'md:overflow-hidden'}`}>
```

with:

```jsx
            <aside
                className={`
                    md:absolute md:left-0 md:top-0 md:bottom-0 md:z-30
                    md:border-r md:border-stroke-subtle/60 bg-surface-primary/70 backdrop-blur-3xl md:overflow-hidden md:block shadow-xl
                    md:w-52
                    ${mobileShowContent ? 'hidden' : 'w-full bg-surface-primary overflow-y-auto z-20'}
                `}
            >
                <div className="md:h-full md:flex md:flex-col md:overflow-y-auto">
```

- [ ] **Step 4: Make item label / badge / chevron always visible and slightly bigger**

Find the item `<button>` className:

```jsx
                                    className={`
                                        w-full flex items-center gap-2.5 py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-colors duration-150
                                        ${activeTab === item.id
                                            ? 'bg-white/8 text-content-primary'
                                            : 'text-content-tertiary hover:bg-white/5 hover:text-content-secondary'
                                        }
                                    `}
```

Change `py-1.5` → `py-2` and `text-[11px]` → `text-[13px]`:

```jsx
                                    className={`
                                        w-full flex items-center gap-2.5 py-2 px-2 rounded-lg text-[13px] font-semibold transition-colors duration-150
                                        ${activeTab === item.id
                                            ? 'bg-white/8 text-content-primary'
                                            : 'text-content-tertiary hover:bg-white/5 hover:text-content-secondary'
                                        }
                                    `}
```

Then the label span — remove the hover-gated opacity:

```jsx
                                    <span className={`
                                        flex-1 text-left truncate whitespace-nowrap transition-opacity duration-100
                                        ${sidebarHovered ? 'md:opacity-100' : 'md:opacity-0'}
                                    `}>
                                        {item.label}
                                    </span>
```

Change to:

```jsx
                                    <span className="flex-1 text-left truncate whitespace-nowrap">
                                        {item.label}
                                    </span>
```

Then the "Soon" badge — remove the hover-gated opacity:

```jsx
                                        <span className={`
                                            px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider bg-white/5 text-content-tertiary rounded-md shrink-0 border border-white/10 transition-opacity duration-100
                                            ${sidebarHovered ? 'md:opacity-100' : 'md:opacity-0'}
                                        `}>
                                            Soon
                                        </span>
```

Change to:

```jsx
                                        <span className="px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider bg-white/5 text-content-tertiary rounded-md shrink-0 border border-white/10">
                                            Soon
                                        </span>
```

Then the `ChevronRight` — drop the hover gate, keep the active-only visibility:

```jsx
                                    <ChevronRight className={`
                                        w-3 h-3 shrink-0 transition-opacity duration-100
                                        ${sidebarHovered ? 'md:opacity-100' : 'md:opacity-0'}
                                        ${activeTab === item.id ? 'opacity-100 text-accent-primary' : 'opacity-0'}
                                    `} />
```

Change to:

```jsx
                                    <ChevronRight className={`
                                        w-3 h-3 shrink-0 transition-opacity duration-100
                                        ${activeTab === item.id ? 'opacity-100 text-accent-primary' : 'opacity-0'}
                                    `} />
```

- [ ] **Step 5: Make the footer always visible**

Find the footer div:

```jsx
                    <div className={`
                        px-3 py-2 border-t border-stroke-subtle/60 mt-auto
                        transition-opacity duration-100
                        ${sidebarHovered ? 'md:opacity-100' : 'md:opacity-0 md:pointer-events-none'}
                    `}>
```

Change to:

```jsx
                    <div className="px-3 py-2 border-t border-stroke-subtle/60 mt-auto">
```

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors, and no remaining references to `sidebarHovered` (grep to confirm: `npx grep` or search the file — there should be zero).

- [ ] **Step 7: Commit**

```bash
git add app/settings/page.tsx
git commit -m "style(settings): static labeled inner rail, no hover-expand"
```

---

### Task 5: Final verification

- [ ] **Step 1: Full type check**

Run: `npx tsc --noEmit`
Expected: clean (no new errors vs. baseline).

- [ ] **Step 2: Manual smoke check (dev server)**

Run `npm run dev`, then in the browser:
- `/templates`, `/assets`, `/nodes`: rail is `w-14` collapsed showing the **logo mark**; hovering the header crossfades it to the **PanelLeft** icon; clicking expands to `w-60` with the **wordmark on the left + PanelLeft toggle on the right**; nav items are visibly tighter; collapsed hover tooltips are small. Toggle to expanded, reload the page → it stays expanded (persisted).
- `/settings`: the inner rail is a static `w-52` rail with icons **and labels always visible**, no width animation on hover; active item shows the accent chevron.
- Confirm the **chat/canvas** floating menu and the **mobile** drawer are unchanged.

- [ ] **Step 3: (No commit)** — verification only.

---

## Self-Review Notes

- **Spec coverage:** Header logo crossfade + expanded wordmark/right-toggle (Task 2) ✓; compact nav items + smaller icons + smaller tooltips (Task 3) ✓; profile tightening (Task 3 Step 4) ✓; persisted expand state (Task 1 + Task 2 Step 2) ✓; settings static labeled rail, no hover, wider spacer, bigger items (Task 4) ✓; out-of-scope surfaces (floating/mobile/userName) untouched ✓.
- **Type consistency:** `sidebarExpanded` / `setSidebarExpanded` defined in Task 1 and consumed in Task 2 with matching names.
- **No placeholders:** every code step shows the exact before/after.
