// lib/templates/node-chips.ts
// Client-safe: imports ONLY the shared registry (no server registry → no sharp in the bundle).
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';

export interface NodeChip {
  type: string;
  label: string;
  color: string; // CSS color string from registry meta
  icon: string;  // Lucide PascalCase name (best-effort; callers may fall back)
}

export function nodeChipsFor(types: string[]): NodeChip[] {
  return (types ?? []).map((type) => {
    const def: any = sharedRegistry[type];
    const meta = def?.meta ?? {};
    return {
      type,
      label: meta.label ?? type,
      color: meta.color ?? 'rgb(var(--stroke-subtle))',
      icon: meta.icon ?? 'Box',
    };
  });
}
