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
            .select('*')
            .order('display_name');

        if (error) throw error;
        return data;
    },

    /** Fetch all node types */
    listNodeTypes: async () => {
        const res = await fetch('/api/admin/node-types');
        if (!res.ok) throw new Error('Failed to fetch node types');
        return res.json();
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
    }
};
