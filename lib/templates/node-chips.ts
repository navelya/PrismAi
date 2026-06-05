// lib/templates/node-chips.ts
// Client-safe: imports ONLY the shared registry (no server registry → no sharp in the bundle).
import type { ComponentType } from 'react';
import * as Icons from 'lucide-react';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';

export interface NodeChip {
  type: string;
  label: string;
  color: string; // CSS color string from registry meta
  /** Resolved lucide icon component (falls back to Box for unknown names). */
  Icon: ComponentType<{ className?: string }>;
}

function resolveIcon(name: string | undefined): ComponentType<{ className?: string }> {
  const Comp = name ? (Icons as any)[name] : undefined;
  return (Comp as ComponentType<{ className?: string }>) || (Icons.Box as any);
}

export function nodeChipsFor(types: string[]): NodeChip[] {
  return (types ?? []).map((type) => {
    const def: any = sharedRegistry[type];
    const meta = def?.meta ?? {};
    return {
      type,
      label: meta.label ?? type,
      color: meta.color ?? 'rgb(var(--stroke-subtle))',
      Icon: resolveIcon(meta.icon),
    };
  });
}
