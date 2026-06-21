'use client';

import React, { useRef, useState } from 'react';
import { LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { SectionLabel } from './primitives';

/** Downscale an uploaded avatar to a square-ish JPEG before upload. */
function compressImage(file: File, maxSize = 512): Promise<Blob> {
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
                    (blob) => (blob ? resolve(blob) : reject(new Error('Canvas to Blob failed'))),
                    'image/jpeg',
                    0.85,
                );
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
}

export function ProfileTab({ user, onProfileUpdated }: { user: any; onProfileUpdated: () => void }) {
    const supabase = createClient();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [isUploading, setIsUploading] = useState(false);
    const [isImageLoading, setIsImageLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const initialName = user.user_metadata?.display_name || user.user_metadata?.full_name || '';
    const [displayName, setDisplayName] = useState(initialName);
    const [savingName, setSavingName] = useState(false);
    const [nameError, setNameError] = useState<string | null>(null);

    const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        try {
            setError(null);
            setIsUploading(true);
            setIsImageLoading(true);

            if (!event.target.files || event.target.files.length === 0) return;
            const file = event.target.files[0];
            const filePath = `${user.id}/${Math.random()}.jpg`;
            const compressedBlob = await compressImage(file, 512);

            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(filePath, compressedBlob, { cacheControl: '3600', upsert: true, contentType: 'image/jpeg' });
            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath);

            const { error: updateError } = await supabase
                .from('profiles')
                .upsert({ id: user.id, avatar_url: publicUrl, preferences: user.profile?.preferences || {} });
            if (updateError) throw updateError;

            // Best-effort cleanup of the previous custom avatar to save storage.
            const oldAvatarUrl = user.profile?.avatar_url;
            if (oldAvatarUrl && oldAvatarUrl.includes('/storage/v1/object/public/avatars/')) {
                const urlParts = oldAvatarUrl.split('/avatars/');
                if (urlParts.length === 2) {
                    await supabase.storage.from('avatars').remove([urlParts[1]]).catch(() => {});
                }
            }

            onProfileUpdated();
            window.dispatchEvent(new Event('profile-updated'));
        } catch (err: any) {
            console.error('Error uploading avatar:', err);
            setError(err.message);
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
            const { error: err } = await supabase.auth.updateUser({ data: { display_name: trimmedName } });
            if (err) throw err;
            onProfileUpdated();
            window.dispatchEvent(new Event('profile-updated'));
        } catch (err: any) {
            console.error('Error updating name:', err);
            setNameError(err.message || 'Failed to update name');
        } finally {
            setSavingName(false);
        }
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        window.location.href = '/login';
    };

    return (
        <div className="space-y-8">
            {/* Identity card */}
            <div className="flex items-center gap-4 p-4 rounded-2xl bg-surface-elevated border border-stroke-subtle">
                <div className="relative w-16 h-16 rounded-full overflow-hidden shrink-0">
                    <UserAvatar user={user} className="w-full h-full" onLoad={() => setIsImageLoading(false)} />
                    {(isUploading || isImageLoading) && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center backdrop-blur-sm">
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        </div>
                    )}
                </div>
                <div className="min-w-0">
                    <div className="text-base font-bold text-content-primary truncate">
                        {user.user_metadata?.display_name || user.user_metadata?.full_name || 'User'}
                    </div>
                    <div className="text-sm text-content-tertiary truncate">{user.email}</div>
                </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3">
                {/* Off-screen, not `display:none` — a programmatically clicked
                    file input must stay rendered or some browsers never fire
                    `change` after selection. */}
                <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden="true"
                    ref={fileInputRef}
                    onChange={handleAvatarUpload}
                    disabled={isUploading || isImageLoading}
                />
                <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading || isImageLoading}
                    className="px-4 py-2 rounded-lg bg-surface-tertiary hover:bg-interactive-hover text-content-primary text-sm font-medium transition-colors disabled:opacity-50"
                >
                    {isUploading ? 'Uploading…' : 'Change avatar'}
                </button>
                <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary text-sm font-medium transition-colors"
                >
                    <LogOut className="w-4 h-4" />
                    Logout
                </button>
                {error && <p className="text-xs text-accent-error w-full">{error}</p>}
            </div>

            {/* Display name */}
            <div className="space-y-4">
                <SectionLabel>Display name</SectionLabel>
                <div className="flex flex-col sm:flex-row gap-3">
                    <input
                        type="text"
                        value={displayName}
                        onChange={(e) => {
                            setDisplayName(e.target.value);
                            if (nameError) setNameError(null);
                        }}
                        disabled={savingName}
                        className="w-full sm:max-w-xs px-4 py-2.5 bg-surface-elevated border border-stroke-subtle rounded-xl text-content-primary text-sm placeholder:text-content-tertiary/40 focus:outline-none focus:border-accent-primary/50 focus:ring-2 focus:ring-accent-primary/10 transition-all disabled:opacity-50"
                        placeholder="Enter your display name"
                    />
                    <button
                        onClick={handleSaveName}
                        disabled={savingName || displayName.trim() === initialName || displayName.trim().length < 2}
                        className="px-5 py-2.5 bg-surface-tertiary hover:bg-interactive-hover border border-stroke-subtle text-content-primary rounded-xl font-medium text-sm transition-all disabled:opacity-40 whitespace-nowrap"
                    >
                        {savingName ? 'Saving…' : 'Update name'}
                    </button>
                </div>
                {nameError && <p className="text-xs text-accent-error">{nameError}</p>}
                <p className="text-xs text-content-tertiary">Your name as it appears across the platform.</p>
            </div>
        </div>
    );
}
