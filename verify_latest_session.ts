import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Read .env.local manually to avoid dotenv dependency
function loadEnv() {
    try {
        const envPath = path.resolve(process.cwd(), '.env.local');
        const envContent = fs.readFileSync(envPath, 'utf-8');
        envContent.split('\n').forEach(line => {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                const value = match[2].trim().replace(/^['"]|['"]$/g, '');
                process.env[key] = value;
            }
        });
    } catch (e) {
        console.warn('Could not read .env.local');
    }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

(async () => {
    console.log('Using Supabase URL:', supabaseUrl);
    console.log('Using Key Length:', supabaseKey?.length);

    const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error fetching session:', error);
        return;
    }

    console.log(`Found ${data?.length || 0} sessions.`);

    const session = data && data.length > 0 ? data[0] : null;

    if (!session) {
        console.log('No recent sessions found. (Check RLS or Table content)');
        return;
    }

    console.log('Latest Session:');
    console.log('ID:', session.id);
    console.log('Title:', session.title);
    console.log('Created At:', session.created_at);

    // Check canvas state
    if (session.canvas_state) {
        console.log('Canvas State Nodes:');
        const nodes = session.canvas_state.nodes || [];
        nodes.forEach((n: any) => {
            console.log(`- ID: "${n.id}" (Type: ${typeof n.id})`);
        });

        // Check for duplicates
        const ids = nodes.map((n: any) => n.id);
        const uniqueIds = new Set(ids);
        if (ids.length !== uniqueIds.size) {
            console.error('⚠️ DUPLICATE NODE IDS FOUND!');
            const seen = new Set();
            const duplicates = ids.filter((id: any) => {
                const isdup = seen.has(id);
                seen.add(id);
                return isdup;
            });
            console.error('Duplicates:', duplicates);
        } else {
            console.log('✅ No duplicate IDs found.');
        }
    } else {
        console.log('No canvas_state found.');
    }
})();
