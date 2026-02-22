import { cookies } from 'next/headers';
import ChatClientPage from './ChatClientPage';

export default function ChatPage() {
    const cookieStore = cookies();
    const tokenStr = cookieStore.get('auth_token')?.value;

    let initialUserName = undefined;
    if (tokenStr) {
        try {
            const token = JSON.parse(tokenStr);
            initialUserName = token.user?.user_metadata?.username;
        } catch (e) {
            console.error('Failed to parse auth_token cookie:', e);
        }
    }

    // Pass undefined for sessionId to ensure ChatClientPage resets the state for a new chat
    return <ChatClientPage key="new-chat" sessionId={undefined} initialUserName={initialUserName} />;
}
