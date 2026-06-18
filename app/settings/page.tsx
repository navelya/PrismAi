'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAppStore } from '@/lib/store/app-store';
import type { AccountTab } from '@/lib/store/types';

/**
 * The settings page is gone — account settings now live in a global modal
 * ("Your account") reachable from the sidebar profile menu. This route survives
 * only to honour legacy/deep links (e.g. post-checkout `successUrl` redirects):
 * it opens the modal at the requested tab and bounces the user to /chat so
 * there's real content behind the overlay.
 */
const TAB_MAP: Record<string, AccountTab> = {
    // New ids (pass-through)
    profile: 'profile',
    preferences: 'preferences',
    'plan-pricing': 'plan-pricing',
    'credits-billing': 'credits-billing',
    'api-keys': 'api-keys',
    members: 'members',
    // Legacy ids from the old /settings tabs
    'editor-appearance': 'preferences',
    'plan-billing': 'plan-pricing',
    usage: 'credits-billing',
};

function SettingsRedirect() {
    const router = useRouter();
    const params = useSearchParams();

    useEffect(() => {
        const raw = params.get('tab') ?? '';
        const tab = TAB_MAP[raw] ?? 'profile';
        useAppStore.getState().openAccountModal(tab);
        router.replace('/chat');
    }, [params, router]);

    return (
        <div className="w-full h-full flex items-center justify-center bg-surface-secondary">
            <div className="w-8 h-8 border-4 border-accent-primary border-t-transparent rounded-full animate-spin" />
        </div>
    );
}

export default function SettingsPage() {
    return (
        <Suspense
            fallback={
                <div className="w-full h-full flex items-center justify-center bg-surface-secondary">
                    <div className="w-8 h-8 border-4 border-accent-primary border-t-transparent rounded-full animate-spin" />
                </div>
            }
        >
            <SettingsRedirect />
        </Suspense>
    );
}
