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
        // This will likely go through a BFF route in production for security, 
        // but for this internal tool we can go direct or use a route.
        const res = await fetch('/api/admin/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(model),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create model');
        return data.model;
    }
};
