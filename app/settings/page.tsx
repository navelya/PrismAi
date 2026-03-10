'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store/app-store';
import { useTheme } from '@/components/theme/ThemeProvider';

import { createClient } from '@/lib/supabase/client';
import { userApi } from '@/lib/api/client';
import { UserAvatar } from '@/components/ui/UserAvatar';
import {
    Settings,
    Network,
    Palette,
    Bell,
    Shield,
    Database,
    Zap,
    Check,
    Monitor,
    Sun,
    Moon,
    User,
    Lock,
    CreditCard,
    Coins,
    KeyRound,
    Plug,
    ChevronRight,
    ArrowLeft,
    Menu,
    Sparkles,
    X,
    Trash2,
    Loader2,
    LogOut,
    Plus,
} from 'lucide-react';

// =============================================================================
// TYPES
// =============================================================================

type TabId =
    | 'profile'
    | 'security'
    | 'editor-appearance'
    | 'notifications'
    | 'plan-billing'
    | 'usage'
    | 'api-keys'
    | 'integrations';

interface NavItem {
    id: TabId;
    label: string;
    icon: React.ReactNode;
    comingSoon?: boolean;
}

interface NavSection {
    title: string;
    items: NavItem[];
}

// =============================================================================
// NAVIGATION CONFIG
// =============================================================================

const navSections: NavSection[] = [
    {
        title: 'Account',
        items: [
            { id: 'profile', label: 'Public Profile', icon: <User className="w-4 h-4" /> },
            { id: 'security', label: 'Security', icon: <Lock className="w-4 h-4" />, comingSoon: true },
        ],
    },
    {
        title: 'Workspace',
        items: [
            { id: 'editor-appearance', label: 'Editor & Appearance', icon: <Palette className="w-4 h-4" /> },
            { id: 'notifications', label: 'Notifications', icon: <Bell className="w-4 h-4" />, comingSoon: true },
        ],
    },
    {
        title: 'Usage & Billing',
        items: [
            { id: 'plan-billing', label: 'Plan & Billing', icon: <CreditCard className="w-4 h-4" />, comingSoon: true },
            { id: 'usage', label: 'Token / Credit Usage', icon: <Coins className="w-4 h-4" />, comingSoon: true },
        ],
    },
    {
        title: 'Developer',
        items: [
            { id: 'api-keys', label: 'API Keys', icon: <KeyRound className="w-4 h-4" />, comingSoon: true },
            { id: 'integrations', label: 'Integrations', icon: <Plug className="w-4 h-4" />, comingSoon: true },
        ],
    },
];

// =============================================================================
// SHARED SETTING COMPONENTS (preserved exactly from original)
// =============================================================================

interface SettingCardProps {
    title: string;
    description: string;
    children: React.ReactNode;
    disabled?: boolean;
    layout?: 'stacked' | 'inline';
}

function SettingCard({ title, description, children, disabled = false, layout = 'stacked' }: SettingCardProps) {
    return (
        <div className={`
            py-8 border-b border-stroke-subtle last:border-0 transition-all duration-200
            ${disabled ? 'opacity-50 grayscale-[0.5] pointer-events-none' : ''}
        `}>
            {layout === 'stacked' ? (
                <div className="flex flex-col gap-4">
                    <div>
                        <div className="flex items-center gap-3">
                            <h3 className="font-medium text-content-primary">{title}</h3>
                            {disabled && (
                                <span className="px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase bg-surface-secondary border border-stroke-subtle text-content-tertiary rounded-full">
                                    Soon
                                </span>
                            )}
                        </div>
                        <p className="text-sm mt-1 text-content-secondary">{description}</p>
                    </div>
                    <div className="w-full">
                        {children}
                    </div>
                </div>
            ) : (
                <div className="flex items-start sm:items-center justify-between gap-6">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                            <h3 className="font-medium text-content-primary">{title}</h3>
                            {disabled && (
                                <span className="px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase bg-surface-secondary border border-stroke-subtle text-content-tertiary rounded-full">
                                    Soon
                                </span>
                            )}
                        </div>
                        <p className="text-sm mt-1 text-content-secondary">{description}</p>
                    </div>
                    <div className="shrink-0 mt-2 sm:mt-0">
                        {children}
                    </div>
                </div>
            )}
        </div>
    );
}

interface SelectOptionProps {
    value?: string;
    label: string;
    description?: string;
    selected: boolean;
    disabled?: boolean;
    onSelect: () => void;
    icon?: React.ReactNode;
}

function SelectOption({ value, label, description, selected, disabled, onSelect, icon }: SelectOptionProps) {
    return (
        <button
            onClick={onSelect}
            disabled={disabled}
            className={`
                w-full p-3 py-3.5 rounded-lg border-2 text-left transition-all duration-200 flex items-start gap-3 justify-between
                ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
                ${selected
                    ? 'border-accent-primary bg-accent-primary/5'
                    : 'border-stroke-subtle hover:border-stroke-strong bg-surface-primary'
                }
            `}
        >
            <div className="flex items-start gap-3 min-w-0 flex-1">
                {icon && (
                    <div className={`shrink-0 mt-0.5 ${selected ? 'text-accent-primary' : 'text-content-secondary'}`}>
                        {icon}
                    </div>
                )}
                <div className="min-w-0">
                    <div className={`font-medium text-sm ${selected ? 'text-accent-primary' : 'text-content-primary'}`}>
                        {label}
                    </div>
                    {description && (
                        <div className={`text-xs mt-1 leading-relaxed ${selected ? 'text-accent-primary/80' : 'text-content-secondary'}`}>
                            {description}
                        </div>
                    )}
                </div>
            </div>
            {/* Always render a 20x20 slot so text wrapping doesn't change upon selection */}
            {selected ? (
                <div className="w-5 h-5 shrink-0 rounded-full bg-accent-primary flex items-center justify-center mt-0.5 shadow-sm">
                    <Check className="w-3 h-3 text-content-inverted" strokeWidth={3} />
                </div>
            ) : (
                <div className="w-5 h-5 shrink-0" />
            )}
        </button>
    );
}

// =============================================================================
// COMING SOON PLACEHOLDER
// =============================================================================

function ComingSoonView({ title, description }: { title: string; description: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-surface-tertiary flex items-center justify-center mb-5">
                <Lock className="w-7 h-7 text-content-tertiary" />
            </div>
            <h3 className="text-xl font-semibold text-content-primary mb-2">{title}</h3>
            <p className="text-content-secondary text-sm max-w-sm">{description}</p>
            <span className="mt-4 px-3 py-1 text-xs font-medium bg-surface-tertiary text-content-tertiary rounded-full">
                Planned for a future update
            </span>
        </div>
    );
}

// =============================================================================
// TAB CONTENT VIEWS
// =============================================================================

function AccountProfileView({ user, onProfileUpdated }: { user: any, onProfileUpdated: () => void }) {
    const supabase = createClient();

    // Avatar states
    const [isUploading, setIsUploading] = useState(false);
    const [isImageLoading, setIsImageLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Display Name states
    const initialName = user.user_metadata?.display_name || user.user_metadata?.full_name || '';
    const [displayName, setDisplayName] = useState(initialName);
    const [savingName, setSavingName] = useState(false);
    const [nameError, setNameError] = useState<string | null>(null);

    const compressImage = (file: File, maxSize: number = 512): Promise<Blob> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target?.result as string;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    if (width > height && width > maxSize) {
                        height = Math.round((height * maxSize) / width);
                        width = maxSize;
                    } else if (height > maxSize) {
                        width = Math.round((width * maxSize) / height);
                        height = maxSize;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx?.drawImage(img, 0, 0, width, height);
                    canvas.toBlob(
                        (blob) => {
                            if (blob) resolve(blob);
                            else reject(new Error('Canvas to Blob failed'));
                        },
                        'image/jpeg',
                        0.85
                    );
                };
                img.onerror = (error) => reject(error);
            };
            reader.onerror = (error) => reject(error);
        });
    };

    const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        try {
            setError(null);
            setIsUploading(true);
            setIsImageLoading(true); // Prepare for the new image fetch after DB update

            if (!event.target.files || event.target.files.length === 0) {
                return;
            }

            const file = event.target.files[0];
            const fileExt = 'jpg'; // We convert to jpeg in compressImage
            const filePath = `${user.id}/${Math.random()}.${fileExt}`;

            // 1. Compress Image
            const compressedBlob = await compressImage(file, 512);

            // 2. Upload to Supabase Storage
            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(filePath, compressedBlob, { cacheControl: '3600', upsert: true, contentType: 'image/jpeg' });

            if (uploadError) throw uploadError;

            // 2. Get Public URL
            const { data: { publicUrl } } = supabase.storage
                .from('avatars')
                .getPublicUrl(filePath);

            // 3. Upsert to public.profiles table
            const { error: updateError } = await supabase
                .from('profiles')
                .upsert({
                    id: user.id,
                    avatar_url: publicUrl,
                    // keep existing preferences if any
                    preferences: user.profile?.preferences || {}
                });

            if (updateError) throw updateError;

            // 4. Delete old custom avatar if it existed to save S3 space
            const oldAvatarUrl = user.profile?.avatar_url;
            if (oldAvatarUrl && oldAvatarUrl.includes('/storage/v1/object/public/avatars/')) {
                // Extract just the "user_id/filename.jpg" portion from the full URL
                const urlParts = oldAvatarUrl.split('/avatars/');
                if (urlParts.length === 2) {
                    const oldFilePath = urlParts[1];
                    const { error: removeError } = await supabase.storage
                        .from('avatars')
                        .remove([oldFilePath]);

                    if (removeError) {
                        console.warn('Failed to delete old avatar:', removeError);
                    }
                }
            }

            // 5. Refresh user data globally
            onProfileUpdated();
            // Dispatch a global event so the Sidebar (and other components) know to re-fetch the user
            window.dispatchEvent(new Event('profile-updated'));

        } catch (error: any) {
            console.error('Error uploading avatar:', error);
            setError(error.message);
        } finally {
            setIsUploading(false);
        }
    };

    const handleSaveName = async () => {
        const trimmedName = displayName.trim();
        if (trimmedName.length < 2) {
            setNameError('Name must be at least 2 characters.');
            return;
        }

        try {
            setNameError(null);
            setSavingName(true);

            const { error } = await supabase.auth.updateUser({
                data: { display_name: trimmedName }
            });

            if (error) throw error;

            onProfileUpdated();
            window.dispatchEvent(new Event('profile-updated'));
        } catch (err: any) {
            console.error('Error updating name:', err);
            setNameError(err.message || 'Failed to update name');
        } finally {
            setSavingName(false);
        }
    };

    return (
        <div className="space-y-12 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div>
                <h2 className="text-xs font-semibold text-content-tertiary tracking-wider mb-6">
                    PROFILE PICTURE
                </h2>

                <div className="flex flex-col sm:flex-row items-center gap-8 py-6 border-b border-stroke-subtle">
                    <div className="relative w-24 h-24 rounded-full overflow-hidden shrink-0">
                        <UserAvatar
                            user={user}
                            className="w-full h-full"
                            onLoad={() => setIsImageLoading(false)}
                        />
                        {(isUploading || isImageLoading) && (
                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center backdrop-blur-sm">
                                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            </div>
                        )}
                    </div>

                    <div className="flex-1 space-y-3 text-center sm:text-left">
                        <div>
                            <input
                                type="file"
                                id="avatar-upload"
                                accept="image/*"
                                className="hidden"
                                ref={fileInputRef}
                                onChange={handleAvatarUpload}
                                disabled={isUploading || isImageLoading}
                            />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isUploading || isImageLoading}
                                className="px-4 py-2 bg-surface-tertiary hover:bg-interactive-hover text-content-primary rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
                            >
                                {isUploading ? 'Uploading...' : 'Change Avatar'}
                            </button>
                        </div>
                        <p className="text-xs text-content-secondary">
                            JPG, GIF or PNG. 1MB max.
                        </p>
                        {error && (
                            <p className="text-xs text-red-500">{error}</p>
                        )}
                    </div>
                </div>
            </div>

            <div>
                <h2 className="text-xs font-semibold text-content-tertiary tracking-wider mb-6">
                    DISPLAY NAME
                </h2>

                <SettingCard
                    title="Account Name"
                    description="Your name as it appears across the platform."
                    layout="stacked"
                >
                    <div className="space-y-2">
                        <div className="flex flex-col sm:flex-row gap-3">
                            <input
                                type="text"
                                value={displayName}
                                onChange={(e) => {
                                    setDisplayName(e.target.value);
                                    if (nameError) setNameError(null);
                                }}
                                disabled={savingName}
                                className="w-full sm:w-80 px-4 py-2 bg-surface-tertiary border border-stroke-subtle flex-1 sm:flex-none rounded-lg text-content-primary focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/20 transition-all disabled:opacity-50"
                                placeholder="Enter your display name"
                            />
                            <button
                                onClick={handleSaveName}
                                disabled={savingName || displayName.trim() === initialName || displayName.trim().length < 2}
                                className="px-5 py-2 bg-surface-tertiary hover:bg-interactive-hover text-content-primary rounded-lg font-medium text-sm transition-colors disabled:opacity-50 whitespace-nowrap"
                            >
                                {savingName ? 'Saving...' : 'Update Name'}
                            </button>
                        </div>
                        {nameError && (
                            <p className="text-xs text-red-500">{nameError}</p>
                        )}
                    </div>
                </SettingCard>
            </div>
        </div>
    );
}

function EditorAppearanceView({ user, onProfileUpdated }: { user: any, onProfileUpdated: () => void }) {
    const { theme: activeTheme, setTheme: setActiveTheme } = useTheme();


    // Initialize local state from DB preferences, falling back to current active state
    const [localTheme, setLocalTheme] = useState(user?.profile?.preferences?.theme || activeTheme);
    const [localEngine, setLocalEngine] = useState(user?.profile?.preferences?.layoutEngine || 'elk');

    const [saving, setSaving] = useState(false);

    // Determine baseline to check for unsaved changes
    const baselineTheme = user?.profile?.preferences?.theme || activeTheme;
    const baselineEngine = user?.profile?.preferences?.layoutEngine || 'elk';
    const hasChanges = localTheme !== baselineTheme || localEngine !== baselineEngine;



    const themes = [
        { id: 'modern-light', name: 'Modern Light', icon: <Sun className="w-4 h-4" />, description: 'Clean, professional light mode' },
        { id: 'modern-dark', name: 'Modern Dark', icon: <Moon className="w-4 h-4" />, description: 'Balanced high-contrast dark mode' },
        { id: 'system', name: 'System', icon: <Monitor className="w-4 h-4" />, description: 'Follow your system preference' },
        { id: 'midnight-slate', name: 'Midnight Slate', icon: <Database className="w-4 h-4" />, description: 'Deep slate with high-contrast text' },
        { id: 'emerald-aurora', name: 'Emerald Aurora', icon: <Sparkles className="w-4 h-4" />, description: 'Deep forest shades with emerald accents' },
        { id: 'sunset-vibe', name: 'Sunset Vibe', icon: <Sun className="w-4 h-4" />, description: 'Warm purple, orange and gold tones' },
        { id: 'oceanic-neon', name: 'Oceanic Neon', icon: <Zap className="w-4 h-4" />, description: 'Vibrant legacy cyan/teal highlights' },
    ];

    const handleSave = async () => {
        setSaving(true);
        try {
            const supabase = createClient();

            const newPrefs = {
                ...(user?.profile?.preferences || {}),
                theme: localTheme,
                layoutEngine: localEngine
            };

            const { error } = await supabase.from('profiles').upsert({
                id: user.id,
                preferences: newPrefs,
                avatar_url: user?.profile?.avatar_url || null, // preserve existing
            });

            if (error) throw error;

            // Apply changes globally
            // setActiveTheme(localTheme);
            // setLayoutEngine(localEngine);
            setActiveTheme(localTheme);

            // Fetch fresh profile state to container
            onProfileUpdated();

        } catch (e) {
            console.error('Failed to save preferences:', e);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-12 pb-24 relative">
            {/* Editor Section */}
            <div>
                <h2 className="text-xs font-semibold text-content-tertiary tracking-wider mb-6">
                    EDITOR
                </h2>
                <div className="flex flex-col">


                    <SettingCard
                        title="Auto-save"
                        description="Automatically save your workflow changes."
                        layout="inline"
                        disabled
                    >
                        <div className="w-11 h-6 bg-surface-tertiary rounded-full relative">
                            <div className="w-5 h-5 bg-content-tertiary rounded-full absolute left-0.5 top-0.5"></div>
                        </div>
                    </SettingCard>
                </div>
            </div>

            {/* Appearance Section */}
            <div>
                <h2 className="text-xs font-semibold text-content-tertiary tracking-wider mb-6">
                    APPEARANCE
                </h2>
                <div className="flex flex-col">
                    <SettingCard
                        title="Theme"
                        description="Choose between light and dark mode."
                        layout="stacked"
                    >
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {themes.map((t) => (
                                <SelectOption
                                    key={t.id}
                                    label={t.name}
                                    description={t.description}
                                    selected={localTheme === t.id}
                                    onSelect={() => setLocalTheme(t.id as any)}
                                    icon={t.icon}
                                />
                            ))}
                        </div>
                    </SettingCard>
                </div>
            </div>

            {/* Performance Section */}
            <div>
                <h2 className="text-xs font-semibold text-content-tertiary tracking-wider mb-6">
                    PERFORMANCE
                </h2>
                <div className="flex flex-col">
                    <SettingCard
                        title="Hardware Acceleration"
                        description="Use GPU acceleration for image processing tasks."
                        layout="inline"
                        disabled
                    >
                        <div className="w-11 h-6 bg-surface-tertiary rounded-full relative">
                            <div className="w-5 h-5 bg-content-tertiary rounded-full absolute left-0.5 top-0.5"></div>
                        </div>
                    </SettingCard>

                    <SettingCard
                        title="Usage Analytics"
                        description="Help improve PrismAI by sharing anonymous usage data."
                        layout="inline"
                        disabled
                    >
                        <div className="w-11 h-6 bg-surface-tertiary rounded-full relative">
                            <div className="w-5 h-5 bg-content-tertiary rounded-full absolute left-0.5 top-0.5"></div>
                        </div>
                    </SettingCard>
                </div>
            </div>

            {/* Save Changes Floating Action Bar */}
            {hasChanges && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 md:left-auto md:right-8 md:translate-x-0 bg-surface-primary border border-stroke-subtle shadow-2xl rounded-2xl p-3 flex items-center gap-4 animate-in slide-in-from-bottom-5">
                    <span className="text-sm text-content-secondary pl-2 whitespace-nowrap">Unsaved changes</span>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-5 py-2 bg-gradient-premium text-white font-medium rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                        {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            )}
        </div>
    );
}

// =============================================================================
// TAB CONTENT MAP
// =============================================================================

const comingSoonDescriptions: Record<string, { title: string; description: string }> = {
    profile: { title: 'Public Profile', description: 'Manage your display name, avatar, and bio visible across the platform.' },
    security: { title: 'Security', description: 'Configure two-factor authentication, manage sessions, and update your password.' },
    notifications: { title: 'Notifications', description: 'Control how and when you receive workflow completion alerts and system updates.' },
    'plan-billing': { title: 'Plan & Billing', description: 'View your current plan, manage subscriptions, and update payment methods.' },
    usage: { title: 'Token / Credit Usage', description: 'Monitor your API token consumption, credit balance, and usage history.' },
    'api-keys': { title: 'API Keys', description: 'Generate and manage API keys for programmatic access to PrismAI.' },
    integrations: { title: 'Integrations', description: 'Connect third-party services like Slack, GitHub, and cloud storage providers.' },
};

// =============================================================================
// MAIN SETTINGS PAGE
// =============================================================================

function SettingsContent() {
    const searchParams = useSearchParams();
    const router = useRouter();

    const validTabs: TabId[] = ['profile', 'security', 'editor-appearance', 'notifications', 'plan-billing', 'usage', 'api-keys', 'integrations'];
    const tabParam = searchParams.get('tab') as TabId | null;
    const activeTab: TabId = tabParam && validTabs.includes(tabParam) ? tabParam : 'profile';

    const [mobileShowContent, setMobileShowContent] = useState(false);
    const [user, setUser] = useState<any>(null);

    const fetchUser = async () => {
        try {
            const { user } = await userApi.me();
            if (user) setUser(user);
        } catch {
            // Not authenticated
            router.push('/login');
        }
    };

    useEffect(() => {
        fetchUser();
    }, []);

    const handleTabSelect = (id: TabId) => {
        router.replace(`/settings?tab=${id}`, { scroll: false });
        setMobileShowContent(true);
    };

    const renderContent = () => {
        if (!user) {
            return (
                <div className="flex justify-center py-20">
                    <div className="w-6 h-6 border-2 border-accent-primary border-t-transparent rounded-full animate-spin"></div>
                </div>
            );
        }

        if (activeTab === 'profile') {
            return <AccountProfileView user={user} onProfileUpdated={fetchUser} />;
        }

        if (activeTab === 'editor-appearance') {
            return <EditorAppearanceView user={user} onProfileUpdated={fetchUser} />;
        }

        const info = comingSoonDescriptions[activeTab];
        if (info) {
            return <ComingSoonView title={info.title} description={info.description} />;
        }

        return null;
    };

    // Find the currently selected nav item for the header
    const activeItem = navSections.flatMap(s => s.items).find(i => i.id === activeTab);

    return (
        <div className="w-full h-full flex bg-surface-secondary">
            {/* Sidebar Navigation — full width on mobile, fixed 264px on desktop */}
            <aside className={`
                md:w-64 md:shrink-0 md:border-r md:border-stroke-subtle md:bg-surface-primary md:overflow-y-auto md:block
                ${mobileShowContent ? 'hidden' : 'w-full bg-surface-primary overflow-y-auto'}
            `}>
                <div className="p-6">
                    <div className="flex items-center gap-3 mb-8">
                        <div className="p-2 rounded-xl bg-gradient-premium text-white shadow-lg">
                            <Settings className="w-5 h-5" />
                        </div>
                        <h1 className="text-lg font-bold text-content-primary">Settings</h1>
                    </div>

                    <nav className="space-y-6">
                        {navSections.map((section) => (
                            <div key={section.title}>
                                <h3 className="text-[11px] font-semibold text-content-tertiary uppercase tracking-wider mb-2 px-3">
                                    {section.title}
                                </h3>
                                <div className="space-y-0.5">
                                    {section.items.map((item) => (
                                        <button
                                            key={item.id}
                                            onClick={() => handleTabSelect(item.id)}
                                            className={`
                                                w-full flex items-center gap-3 px-3 py-2.5 md:py-2 rounded-lg text-sm transition-all duration-150
                                                ${activeTab === item.id
                                                    ? 'bg-accent-primary/10 text-accent-primary font-medium'
                                                    : 'text-content-secondary hover:bg-surface-tertiary hover:text-content-primary'
                                                }
                                            `}
                                        >
                                            <span className={`shrink-0 ${activeTab === item.id ? 'text-accent-primary' : 'text-content-tertiary'}`}>
                                                {item.icon}
                                            </span>
                                            <span className="flex-1 text-left truncate">{item.label}</span>
                                            {item.comingSoon && (
                                                <span className="px-1.5 py-0.5 text-[9px] font-medium bg-surface-tertiary text-content-tertiary rounded-full shrink-0">
                                                    Soon
                                                </span>
                                            )}
                                            <ChevronRight className={`w-3.5 h-3.5 shrink-0 md:hidden text-content-tertiary`} />
                                            {!item.comingSoon && activeTab === item.id && (
                                                <ChevronRight className="w-3.5 h-3.5 text-accent-primary shrink-0 hidden md:block" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </nav>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-stroke-subtle mt-4">
                    <p className="text-[11px] text-content-tertiary text-center">
                        PrismAI v1.0.0
                    </p>
                </div>
            </aside>

            {/* Main Content Area — hidden on mobile until a tab is selected */}
            <main className={`
                flex-1 overflow-y-auto
                ${mobileShowContent ? 'block' : 'hidden md:block'}
            `}>
                <div className="max-w-3xl mx-auto py-6 md:py-10 px-4 md:px-8">
                    {/* Mobile Back Button + Header */}
                    {activeItem && (
                        <div className="mb-8">
                            <button
                                onClick={() => setMobileShowContent(false)}
                                className="md:hidden flex items-center gap-2 text-sm text-content-secondary hover:text-content-primary mb-4 transition-colors"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                <span>Back to Settings</span>
                            </button>
                            <h2 className="text-2xl font-bold text-content-primary">{activeItem.label}</h2>
                        </div>
                    )}

                    {/* Dynamic Content */}
                    {renderContent()}
                </div>
            </main>
        </div>
    );
}

export default function SettingsPage() {
    return (
        <Suspense fallback={
            <div className="w-full h-full flex items-center justify-center bg-surface-secondary">
                <div className="w-8 h-8 border-4 border-accent-primary border-t-transparent rounded-full animate-spin"></div>
            </div>
        }>
            <SettingsContent />
        </Suspense>
    );
}
