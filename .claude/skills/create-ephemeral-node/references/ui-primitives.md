# UI Primitives Inventory

Existing components in `components/ui/`. The skill MUST reach for these before inventing anything new.

| Component | Import | Use for |
|---|---|---|
| `NumberInput` | `@/components/ui/NumberInput` | Single numeric value with up/down arrows, optional `label`, `suffix`, `min/max/step`. `variant: 'default' \| 'minimal'`. |
| `Select` | `@/components/ui/Select` | Dropdown picker. Options have `{ id, display_name, icon?, subtitle?, meta? }`. Supports `triggerNode` for fully custom trigger. `variant: 'default' \| 'minimal'`. |
| `Switch` | `@/components/ui/Switch` | On/off toggle. `{ checked, onCheckedChange, label?, size: 'sm' \| 'md' }`. |
| `Checkbox` | `@/components/ui/Checkbox` | Bool with label. `{ checked, onCheckedChange, label, disabled? }`. |
| `Textarea` | `@/components/ui/Textarea` | Multi-line text. Native textarea props plus `label?`, `error?`. |
| `Input` | `@/components/ui/Input` | Single-line text. Native input props plus `label?`, `error?`. |
| `ImageLightbox` | `@/components/ui/ImageLightbox` | Click-to-zoom modal for canvas image previews. Pass `images: ImageObject[]`, `open`, `onClose`, `initialIndex`. |
| `ImageModal` | `@/components/ui/ImageModal` | Larger image viewer modal (different from Lightbox — used for full-size views). |
| `BlurryImage` | `@/components/ui/BlurryImage` | Image with blur-up loading effect. Drop-in for `<img>` when you want progressive loading on canvas previews. |
| `GlassCard` | `@/components/ui/GlassCard` | Pre-styled glassmorphism card surface. Useful as the base of a custom property panel section. |
| `GlassyLoader` | `@/components/ui/GlassyLoader` | Glass-style spinner. Use during async operations on the canvas card. |
| `Tooltip` | `@/components/ui/Tooltip` | Hover/focus tooltip. |
| `Toast` | `@/components/ui/Toast` | Transient notification. Used via `useToast` (if available) for upload errors etc. |
| `ConfirmationModal` | `@/components/ui/ConfirmationModal` | "Are you sure?" prompt. |
| `Skeleton` | `@/components/ui/Skeleton` | Loading placeholder. |
| `PillTabs` | `@/components/ui/PillTabs` | Tab strip with pill-shape active indicator. |
| `MobileActionSheet` | `@/components/ui/MobileActionSheet` | Bottom-sheet picker on small viewports. |

## Cross-node primitives (for the canvas card itself)

| Component | Import | Use for |
|---|---|---|
| `BaseNode` | `@/lib/nodes/core/canvas/BaseNode` | The standard node shell every plugin wraps. Renders header, status border, input/output handles, duplicate/remove toolbar. Pass children to put inside the card. |
| `NodeHeader` | `@/lib/nodes/core/canvas/NodeHeader` | The header row. `BaseNode` already includes it; you usually don't import this directly unless customizing. |

## Hooks the canvas card commonly needs

| Hook | Import | Use for |
|---|---|---|
| `useNodeAutoCompute` | `@/lib/hooks/use-node-auto-compute` | Wires `executor.client.ts` to live-update the node's preview as upstream values + config change. Call `useNodeAutoCompute(id)` ONCE inside the canvas component. |
| `useAppStore` | `@/lib/store/app-store` | Zustand store. Use with `useShallow` from `'zustand/react/shallow'` for narrow subscriptions. Common selectors: `state.updateNodeConfig`, `state.nodeOutputs[id]`, `state.nodeStatuses[id]`, `state.currentWorkflow.edges`. |
| `useReactFlow` | `'reactflow'` | RF instance helpers. Avoid `useNodes()`/`useEdges()` — fires on every drag tick. Use Zustand instead. |

## Helpers commonly used in canvas cards

| Helper | Import | Use for |
|---|---|---|
| `cn` | `@/lib/utils` | Tailwind class concatenation (clsx + twMerge). Standard. |
| `toLegacyRenderableOutput` | `@/lib/workflow/result-format` | Normalize upstream values that may arrive as envelopes, raw ImageObjects, or arrays. Returns a consistent shape. |
| `toThumbnailUrl` | `@/lib/utils/supabase-image` | Convert a Supabase storage URL into a thumbnail variant for canvas previews. |

## Icon library

Use [`lucide-react`](https://lucide.dev). Import the icons you need by name. Default size is `w-4 h-4` for actions, `w-3 h-3` for compact spots inside small badges. Use `strokeWidth={2}` (default) or `strokeWidth={3}` for emphasis.

Common ones used across nodes: `Copy`, `X`, `Loader2`, `Check`, `Circle`, `ImagePlus`, `Type`, `Layers2`, `Droplets`, `Zap`, `Eye`, `EyeOff`, `Lock`, `Unlock`, `Plus`, `Image as ImageIcon`.

## Animation

Use [`framer-motion`](https://www.framer.com/motion/) — `motion.div`, `AnimatePresence`, `Reorder` (for drag-to-reorder lists like compositor's layer stack). Existing nodes use `motion` for the entrance/scale animation on `BaseNode`.

## Don't reach for

Do NOT add new dependencies (Material UI, Chakra, React Aria, etc.). The codebase is committed to Tailwind + Radix primitives + Lucide icons + Framer Motion. Anything else needs explicit user approval.

## When to create a new shared component

If you find yourself wanting to create a component that:
- Could plausibly be reused from chat/library/admin/settings (not just this one node), AND
- Is general enough that its API doesn't bake in node-specific assumptions

→ create it in `components/ui/<Name>.tsx` following the patterns above.

Otherwise → keep it inside the plugin's `ui/` subfolder.
