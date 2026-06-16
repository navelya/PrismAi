import { createClient } from '@/lib/supabase/client';
import { isMissingTableError } from '@/lib/admin/model-provider-binding';

export const modelsAdminApi = {
    /** Fetch all categories */
    listCategories: async () => {
        const supabase = createClient();
        const { data, error } = await supabase
            .from('categories')
            .select('*')
            .order('display_name');

        if (error) throw error;
        return data;
    },

    /** Fetch all AI models, each with a `provider_bindings` array (sorted by
     * priority, index 0 = default). Bindings come from a SEPARATE query — not
     * a relation embed — so the whole models list keeps working before the
     * 20260612 ai_model_providers migration is applied (only the missing-table
     * error is swallowed; bindings just come back empty). */
    listModels: async () => {
        const supabase = createClient();
        const { data, error } = await supabase
            .from('ai_models')
            .select('*, providers(name, logo_url)')
            .order('display_name');

        if (error) throw error;

        const { data: bindings, error: bindingsError } = await supabase
            .from('ai_model_providers')
            .select('model_id, provider_id, provider_model_id, priority, is_active')
            .order('priority');

        if (bindingsError && !isMissingTableError(bindingsError)) throw bindingsError;
        if (bindingsError) {
            console.warn(
                '[modelsAdminApi] ai_model_providers table missing — models have no provider_bindings (apply migration 20260612_ai_model_providers.sql).'
            );
        }

        const bindingsByModel = new Map<string, any[]>();
        for (const binding of bindings || []) {
            const key = String((binding as any).model_id);
            const list = bindingsByModel.get(key) || [];
            list.push(binding);
            bindingsByModel.set(key, list);
        }

        return (data || []).map((model: any) => ({
            ...model,
            provider_bindings: bindingsByModel.get(String(model.id)) || [],
        }));
    },

    /** Fetch all providers */
    listProviders: async () => {
        const supabase = createClient();
        const { data, error } = await supabase
            .from('providers')
            .select('*')
            .order('name');

        if (error) throw error;
        return data;
    },

    /** Fetch all node types.
     * Reads directly via the Supabase client (node_types has a public SELECT
     * RLS policy) instead of the admin-gated /api/admin/node-types route, so
     * non-admin users can load the catalog for node icons/labels. */
    listNodeTypes: async () => {
        const supabase = createClient();
        const { data, error } = await supabase
            .from('node_types')
            .select('*')
            .order('display_name');

        if (error) throw error;
        return data;
    },

    /** Fetch all data types (images, video, text, etc) */
    listDataTypes: async () => {
        const supabase = createClient();
        const { data, error } = await supabase
            .from('data_types')
            .select('*')
            .order('id');

        if (error) throw error;
        return data;
    },

    /** Fetch all node archetypes */
    listArchetypes: async () => {
        const supabase = createClient();
        const { data, error } = await supabase
            .from('node_archetypes')
            .select('*')
            .order('component_name');

        if (error) throw error;
        return data;
    },

    /** Create a new AI model */
    createModel: async (model: any) => {
        const res = await fetch('/api/admin/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(model),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create model');
        return data.model;
    },

    /** Create a new Node Type */
    createNodeType: async (nodeType: any) => {
        const res = await fetch('/api/admin/node-types', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nodeType),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create node type');
        return data.nodeType;
    },

    /** Update an existing Node Type */
    updateNodeType: async (id: string, nodeType: any) => {
        const res = await fetch(`/api/admin/node-types/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nodeType),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update sub category');
        return data.nodeType;
    },

    /** Delete a Node Type */
    deleteNodeType: async (id: string) => {
        const res = await fetch(`/api/admin/node-types/${id}`, {
            method: 'DELETE',
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to delete sub category');
        return data.success;
    },

    /** Update an existing AI model */
    updateModel: async (id: number, model: any) => {
        const res = await fetch(`/api/admin/models/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(model),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update model');
        return data.model;
    },

    /** Delete an AI model */
    deleteModel: async (id: number) => {
        const res = await fetch(`/api/admin/models/${id}`, {
            method: 'DELETE',
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to delete model');
        return data.success;
    },

    /** Promote a variant to be its group's primary (the one shown in user lists). */
    promoteModel: async (id: number) => {
        const res = await fetch(`/api/admin/models/${id}/promote`, {
            method: 'POST',
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to promote model');
        return data.success;
    },

    /** Create a new provider */
    createProvider: async (formData: FormData) => {
        const res = await fetch('/api/admin/providers', {
            method: 'POST',
            body: formData,
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create provider');
        return data.provider;
    },

    /** Update a provider */
    updateProvider: async (id: string, formData: FormData) => {
        const res = await fetch(`/api/admin/providers/${id}`, {
            method: 'PATCH',
            body: formData,
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update provider');
        return data.provider;
    },

    /** Delete a provider */
    deleteProvider: async (id: string) => {
        const res = await fetch(`/api/admin/providers/${id}`, {
            method: 'DELETE',
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to delete provider');
        return data.success;
    },

    /** Context Menu Builder */
    listContextMenuItems: async () => {
        const res = await fetch('/api/admin/context-menu');
        if (!res.ok) throw new Error('Failed to fetch context menu items');
        return res.json();
    },

    createContextMenuItem: async (item: any) => {
        const res = await fetch('/api/admin/context-menu', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create context menu item');
        return data.item;
    },

    updateContextMenuItem: async (id: string, updates: any) => {
        const res = await fetch(`/api/admin/context-menu/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update context menu item');
        return data.item;
    },

    deleteContextMenuItem: async (id: string) => {
        const res = await fetch(`/api/admin/context-menu/${id}`, {
            method: 'DELETE',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to delete context menu item');
        return data.success;
    },

    reorder: async (items: { id: string; sort_order: number }[]) => {
        const res = await fetch('/api/admin/context-menu/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to reorder items');
        return data.success;
    }
};

/** Auto-generate inline field descriptions for a model (admin, Gemini). Returns
 *  a map keyed by `${kind}:${api_mapping_key}` → description text. */
export const modelFieldDescriptionsApi = {
    generate: async (payload: {
        model: { display_name?: string; provider?: string; category?: string; node_type?: string; archetype?: string };
        fields: Array<{ kind: 'control' | 'input' | 'output'; api_mapping_key: string; label?: string; component?: string; type?: string; options?: string[]; min?: number; max?: number }>;
    }) => {
        const res = await fetch('/api/admin/models/describe-fields', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to generate descriptions');
        return data.descriptions as Record<string, string>;
    },
};

export const nodeTypeDescriptionsApi = {
    /** Ask Gemini Flash for a tiny blurb per node type (sub category). Returns a
     *  map keyed by node type id. Used by the per-form Generate button and the
     *  bulk "generate uninitialized" button in the admin Sub Categories tab. */
    generate: async (payload: {
        items: Array<{ id: string; display_name: string; parent_categories?: string[] }>;
        categories?: Array<{ id: string; display_name: string }>;
    }) => {
        const res = await fetch('/api/admin/node-types/describe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to generate descriptions');
        return data.descriptions as Record<string, string>;
    },
};

export const adminTemplatesApi = {
  list: async () => {
    const res = await fetch('/api/admin/templates');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load templates');
    return data.templates as any[];
  },
  get: async (id: string) => {
    const res = await fetch(`/api/admin/templates/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load template');
    return data.template as any;
  },
  /** Open (find-or-create) the admin's reusable Studio edit session for a template. */
  editSession: async (id: string) => {
    const res = await fetch(`/api/admin/templates/${id}/edit-session`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to open edit session');
    return data.session_id as string;
  },
  create: async (formData: FormData) => {
    const res = await fetch('/api/admin/templates', { method: 'POST', body: formData });
    // A 413 (Content Too Large) returns a plain-text body, so parse defensively
    // instead of blowing up with "Unexpected token ... is not valid JSON".
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = res.status === 413
        ? 'Image is too large — try a smaller thumbnail.'
        : data?.error || `Failed to create template (${res.status})`;
      throw new Error(msg);
    }
    return data.template;
  },
  /** Ask Gemini to read the workflow and propose template metadata to pre-fill the form. */
  autoFill: async (sessionId: string, imageUrl?: string | null) => {
    const res = await fetch('/api/admin/templates/auto-fill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, imageUrl: imageUrl || undefined }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `Auto-fill failed (${res.status})`);
    return data.fields as {
      name: string;
      category: string;
      description: string;
      how_it_works: string;
      tags: string[];
      use_cases: string[];
    };
  },
  update: async (id: string, formData: FormData) => {
    const res = await fetch(`/api/admin/templates/${id}`, { method: 'PATCH', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update template');
    return data.template;
  },
  remove: async (id: string) => {
    const res = await fetch(`/api/admin/templates/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete template');
    return data;
  },
};
