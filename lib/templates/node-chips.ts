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

/**
 * Build a de-duplicated chip list straight from a workflow's nodes. AI-model
 * nodes (`ai_generator`, identified by `data.config.model_id`) collapse to their
 * model's CATEGORY (with the category's icon) rather than a generic "AI" chip —
 * so a graph with an image model + a video model shows "Image Generation" and
 * "Video & Animation". Other node types keep their registry label + icon.
 */
export function workflowNodeChips(nodes: any[], models: any[] = [], categories: any[] = []): NodeChip[] {
  const out: NodeChip[] = [];
  const seen = new Set<string>();
  const push = (key: string, label: string, color: string, iconName: string | undefined) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ type: key, label, color, Icon: resolveIcon(iconName) });
  };

  for (const n of nodes ?? []) {
    const type: string | undefined = n?.type;
    if (!type || type === 'group_container') continue;

    const modelId = n?.data?.config?.model_id;
    const isAi = type === 'ai_generator' || modelId != null;

    if (isAi) {
      const model = models.find((m: any) => m.id === modelId);
      const cat = model ? categories.find((c: any) => c.id === model.category_id) : null;
      if (cat) {
        push(`cat:${cat.id}`, cat.display_name, 'rgb(var(--accent-primary))', cat.icon_reference);
      } else {
        const meta = (sharedRegistry['ai_generator'] as any)?.meta ?? {};
        push('ai', meta.label ?? 'AI Model', meta.color ?? 'rgb(var(--stroke-subtle))', meta.icon);
      }
      continue;
    }

    const meta = (sharedRegistry[type] as any)?.meta ?? {};
    push(`type:${type}`, meta.label ?? type, meta.color ?? 'rgb(var(--stroke-subtle))', meta.icon);
  }
  return out;
}
