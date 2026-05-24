import { createClient } from '@/lib/supabase/client';

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

    /** Fetch all AI models */
    listModels: async () => {
        const supabase = createClient();
        const { data, error } = await supabase
            .from('ai_models')
            .select('*, providers(name, logo_url)')
            .order('display_name');

        if (error) throw error;
        return data;
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
