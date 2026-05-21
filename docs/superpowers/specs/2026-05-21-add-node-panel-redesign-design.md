# Add Node Panel Redesign

**Date:** 2026-05-21
**Surface:** `components/layout/WorkspaceLayout.tsx` (Node Library Panel, lines 147–305)
**Reference panel for style alignment:** `components/editor/AssetsPanel.tsx`

## Goal

Replace the current single-pane Add Node panel — which slides horizontally between a Level 1 (Common Tools / Categories / Providers grids) and a Level 2 (sub-items list) — with a master + hover-flyout pattern that matches the minimal-modern aesthetic used elsewhere in the app. Add a search box, restructure the Basics section with curated starter nodes, switch Categories and Providers to a 1-column list with right-flyout sub-panels, and align the close button with the assets-panel style.

## Architecture

### Two-panel layout

The redesign introduces a second floating glass card, the **flyout**, that opens to the right of the existing tool rail on hover and lists the sub-items for the hovered Category or Provider row.

```
┌──────────────────┐  ┌──┐  ┌──────────────────┐
│   Master panel   │  │  │  │  Flyout panel    │
│                  │  │T │  │ (hover-triggered)│
│ Header + Search  │  │o │  │                  │
│ BASICS tiles     │  │o │  │ Header           │
│ CATEGORIES list  │──│l │──│ Items list       │
│ PROVIDERS list   │  │  │  │                  │
│                  │  │R │  │                  │
└──────────────────┘  │a │  └──────────────────┘
                      │il│
                      └──┘
```

- **Master panel:** geometry unchanged from today — `left-4 bottom-4`, `width = PANEL_W`, `top = TOP_BAR_OFFSET`. Same glass card (`bg-surface-elevated/80 backdrop-blur-md border border-stroke-subtle rounded-2xl shadow-2xl`).
- **Tool rail:** position unchanged. It does **not** shift when the flyout opens.
- **Flyout:** positioned to the right of the tool rail (i.e. further from the canvas edge than the rail). Same glass treatment as the master, width ~280 px, height capped at the available vertical space.
- **Z-index:** flyout uses the same z-layer as the master and tool rail. No new stacking context.

### Hover-flyout behavior (context-menu-style)

| Event | Effect |
|---|---|
| Mouse enters a Category or Provider row in master | After 80 ms, flyout opens with that row's items. Top edge of the flyout aligns with the hovered row, clamped so the flyout never overflows the viewport vertically. |
| Mouse moves from one row directly to another row | Flyout content swaps instantly (no close-then-reopen). |
| Mouse leaves both the triggering row and the flyout | After 150 ms grace period, flyout closes. |
| Mouse re-enters the row or the flyout during the grace period | Pending close is cancelled. |
| Mouse enters a Basics tile or the search input | Flyout closes (Basics tiles do not trigger flyouts). |
| User presses Esc | Both panels close. |
| Outside-click on the canvas | Both panels close (unchanged behavior). |

The 80 ms / 150 ms timings avoid flicker on accidental pass-through and give the user enough travel time across the gap to reach the flyout.

## Master panel — structure

Top to bottom inside the master card:

### 1. Header strip (sticky)

- Container: `flex items-center justify-between gap-2 px-2 py-2 border-b border-stroke-subtle/60` (same shape as assets panel header).
- Left: title `Add node` — `text-[13px] font-semibold text-content-primary`.
- Right: close button. Matches the assets-panel X exactly:
  ```jsx
  <button onClick={...} className="p-1 hover:bg-white/10 rounded-md transition-colors group" title="Close">
    <X className="w-3.5 h-3.5 text-content-tertiary group-hover:text-content-primary" />
  </button>
  ```
- The current floating absolute-positioned X (lines 161–173 of `WorkspaceLayout.tsx`) and floating Back button are removed entirely.

### 2. Search input (sticky, directly below header)

- Wrapper: `relative px-3 pt-2 pb-2`.
- Input: `bg-surface-secondary border border-stroke-subtle rounded-lg pl-7 pr-2 py-1.5 text-[12px] text-content-primary placeholder:text-content-tertiary focus:border-accent-primary focus:outline-none w-full`.
- `<Search className="w-3.5 h-3.5 text-content-tertiary" />` absolutely positioned inside, left ~10 px.
- Placeholder: `Search nodes or models`.
- Behavior: see [Search behavior](#search-behavior).

### 3. BASICS — 2-column tile grid

- Section label: `<Icons.Sparkles>` chip + `BASICS` (`text-[10px] font-bold uppercase tracking-widest text-content-tertiary`), styled like today's section labels.
- 6 tiles in a 3×2 grid. Tile component reuses the current Common Tools tile shape, tightened:
  ```jsx
  <div draggable className="flex items-center gap-3 p-2.5 rounded-xl border border-stroke-subtle bg-surface-primary hover:border-accent-primary hover:bg-accent-primary/5 transition-all cursor-move group shadow-sm">
    <div className="w-8 h-8 rounded-lg bg-surface-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-accent-primary/10 transition-colors">
      <Icon className="w-4 h-4 text-content-secondary group-hover:text-accent-primary transition-colors" />
    </div>
    <div className="flex-1 min-w-0">
      <div className="font-semibold text-[11px] text-content-primary truncate">{name}</div>
      <div className="text-[9px] text-content-tertiary truncate">{desc}</div>
    </div>
  </div>
  ```
- The 6 tiles:

  | # | Label | Icon | Drag payload |
  |---|---|---|---|
  | 1 | Text prompt | `Type` | `{ type: 'prompt' }` |
  | 2 | Upload image | `Image` | `{ type: 'media_input' }` |
  | 3 | Generate text | `Type` | `{ type: 'ai_generator', node_type_id: <resolved> }` |
  | 4 | Generate image | `Image` | `{ type: 'ai_generator', node_type_id: <resolved> }` |
  | 5 | Generate video | `Video` | `{ type: 'ai_generator', node_type_id: <resolved> }` |
  | 6 | Compositor | `Layers` | `{ type: 'compositor' }` |

- **node_type_id resolution for the three "Generate X" tiles:** at module init (or with `useMemo` over `nodeTypes`), build a static lookup table mapping the tile to a candidate set of `node_type_id` strings (e.g. Generate image → `['image_generation', 'generate-image', 'generate_image']`). The first id present in the loaded `nodeTypes` wins. If none match, the tile is hidden gracefully (filtered out before render). This keeps the tile set resilient to id-naming drift in the seed data.

### 4. CATEGORIES — 1-column list

- Section label: `<Icons.Grid>` chip + `CATEGORIES`.
- One row per record in `categories`. Row component:
  ```jsx
  <button onMouseEnter={openFlyoutForCategory(id)} className="w-full flex items-center justify-between gap-3 p-2.5 rounded-xl border border-stroke-subtle bg-surface-primary hover:border-accent-primary hover:bg-accent-primary/5 transition-all group shadow-sm text-left data-[active=true]:border-accent-primary/30 data-[active=true]:bg-accent-primary/5">
    <div className="flex items-center gap-3 min-w-0">
      <div className="w-8 h-8 rounded-lg bg-surface-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-accent-primary/10 transition-colors">
        <IconComponent className="w-4 h-4 text-content-primary group-hover:text-accent-primary transition-colors" />
      </div>
      <span className="text-[11px] font-semibold text-content-primary truncate">{display_name}</span>
    </div>
    <ChevronRight className="w-3.5 h-3.5 text-content-tertiary flex-shrink-0" />
  </button>
  ```
- `data-active="true"` is set when this row's flyout is currently open, producing the highlighted state.
- `Icons[category.icon_reference]` continues to drive the icon (existing pattern).

### 5. PROVIDERS — 1-column list

- Section label: `<Icons.Server>` chip + `PROVIDERS`.
- Same row shape as Categories. Logo (`provider.logo_url`) replaces the Lucide icon inside the icon chip when available, falling back to `<Building2>`.
- Hover opens the flyout with the provider's models.

### Section spacing

- 24 px between sections (`space-y-6`).
- 8 px between rows inside a section (`space-y-2`).
- The 4 px bottom spacer at the end of the list is retained so the last row doesn't bump the rounded corner.

## Flyout panel — structure

Same glass card as master. ~280 px wide.

### Header

- `<div className="px-3 pt-3 pb-2">`
- Eyebrow: `text-[10px] font-bold uppercase tracking-widest text-content-tertiary` reading either `Nodes` (for a Category flyout) or `Models from <provider.name>` (for a Provider flyout).
- Title: `text-sm font-bold text-content-primary` showing the Category or Provider `display_name` / `name`.
- Thin `border-b border-stroke-subtle/60` divider.
- **No close button.** Hover-out is the only dismiss path.

### Body

- `<div className="flex-1 overflow-y-auto p-3 space-y-2">`
- **Category flyout** — one row per `nodeTypes.filter(nt => nt.parent_categories?.includes(categoryId))`:
  ```jsx
  <div draggable onDragStart={...} className="flex items-center gap-3 p-3 border border-stroke-subtle rounded-xl cursor-move hover:border-accent-primary hover:bg-accent-primary/5 transition-all bg-surface-primary group shadow-sm">
    <div className="w-10 h-10 rounded-lg bg-surface-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-accent-primary/10 transition-colors">
      <IconComp className="w-5 h-5 text-content-secondary group-hover:text-accent-primary transition-colors" />
    </div>
    <div className="flex-1 min-w-0">
      <div className="font-bold text-sm text-content-primary">{nt.display_name}</div>
      <div className="text-[10px] text-content-tertiary uppercase tracking-wider">Dynamic node</div>
    </div>
  </div>
  ```
  Drag payload: `{ type: 'ai_generator', node_type_id: nt.id, archetype_id: nt.archetype_id }`. Drag-start also closes the entire panel (master + flyout) — matches today's behavior.

- **Provider flyout** — one row per `aiModels.filter(m => m.provider_id === providerId)`. Same row shape, except the icon chip renders the provider logo (`p?.logo_url`) and the sublabel is the first segment of `replicate_model_id`.

### Empty state

- Identical to today: centered `<Icons.Inbox className="w-8 h-8 mb-2 opacity-20" />` and the text `No items found`.

### Drag-start side effect

- On any drag from the flyout, call `setActivePanel(null)` (closes master + flyout) so the canvas is fully visible during the drop. Matches today.

## Search behavior

When the search input has a non-empty value, the master panel switches to **flat results mode**:

- BASICS / CATEGORIES / PROVIDERS sections are hidden.
- The hover-flyout is closed and disabled while searching (no Category/Provider rows are visible to trigger it).
- A single grouped result list is rendered inside the master, in this order:
  1. **Basics** — any of the 6 Basics tiles whose label or description contains the query.
  2. **Nodes** — `nodeTypes` records whose `display_name` contains the query.
  3. **Models** — `aiModels` records whose `display_name` or `replicate_model_id` contains the query.
- Each group is shown only if it has at least one hit, with its own tiny `text-[10px] font-bold uppercase tracking-widest text-content-tertiary` label above the rows.
- Rows reuse the flyout row component shape. Each row's drag payload matches the section it originated from (Basics tile payload, ai_generator node payload, ai_generator model payload).
- **Match logic:** case-insensitive substring match. No fuzzy ranking.
- **Debounce:** 80 ms on input change before the filtered list re-computes.
- **Clearing:** when the input becomes empty the panel snaps back to the default sectioned view. While the input has a value, a small `<X className="w-3 h-3 text-content-tertiary" />` button is shown absolutely-positioned inside the input on the right side (mirroring the left-side `<Search>` icon); clicking it sets the input to `""`.
- **Empty results:** centered `<Icons.Inbox>` with text `No nodes or models match "<query>"`.

## Data sources (unchanged)

The redesign consumes the existing store data — no schema or API changes:

- `categories` — `lib/store/slices/ui-slice.ts` (`fetchCategories`)
- `nodeTypes` — same slice (`fetchNodeTypes`)
- `providers` — same slice (`fetchProviders`)
- `aiModels` — same slice (`fetchModels`)

Loading states are out of scope; today's implementation renders empty lists if the data hasn't arrived yet, and that behavior is preserved.

## Component layout

The current panel is one large inline JSX block inside `WorkspaceLayout.tsx`. To keep `WorkspaceLayout` readable and to give the flyout its own component boundary, the redesign splits this into:

- `components/editor/NodeLibraryPanel.tsx` — master panel component. Owns the search state, the currently-hovered category/provider id, hover open/close timers, and renders the header, search input, and three sections (or the flat search results).
- `components/editor/NodeLibraryFlyout.tsx` — flyout panel component. Stateless presentation, takes a `mode: 'category' | 'provider'` and the resolved item list as props.
- `components/editor/node-library/rows.tsx` — small file housing the shared `CategoryRow`, `ProviderRow`, `NodeItemRow`, `ModelItemRow`, `BasicsTile` components so the master, flyout, and search-results views all render identical row shapes.

`WorkspaceLayout.tsx` keeps only the `AnimatePresence` wrapper and the `<NodeLibraryPanel>` + `<NodeLibraryFlyout>` mount, and removes the inline JSX it has today.

## Out of scope

- No telemetry-driven "recently used" or "most used" surface (the curated Basics set is sufficient for now).
- No keyboard navigation (arrow keys, type-ahead) beyond what HTML gives the search input by default. Hover is the only flyout trigger.
- No drag-from-search refinements — drag payload routing stays as described above with no extra metadata.
- No changes to `ToolRail`, `AssetsPanel`, `TemplatesModal`, or any other panel.
- No changes to the underlying drag-and-drop drop-target handling on the canvas.

## Acceptance criteria

1. The current floating absolute-positioned Back button and X button in `WorkspaceLayout.tsx` are gone. The master panel has a proper header row with title + assets-style X.
2. A working search input filters across Basics tiles, node types, and models with case-insensitive substring match and 80 ms debounce.
3. Hovering a Category or Provider row in the master panel opens a flyout panel to the right of the tool rail after ~80 ms; hovering off both row and flyout for ~150 ms closes it; moving between rows swaps content instantly.
4. The tool rail does not move when the flyout opens.
5. Esc closes both master and flyout.
6. The 6 Basics tiles are draggable, drop the correct node types, and any "Generate X" tile is hidden if no matching `node_type_id` is present in the loaded `nodeTypes` set.
7. Drag-and-drop from any section (Basics, category flyout, provider flyout, search results) drops a node with the same payload semantics as today.
8. Existing app behavior is preserved: outside-click on the canvas closes the panel; toggling the rail button toggles the panel; persistence config is untouched.
