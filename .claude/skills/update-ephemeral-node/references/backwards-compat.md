# Backwards Compatibility Patterns

Workflows are stored in the DB as JSON snapshots: `sessions.canvas_state` holds the latest user-edited graph; `executions.graph_json` is the immutable snapshot taken when a run started. Both reference node types, handle ids, control keys, and layer entries by string. Changing those strings in code without a migration plan breaks every workflow that has them saved.

The patterns below let you evolve a plugin's API without breaking existing data.

## The default rule

> Old configs with missing fields, missing handles, or extra-but-ignored fields must still produce a sensible result.

The runtime won't complain about extra keys in `node.data.config`, and `applyNodeChanges` won't fail when a config has fewer keys than the current `defaultConfig`. The danger isn't the runtime crashing — it's the *output silently becoming wrong*.

## Pattern — `??` for missing field

The simplest and most common back-compat shim. When you add a new config field, the executor must tolerate its absence:

```ts
// definition.ts
export interface BlurConfig {
  radius: number;
  quality?: number;        // new field — optional in the interface
}
export const blurSharedDef: NodeSharedDef<BlurConfig> = {
  // ...
  defaultConfig: {
    radius: 5,
    quality: 1.0,          // new default
  },
  // ...
};

// executor.server.ts
const radius = config?.radius ?? 5;
const quality = config?.quality ?? 1.0;   // ?? bridges old configs that have no quality field
```

The `??` is critical (vs `||`) so that `quality: 0` is respected as a valid intentional value, not silently coerced to 1.0.

## Pattern — feature flag inside the executor

When you're changing what a field MEANS (vs adding a new one), branch on its presence to preserve old behavior:

```ts
// Old configs had `blur_type: undefined` and used Gaussian.
// New configs have `blur_type: 'gaussian' | 'box' | 'stack'`.
const blurType = config?.blur_type ?? 'gaussian';
```

Don't change the default if the previous behavior was to use a specific algorithm — use the previous value as the default.

## Pattern — accept multiple shapes (config polymorphism)

When the user wants to restructure a config (e.g. split `radius: number` into `radius: { x: number, y: number }` for non-uniform blur), the executor accepts BOTH shapes:

```ts
const rawRadius = config?.radius;
const radius = typeof rawRadius === 'number'
  ? { x: rawRadius, y: rawRadius }
  : (rawRadius ?? { x: 5, y: 5 });
```

This is uglier than a clean rewrite but it preserves old workflows. Trade off ugly-but-compatible against pretty-but-breaking based on what the user actually needs.

## Pattern — deprecated handle (keep, don't remove)

Want to phase out a handle but not break old edges? Mark it as deprecated but keep it functional:

```ts
handles: {
  inputs: [
    { id: 'image', label: 'Image', expectedType: 'image' },              // current
    { id: 'mask', label: 'Mask (deprecated)', expectedType: 'image',
      isMandatory: false },                                              // kept for old edges
  ],
}

// executor.server.ts
const imageUrl = inputs.image;
const maskUrl = inputs.mask;        // still read it; ignore if undefined
```

Visually you can dim the deprecated handle in the canvas card. Use this for several releases, then remove it in a planned migration.

## Pattern — alias the type slug

When renaming a node type, register BOTH slugs as the same plugin:

```ts
// lib/nodes/core/shared-registry.ts
export const sharedRegistry: Record<string, NodeSharedDef<any>> = {
  // ...
  blur: blurSharedDef,
  gaussian_blur: blurSharedDef,   // alias for old saved workflows
};
```

The same trick works in `client-registry.ts` and `server-registry.ts`. Workflows with the old slug load and run; new workflows use the new slug. Drop the alias after a deprecation period.

This is the ONLY safe way to rename a type slug. Plain renaming breaks every saved row.

## When NOT to use a compat shim

Compat shims have a cost — they're extra branches in the executor that get more confusing over time. Reach for them when:
- The user has actual saved workflows that would break (production data exists).
- The breaking change is unwanted but unavoidable (genuine improvement).

Don't reach for them when:
- The project is pre-launch with no real users → just break things and move on.
- The change is itself a behavior fix — old workflows producing wrong output should be "fixed" not preserved.

Ask the user which case applies before adding the shim. The plan in Phase 2 should explicitly say: "This change breaks old workflows. Options: (a) add compat shim that gives old configs the previous behavior; (b) accept the break. Which do you want?"

## Cross-reference: how to check the impact

For any change, run these greps to find what relies on the thing you're changing:

```bash
# Type slug references in code
grep -rn "'<type>'" lib components app hooks --include="*.ts" --include="*.tsx"

# Handle id references (downstream consumers reading inputs by name)
grep -rn "inputs\.<handle_id>\|inputs\['<handle_id>'\]" lib --include="*.ts"

# Config field references (other plugins or the store inspecting your config)
grep -rn "config\.<field>\|config?\.<field>" lib --include="*.ts" --include="*.tsx"

# DB references (the type slug appears in canvas_state and graph_json JSONB columns)
# This grep won't see the DB itself, but it will surface any code that pattern-matches on the slug
grep -rn "type.*===.*'<type>'\|node\.type.*'<type>'" lib --include="*.ts"
```

If any of these turn up unexpected results, raise them in the Phase 2 plan as risks.

## Migration scripts (when you must break)

If the user explicitly approves a breaking change with a migration plan, the migration usually looks like:

```sql
-- Add to supabase/migrations/<timestamp>_rename_blur_to_gaussian_blur.sql

-- Rewrite sessions.canvas_state
UPDATE sessions
SET canvas_state = jsonb_set(
  canvas_state,
  '{nodes}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN node->>'type' = 'blur' THEN jsonb_set(node, '{type}', '"gaussian_blur"')
        ELSE node
      END
    )
    FROM jsonb_array_elements(canvas_state->'nodes') node
  )
)
WHERE canvas_state->'nodes' @> '[{"type": "blur"}]';

-- Same for executions.graph_json
UPDATE executions SET graph_json = jsonb_set(
  graph_json, '{nodes}',
  (SELECT jsonb_agg(
    CASE WHEN node->>'type' = 'blur'
      THEN jsonb_set(node, '{type}', '"gaussian_blur"')
      ELSE node
    END
   ) FROM jsonb_array_elements(graph_json->'nodes') node)
)
WHERE graph_json->'nodes' @> '[{"type": "blur"}]';
```

The skill should NOT write these migrations without explicit approval — they're destructive and need user review. Include the SQL skeleton in the Phase 2 plan and let the user check it before running.
