'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import ChatClientPage from './ChatClientPage';

export default function ChatLayout({ children }: { children: React.ReactNode }) {
    const params = useParams();
    const sessionId = (Array.isArray(params?.id) ? params.id[0] : params?.id) as string | undefined;

    return (
        <div className="relative w-full h-full flex flex-col">
            <div className="flex-1 w-full h-full relative">
                <ChatClientPage key="shared-chat-client" sessionId={sessionId} />
                {children}
            </div>
        </div>
    );
}
