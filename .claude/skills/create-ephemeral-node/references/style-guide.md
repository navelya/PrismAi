# Style Guide — Modern Minimal / Glassmorphism

The PrismAi UI language. Match these patterns when writing canvas cards, modal editors, and any new shared component.

## Surfaces

| Pattern | Tailwind |
|---|---|
| Card / panel base | `bg-white/5 border border-white/10 backdrop-blur-md rounded-xl` |
| Hover variant | adds `hover:bg-white/10 hover:border-white/20 transition-all duration-200` |
| Selected/active | `bg-accent-primary/20 border-accent-primary/40` (with ring `focus:ring-4 focus:ring-accent-primary/10` for focusable controls) |
| Subtle elevation | `shadow-lg` on hover/active states; do not stack on default state |

Avoid solid colors. The aesthetic is layered translucent surfaces over a dark canvas; full opacity surfaces stand out and break the rhythm.

## Borders

- 1px (the Tailwind default) for everything except the duplicate/remove toolbar buttons which use the `b1` token from the canvas system.
- Color: `border-white/10` for default surfaces, `border-white/20` for hover, `border-accent-primary/30` for active.
- Radius: `rounded-xl` for cards and inputs, `rounded-lg` for buttons, `rounded-full` for pill toggles.

## Color tokens

CSS variables in `app/globals.css`. Use Tailwind classes that resolve them:

| Class | Purpose |
|---|---|
| `text-content-primary` | Main text |
| `text-content-secondary` | Subdued text (subtitles, captions) |
| `text-content-tertiary` | Hints, helper labels |
| `text-accent-primary` / `bg-accent-primary` | Brand accent (active states, primary buttons) |
| `text-accent-secondary` | Secondary accent |
| `text-accent-error` / `bg-accent-error/20` | Error states |
| `bg-canvas-bg` / `bg-canvas-node` | Canvas background, node card base |
| `text-canvas-text` / `text-canvas-subtext` | Text on canvas surfaces |

Don't hardcode hex/rgb in className strings. If you find yourself wanting to, the design token doesn't exist yet — add it to globals.css with the semantic name first.

## Typography

| Use | Tailwind |
|---|---|
| Tiny labels (form labels, headers) | `text-[10px] font-bold uppercase tracking-[0.1em] text-content-tertiary` |
| Body small | `text-sm text-content-primary` |
| Body | `text-sm text-content-primary` (most node UI) |
| Headings | `text-lg font-bold text-content-primary` (rare in nodes; reserved for modal headers) |

Font weight is `font-bold` (700) for labels and headings, `font-medium` (500) for emphasized body text, default (400) elsewhere.

The `text-[10px]` micro-label with all-caps tracking is the load-bearing pattern for control labels in nodes — see `Textarea.tsx`, `NumberInput.tsx`, `Switch.tsx`. Use it for consistency.

## Icons

Lucide React. Sizes:

| Size | Use |
|---|---|
| `w-3 h-3` | Compact spots inside small buttons (duplicate/remove toolbar). |
| `w-3.5 h-3.5` | Checkmarks inside checkboxes/switches. |
| `w-4 h-4` | Standard action buttons, header icons. |
| `w-5 h-5` | Larger actions, accent on category headers. |

Stroke width is the default (`2`). For emphasized check marks: `strokeWidth={3}`.

## Spacing

| Use | Tailwind |
|---|---|
| Inside a card section | `space-y-2` (vertical), `gap-2` (horizontal) |
| Between cards / major regions | `gap-3` to `gap-4` |
| Form field grouping | `space-y-1` between label and input |
| Cluster of small icons (toolbar) | `gap-1` to `gap-1.5` |

Padding inside cards: `p-3` for compact node interiors, `p-4` for spacious sections, `px-4 py-3` for inputs.

## Buttons

```tsx
<button
  className={cn(
    "w-6 h-6 rounded-lg bg-white/5 border backdrop-blur-md",
    "flex items-center justify-center shadow-lg",
    "hover:scale-110 hover:bg-white/10 transition-all duration-200"
  )}
  style={{ borderWidth: '1px', borderColor: 'rgba(255,255,255,0.1)' }}
>
  <Icon className="w-3 h-3 text-content-primary" />
</button>
```

This is the standard "small icon button" pattern (used by duplicate/remove). For larger CTAs:

```tsx
<button className="px-4 py-2 rounded-xl bg-accent-primary text-white font-medium hover:bg-accent-primary/90 transition-all">
  Action
</button>
```

## Animation

`framer-motion`:
- Entrance: `initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', bounce: 0, duration: 0.3 }}`.
- Hover: prefer CSS `hover:scale-110 transition-transform` over framer-motion for performance.
- Layout shifts (drag-to-reorder): `Reorder` from framer-motion.

Avoid using framer-motion for hover/focus states — those are CSS transitions. Use framer for layout animations and entrance effects only.

## Layouts

Nodes:
- Default node card width: `w-[280px]` to `w-[320px]`. Don't use `min-w-` or auto-width — the canvas needs predictable dimensions for layout math.
- Min height on the body: enough for handles + 2 controls + a small preview, around `min-h-[120px]` for empty state.
- Preview area: square or 16:9, `aspect-square` or `aspect-video`, with `bg-white/5` placeholder when empty.

Modals:
- `fixed inset-0 z-50` overlay with `bg-black/40 backdrop-blur-sm`.
- Modal panel: `bg-canvas-bg border border-white/10 rounded-2xl shadow-2xl` centered with flex.
- See `lib/nodes/plugins/compositor/ui/EditorModal.tsx` for the full pattern.

## What to avoid

- Solid colors on surfaces (use translucent `/5`, `/10`, `/20`).
- Hard shadows (`shadow-md` is fine, drop-shadow filters with high blur values look out of place).
- Bright colors as backgrounds (use `bg-accent-primary/20` not `bg-accent-primary`).
- `border-2` or `border-4` (the language is thin borders).
- Non-Lucide icons or emoji as functional icons.
- `dark:` variants — the app is always dark; light mode is not in scope.
- Inline `style` attributes for anything but borderWidth/borderColor on the toolbar button pattern; everything else is Tailwind.
