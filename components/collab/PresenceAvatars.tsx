'use client';
import React from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { useShallow } from 'zustand/react/shallow';

export function PresenceAvatars() {
    const presence = useAppStore(useShallow((s) => s.presence));
    const people = Object.values(presence);
    if (people.length === 0) return null;
    return (
        <div className="flex items-center -space-x-2 pointer-events-auto">
            {people.slice(0, 5).map((p) => (
                <div key={p.userId} title={`${p.name} (${p.role})`}
                     className="w-7 h-7 rounded-full border-2 border-surface-elevated flex items-center justify-center text-[11px] text-white"
                     style={{ background: p.color }}>
                    {p.name?.[0]?.toUpperCase() || '?'}
                </div>
            ))}
            {people.length > 5 && <div className="w-7 h-7 rounded-full bg-surface-primary border-2 border-surface-elevated flex items-center justify-center text-[10px]">+{people.length - 5}</div>}
        </div>
    );
}
