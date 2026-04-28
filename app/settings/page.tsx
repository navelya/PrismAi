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
            py-8 border-b border-white/5 last:border-0 transition-all duration-300
            ${disabled ? 'opacity-40 grayscale-[0.8] pointer-events-none' : ''}
        `}>
            {layout === 'stacked' ? (
                <div className="flex flex-col gap-5">
                    <div>
                        <div className="flex items-center gap-3">
                            <h3 className="font-bold text-content-primary text-sm uppercase tracking-tight">{title}</h3>
                            {disabled && (
                                <span className="px-2 py-0.5 text-[9px] font-black tracking-[0.15em] uppercase bg-white/5 border border-white/10 text-content-tertiary rounded-full">
                                    Soon
                                </span>
                            )}
                        </div>
                        <p className="text-xs mt-2 text-content-tertiary leading-relaxed opacity-70">{description}</p>
                    </div>
                    <div className="w-full">
                        {children}
                    </div>
                </div>
            ) : (
                <div className="flex items-start sm:items-center justify-between gap-8">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                            <h3 className="font-bold text-content-primary text-sm uppercase tracking-tight">{title}</h3>
                            {disabled && (
                                <span className="px-2 py-0.5 text-[9px] font-black tracking-[0.15em] uppercase bg-white/5 border border-white/10 text-content-tertiary rounded-full">
                                    Soon
                                </span>
                            )}
                        </div>
                        <p className="text-xs mt-2 text-content-tertiary leading-relaxed opacity-70">{description}</p>
                    </div>
                    <div className="shrink-0">
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
                w-full p-4 py-5 rounded-2xl border transition-all duration-300 flex items-start gap-4 justify-between group
                ${disabled ? 'cursor-not-allowed opacity-40 grayscale' : 'cursor-pointer hover:scale-[1.02] active:scale-[0.98]'}
                ${selected
                    ? 'border-accent-primary bg-accent-primary/5 shadow-[0_0_20px_rgba(var(--accent-primary-rgb),0.1)]'
                    : 'border-white/10 hover:border-white/20 bg-white/5 shadow-xl'
                }
            `}
        >
            <div className="flex items-start gap-4 min-w-0 flex-1">
                {icon && (
                    <div className={`shrink-0 mt-1 transition-colors ${selected ? 'text-accent-primary' : 'text-content-tertiary group-hover:text-content-secondary'}`}>
                        {icon}
                    </div>
                )}
                <div className="min-w-0">
                    <div className={`font-bold text-sm uppercase tracking-tight ${selected ? 'text-accent-primary' : 'text-content-primary opacity-90'}`}>
                        {label}
                    </div>
                    {description && (
                        <div className={`text-[10px] mt-2 leading-relaxed font-medium transition-opacity ${selected ? 'text-accent-primary/70' : 'text-content-tertiary group-hover:opacity-100 opacity-60'}`}>
                            {description}
                        </div>
                    )}
                </div>
            </div>
            {selected ? (
                <div className="w-6 h-6 shrink-0 rounded-full bg-accent-primary flex items-center justify-center mt-1 shadow-premium">
                    <Check className="w-3.5 h-3.5 text-white" strokeWidth={4} />
                </div>
            ) : (
                <div className="w-6 h-6 shrink-0 rounded-full border border-white/10 group-hover:border-white/20 mt-1 transition-colors" />
            )}
        </button>
    );
}

// =============================================================================
// COMING SOON PLACEHOLDER
// =============================================================================

function ComingSoonView({ title, description }: { title: string; description: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-24 text-center animate-in fade-in zoom-in-95 duration-500">
            <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center mb-8 border border-white/10 shadow-2xl relative group">
                <div className="absolute inset-0 bg-accent-primary/20 blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <Lock className="w-8 h-8 text-content-tertiary relative z-10" />
            </div>
            <h3 className="text-2xl font-black text-content-primary mb-3 uppercase tracking-tighter">{title}</h3>
            <p className="text-content-tertiary text-xs max-w-sm leading-relaxed font-medium opacity-70">{description}</p>
            <div className="mt-8 flex items-center gap-3 px-4 py-2 bg-white/5 border border-white/10 rounded-2xl text-[10px] font-black text-content-tertiary uppercase tracking-widest">
                <Sparkles className="w-3 h-3 text-accent-primary" />
                Feature Roadmap
            </div>
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
                    <div className="flex flex-col sm:flex-row gap-4">
                        <input
                            type="text"
                            value={displayName}
                            onChange={(e) => {
                                setDisplayName(e.target.value);
                                if (nameError) setNameError(null);
                            }}
                            disabled={savingName}
                            className="w-full sm:w-80 px-5 py-3 bg-white/5 border border-white/10 flex-1 sm:flex-none rounded-xl text-content-primary text-sm placeholder:text-content-tertiary/30 focus:outline-none focus:border-accent-primary/50 focus:ring-4 focus:ring-accent-primary/10 transition-all disabled:opacity-50"
                            placeholder="Enter your display name"
                        />
                        <button
                            onClick={handleSaveName}
                            disabled={savingName || displayName.trim() === initialName || displayName.trim().length < 2}
                            className="px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-content-primary rounded-xl font-bold text-[10px] uppercase tracking-widest transition-all disabled:opacity-50 whitespace-nowrap hover:scale-[1.02] active:scale-[0.98]"
                        >
                            {savingName ? 'Saving...' : 'Update Name'}
                        </button>
                    </div>
                    {nameError && (
                        <p className="text-xs text-red-500">{nameError}</p>
                    )}
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
                        description="Help improve Prisfol by sharing anonymous usage data."
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
                <div className="fixed bottom-10 left-1/2 -translate-x-1/2 md:left-auto md:right-12 md:translate-x-0 glassmorphism shadow-2xl rounded-3xl p-4 flex items-center gap-6 animate-in slide-in-from-bottom-10 duration-500 z-50">
                    <div className="flex items-center gap-3 pl-2">
                        <div className="w-2 h-2 rounded-full bg-accent-primary animate-pulse shadow-[0_0_10px_rgba(var(--accent-primary-rgb),0.5)]"></div>
                        <span className="text-[10px] font-black text-content-primary uppercase tracking-widest whitespace-nowrap">Unsaved modifications</span>
                    </div>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-8 py-3 bg-gradient-premium text-white font-black uppercase tracking-widest text-[10px] rounded-2xl hover:opacity-90 transition-all disabled:opacity-50 shadow-premium hover:scale-[1.05] active:scale-[0.95]"
                    >
                        {saving ? 'Synchronizing...' : 'Commit Changes'}
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
    'api-keys': { title: 'API Keys', description: 'Generate and manage API keys for programmatic access to Prisfol.' },
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
        <div className="w-full h-full flex bg-surface-primary mesh-gradient overflow-hidden">
            {/* Sidebar Navigation — full width on mobile, fixed 264px on desktop */}
            <aside className={`
                md:w-72 md:shrink-0 md:border-r md:border-white/5 bg-surface-primary/60 backdrop-blur-3xl md:overflow-y-auto md:block shadow-2xl z-20 transition-all duration-300
                ${mobileShowContent ? 'hidden' : 'w-full bg-surface-primary overflow-y-auto'}
            `}>
                <div className="p-8">
                    <div className="flex items-center gap-4 mb-10">
                        <div className="w-10 h-10 rounded-2xl bg-gradient-premium flex items-center justify-center text-white shadow-premium ring-4 ring-white/5">
                            <Settings className="w-5 h-5" />
                        </div>
                        <div>
                            <h1 className="text-xl font-black text-content-primary uppercase tracking-tighter">Settings</h1>
                            <p className="text-[10px] font-bold text-content-tertiary uppercase tracking-widest mt-0.5 opacity-60">Preferences Hub</p>
                        </div>
                    </div>

                    <nav className="space-y-8">
                        {navSections.map((section) => (
                            <div key={section.title}>
                                <h3 className="text-[10px] font-black text-content-tertiary uppercase tracking-[0.2em] mb-4 px-3 opacity-60">
                                    {section.title}
                                </h3>
                                <div className="space-y-1.5">
                                    {section.items.map((item) => (
                                        <button
                                            key={item.id}
                                            onClick={() => handleTabSelect(item.id)}
                                            className={`
                                                w-full flex items-center gap-4 px-4 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all duration-300 border
                                                ${activeTab === item.id
                                                    ? 'bg-white/10 text-accent-primary border-white/10 shadow-premium ring-1 ring-white/10'
                                                    : 'text-content-tertiary border-transparent hover:bg-white/5 hover:text-content-primary hover:border-white/5'
                                                }
                                            `}
                                        >
                                            <span className={`shrink-0 transition-colors ${activeTab === item.id ? 'text-accent-primary' : 'text-content-tertiary group-hover:text-content-secondary'}`}>
                                                {item.icon}
                                            </span>
                                            <span className="flex-1 text-left truncate">{item.label}</span>
                                            {item.comingSoon && (
                                                <span className="px-2 py-0.5 text-[8px] font-black bg-white/5 text-content-tertiary rounded-full shrink-0 border border-white/10">
                                                    Soon
                                                </span>
                                            )}
                                            <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${activeTab === item.id ? 'translate-x-1 opacity-100' : 'opacity-0'}`} />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </nav>
                </div>

                {/* Footer */}
                <div className="p-8 border-t border-white/5 mt-8 bg-black/10">
                    <div className="flex items-center justify-center gap-2 opacity-40">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                        <p className="text-[9px] font-black text-content-tertiary uppercase tracking-[0.3em]">
                            System v1.0.0
                        </p>
                    </div>
                </div>
            </aside>

            {/* Main Content Area — hidden on mobile until a tab is selected */}
            <main className={`
                flex-1 overflow-y-auto custom-scrollbar relative
                ${mobileShowContent ? 'block' : 'hidden md:block'}
            `}>
                <div className="max-w-4xl mx-auto py-12 md:py-20 px-8 md:px-12 relative z-10">
                    {/* Mobile Back Button + Header */}
                    {activeItem && (
                        <div className="mb-12">
                            <button
                                onClick={() => setMobileShowContent(false)}
                                className="md:hidden flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-content-tertiary hover:text-content-primary mb-6 transition-all"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                <span>Return to Terminal</span>
                            </button>
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10 shadow-2xl">
                                    <span className="text-accent-primary">{activeItem.icon}</span>
                                </div>
                                <div>
                                    <p className="text-[10px] font-black text-accent-primary uppercase tracking-[0.3em] mb-1">Preference Section</p>
                                    <h2 className="text-4xl font-black text-content-primary uppercase tracking-tighter italic">{activeItem.label}</h2>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Dynamic Content */}
                    <div className="relative">
                        {renderContent()}
                    </div>
                </div>

                {/* Decorative mesh detail */}
                <div className="absolute top-0 right-0 w-96 h-96 bg-accent-primary/5 blur-[120px] rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
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
