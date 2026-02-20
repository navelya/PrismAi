import React from 'react';
import { User } from 'lucide-react';

interface UserAvatarProps {
    user: any;
    className?: string;
    showStatus?: boolean;
    onLoad?: () => void;
}

/**
 * A reusable avatar component that implements a strict 3-tier fallback hierarchy:
 * 1. Supabase Custom Profile Avatar (public.profiles.avatar_url)
 * 2. Google OAuth Provider Avatar (user.user_metadata.avatar_url)
 * 3. Text Fallback (first letter of email) or User Icon
 */
export function UserAvatar({ user, className = '', showStatus = false, onLoad }: UserAvatarProps) {
    if (!user) {
        return (
            <div className={`relative group ${className}`}>
                <div className="w-full h-full rounded-full bg-surface-tertiary flex items-center justify-center text-content-tertiary">
                    <User className="w-1/2 h-1/2" />
                </div>
            </div>
        );
    }

    // 1. Check custom profile avatar first
    let avatarUrl = user.profile?.avatar_url;

    // 2. Fallback to OAuth metadata avatar
    if (!avatarUrl && user.user_metadata?.avatar_url) {
        avatarUrl = user.user_metadata.avatar_url;
    }

    // 3. Fallback to Initials
    const initials = user.email?.[0]?.toUpperCase() || '?';

    return (
        <div className={`relative group ${className}`}>
            <div className="w-full h-full rounded-full bg-gradient-premium flex items-center justify-center text-white font-medium shadow-md ring-2 ring-white/10 overflow-hidden">
                {avatarUrl ? (
                    <img
                        src={avatarUrl}
                        alt={user.email || 'User Avatar'}
                        className="w-full h-full object-cover"
                        onLoad={onLoad}
                    />
                ) : (
                    <span onLoad={onLoad}>{initials}</span>
                )}
            </div>

            {/* Optional Online Status Indicator */}
            {showStatus && (
                <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-surface-secondary rounded-full"></div>
            )}
        </div>
    );
}
