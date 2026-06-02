'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { apiFetch } from '@/lib/api/client';

export default function ShareAcceptPage({ params }: { params: { token: string } }) {
    const router = useRouter();
    const [status, setStatus] = useState<'checking' | 'error'>('checking');
    const [message, setMessage] = useState('Opening your invitation…');

    useEffect(() => {
        (async () => {
            const supabase = createClient();
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.replace(`/login?next=${encodeURIComponent(`/share/${params.token}`)}`);
                return;
            }
            try {
                const res = await apiFetch<{ canvasId: string }>('/api/invites/accept', {
                    method: 'POST', body: JSON.stringify({ token: params.token }),
                });
                router.replace(`/chat/${res.canvasId}`);
            } catch (e: any) {
                setStatus('error');
                setMessage(e?.message || 'This invitation is invalid or was for a different email.');
            }
        })();
    }, [params.token, router]);

    return (
        <div className="min-h-screen flex items-center justify-center text-center p-6">
            <div>
                <p className={status === 'error' ? 'text-red-500' : 'text-content-secondary'}>{message}</p>
                {status === 'error' && (
                    <button onClick={() => router.replace('/')} className="mt-4 underline text-sm">Go home</button>
                )}
            </div>
        </div>
    );
}
