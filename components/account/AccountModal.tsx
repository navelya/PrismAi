'use client';

import React, { useCallback, useEffect, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import {
    X,
    User,
    SlidersHorizontal,
    CreditCard,
    Coins,
    KeyRound,
    Users,
} from 'lucide-react';
import { useAppStore } from '@/lib/store/app-store';
import { userApi } from '@/lib/api/client';
import { Logo } from '@/components/ui/Logo';
import type { AccountTab } from '@/lib/store/types';
import { ProfileTab } from './ProfileTab';
import { PreferencesTab } from './PreferencesTab';
import { PlanPricingTab } from './PlanPricingTab';
import { CreditsBillingTab } from './CreditsBillingTab';
import { ComingSoonTab } from './ComingSoonTab';

interface NavItem {
    id: AccountTab;
    label: string;
    icon: React.ReactNode;
    soon?: boolean;
}

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
    {
        title: 'Account',
        items: [
            { id: 'profile', label: 'Profile', icon: <User className="w-4 h-4" /> },
            { id: 'preferences', label: 'Preferences', icon: <SlidersHorizontal className="w-4 h-4" /> },
        ],
    },
    {
        title: 'Workspace & Billing',
        items: [
            { id: 'plan-pricing', label: 'Plan & pricing', icon: <CreditCard className="w-4 h-4" /> },
            { id: 'credits-billing', label: 'Credits & billing', icon: <Coins className="w-4 h-4" /> },
        ],
    },
    {
        title: 'Developer',
        items: [
            { id: 'api-keys', label: 'API Keys', icon: <KeyRound className="w-4 h-4" />, soon: true },
            { id: 'members', label: 'Members', icon: <Users className="w-4 h-4" />, soon: true },
        ],
    },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export default function AccountModal() {
    const open = useAppStore((s) => s.accountModalOpen);
    const activeTab = useAppStore((s) => s.accountModalTab);
    const setTab = useAppStore((s) => s.openAccountModal);
    const close = useAppStore((s) => s.closeAccountModal);

    const [user, setUser] = useState<any>(null);

    const fetchUser = useCallback(async () => {
        try {
            const { user: u } = await userApi.me();
            if (u) setUser(u);
        } catch {
            // Not authenticated — leave the modal's loading state up.
        }
    }, []);

    // Lazy-load the user only once the modal is actually opened, and keep it in
    // sync with avatar/name edits made elsewhere.
    useEffect(() => {
        if (!open) return;
        if (!user) fetchUser();
        window.addEventListener('profile-updated', fetchUser);
        return () => window.removeEventListener('profile-updated', fetchUser);
    }, [open, user, fetchUser]);

    const activeItem = ALL_ITEMS.find((i) => i.id === activeTab) ?? ALL_ITEMS[0];

    const renderContent = () => {
        if (!user && (activeTab === 'profile' || activeTab === 'preferences')) {
            return (
                <div className="flex justify-center py-24">
                    <div className="w-6 h-6 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
                </div>
            );
        }
        switch (activeTab) {
            case 'profile':
                return <ProfileTab user={user} onProfileUpdated={fetchUser} />;
            case 'preferences':
                return <PreferencesTab user={user} onProfileUpdated={fetchUser} />;
            case 'plan-pricing':
                return <PlanPricingTab />;
            case 'credits-billing':
                return <CreditsBillingTab />;
            case 'api-keys':
                return (
                    <ComingSoonTab
                        icon={<KeyRound className="w-7 h-7" />}
                        title="API Keys"
                        description="Generate and manage API keys for programmatic access to Prisfol."
                    />
                );
            case 'members':
                return (
                    <ComingSoonTab
                        icon={<Users className="w-7 h-7" />}
                        title="Members"
                        description="Invite teammates and manage roles across your workspace."
                    />
                );
            default:
                return null;
        }
    };

    return (
        <RadixDialog.Root open={open} onOpenChange={(o) => !o && close()} modal={false}>
            <RadixDialog.Portal>
                {/* Plain backdrop (not RadixDialog.Overlay): with modal={false}
                    Radix doesn't lock the body or guarantee an overlay, so we own
                    the dim + click-to-close. Non-modal is deliberate — it keeps
                    nested body-portaled layers (PlansModal, Paddle's checkout
                    iframe) interactive, which a modal dialog's pointer-events lock
                    would otherwise kill. */}
                <div
                    onClick={close}
                    className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm animate-in fade-in-0"
                />
                <RadixDialog.Content
                    className="fixed left-1/2 top-1/2 z-[80] w-full max-w-5xl h-[86vh] max-h-[720px] -translate-x-1/2 -translate-y-1/2 m-4 flex flex-col sm:flex-row overflow-hidden rounded-2xl border border-stroke-strong/30 bg-surface-primary shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
                    // Closing is driven only by the X button, the backdrop's own
                    // onClick, and Escape. We suppress Radix's auto-close on
                    // outside interaction because the Plan tab can open nested
                    // billing modals (z-9998+) that portal OUTSIDE this content —
                    // clicking them would otherwise dismiss this modal and unmount
                    // the very dialog being clicked.
                    onPointerDownOutside={(e) => e.preventDefault()}
                    onInteractOutside={(e) => e.preventDefault()}
                >
                    <VisuallyHidden.Root>
                        <RadixDialog.Title>Your account</RadixDialog.Title>
                    </VisuallyHidden.Root>

                    {/* Sidebar nav */}
                    <aside className="flex-shrink-0 sm:w-60 border-b sm:border-b-0 sm:border-r border-stroke-subtle bg-white/[0.012] sm:overflow-y-auto">
                        <div className="hidden sm:flex items-center gap-2 px-5 pt-5 pb-3">
                            <Logo variant="mark" className="w-4 h-4" />
                            <span className="text-sm font-bold text-content-primary">Your account</span>
                        </div>
                        <nav className="flex sm:flex-col gap-1 p-2 sm:px-3 sm:pb-4 overflow-x-auto sm:overflow-visible">
                            {NAV_GROUPS.map((group) => (
                                <React.Fragment key={group.title}>
                                    <div className="hidden sm:block px-2 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-content-tertiary">
                                        {group.title}
                                    </div>
                                    {group.items.map((item) => {
                                        const isActive = activeTab === item.id;
                                        return (
                                            <button
                                                key={item.id}
                                                onClick={() => setTab(item.id)}
                                                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium whitespace-nowrap transition-colors ${
                                                    isActive
                                                        ? 'bg-white/[0.06] text-content-primary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
                                                        : 'text-content-tertiary hover:bg-white/[0.04] hover:text-content-secondary'
                                                }`}
                                            >
                                                <span className={isActive ? 'text-accent-primary' : 'text-content-tertiary'}>
                                                    {item.icon}
                                                </span>
                                                <span>{item.label}</span>
                                                {item.soon && (
                                                    <span className="ml-auto hidden sm:inline px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] text-content-tertiary border border-stroke-subtle rounded-md">
                                                        Soon
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </React.Fragment>
                            ))}
                        </nav>
                    </aside>

                    {/* Content */}
                    <section className="flex-1 min-w-0 flex flex-col">
                        <header className="flex items-center justify-between px-6 sm:px-8 pt-6 pb-4">
                            <h2 className="text-xl font-bold text-content-primary">{activeItem.label}</h2>
                            <RadixDialog.Close asChild>
                                <button
                                    className="p-2 -mr-1 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary transition-colors"
                                    aria-label="Close"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </RadixDialog.Close>
                        </header>
                        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 sm:px-8 pb-8">
                            {renderContent()}
                        </div>
                    </section>
                </RadixDialog.Content>
            </RadixDialog.Portal>
        </RadixDialog.Root>
    );
}
