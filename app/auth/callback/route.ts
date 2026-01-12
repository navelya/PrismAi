import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get('code');
    const next = searchParams.get('next') ?? '/chat';

    if (code) {
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                auth: {
                    flowType: 'pkce',
                }
            }
        );

        const { data, error } = await supabase.auth.exchangeCodeForSession(code);

        if (!error && data.session) {
            // Manually set cookies for Middleware to read
            // The client-side library will also read this if we name it correctly
            // Default Supabase cookie name pattern: sb-<project-ref>-auth-token
            // We will stick to a simple name for our middleware for now or look up the ref

            // Actually, since we are using a custom cookie storage on client with specific settings,
            // we can just stick to a known cookie name if we control the reading.
            // BUT, supabase-js on the client naturally looks for its own internal key.
            // To make "exchangeCodeForSession" work seamlessly with client hydration, 
            // we generally rely on the CLIENT to do the exchange for simple setups, 
            // but Middleware protection demands SERVER knowledge.

            // Hybrid Approach:
            // Set a "session-active" cookie for Middleware.
            // The Client will handle its own session state via the URL hash if we redirect properly?
            // No, exchangeCodeForSession consumes the code.

            // We will set the session data into cookies that our Custom Storage Adapter on the client 
            // will happily read!

            // Our storage adapter reads "key". Supabase internal key is usually `sb-${ref}-auth-token`.
            // To be safe and simple, we will serialize the *entire* session to a cookie named 'supabase-auth-token'.
            // And update our client.ts to look for that key.

            const cookieStore = cookies();
            cookieStore.set('supabase-auth-token', JSON.stringify(data.session), {
                path: '/',
                maxAge: data.session.expires_in,
                sameSite: 'lax',
                secure: true,
            });
        }
    }

    // Redirect to final destination
    return NextResponse.redirect(`${origin}${next}`);
}
