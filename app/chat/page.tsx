import { cookies } from 'next/headers';
import ChatClientPage from './ChatClientPage';

export default function ChatPage() {
    const cookieStore = cookies();
    const tokenCookie = cookieStore.get('supabase-auth-token');

    let userName = '';

    if (tokenCookie?.value) {
        try {
            // The cookie might be URI encoded
            const decodedValue = decodeURIComponent(tokenCookie.value);
            const session = JSON.parse(decodedValue);

            // Extract display name or full name from user metadata
            userName = session.user?.user_metadata?.display_name ||
                session.user?.user_metadata?.full_name ||
                '';
        } catch (error) {
            console.error('Error parsing auth cookie:', error);
            // Fallback to client-side fetching if parsing fails
        }
    }

    return <ChatClientPage initialUserName={userName} />;
}
