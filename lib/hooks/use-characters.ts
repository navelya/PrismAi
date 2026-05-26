'use client';

import { useCallback, useEffect, useState } from 'react';
import { charactersApi, type Character, type CharacterInput } from '@/lib/api/client';

export function useCharacters(opts?: { includeDrafts?: boolean; includeShared?: boolean }) {
    const includeDrafts = opts?.includeDrafts ?? false;
    const includeShared = opts?.includeShared ?? false;
    const [characters, setCharacters] = useState<Character[]>([]);
    const [sharedCharacters, setSharedCharacters] = useState<Character[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const [mine, shared] = await Promise.all([
                charactersApi.list({ includeDrafts }),
                includeShared
                    ? charactersApi.list({ scope: 'shared' })
                    : Promise.resolve({ characters: [] as Character[] }),
            ]);
            setCharacters(mine.characters);
            setSharedCharacters(shared.characters);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load characters');
        } finally {
            setLoading(false);
        }
    }, [includeDrafts, includeShared]);

    useEffect(() => { load(); }, [load]);

    const createCharacter = useCallback(async (input: CharacterInput) => {
        const { character } = await charactersApi.create(input);
        setCharacters((prev) => [character, ...prev]);
        return character;
    }, []);

    // Save an in-progress character as a draft (editor dismissed without Cancel).
    // Only surface it locally when this hook instance shows drafts (assets page);
    // otherwise (side panel) the draft must NOT flash into the active list.
    const createDraft = useCallback(async (input: CharacterInput) => {
        const { character } = await charactersApi.create(input, { draft: true });
        if (includeDrafts) setCharacters((prev) => [character, ...prev]);
        return character;
    }, [includeDrafts]);

    const updateCharacter = useCallback(async (id: string, input: Partial<CharacterInput>) => {
        const { character } = await charactersApi.update(id, input);
        setCharacters((prev) => prev.map((c) => (c.id === id ? character : c)));
        return character;
    }, []);

    const deleteCharacter = useCallback(async (id: string) => {
        setCharacters((prev) => prev.filter((c) => c.id !== id));
        await charactersApi.delete(id);
    }, []);

    // Admin-only: toggle whether one of the user's OWN characters is shared.
    const setShared = useCallback(async (id: string, shared: boolean) => {
        const { character } = await charactersApi.setShared(id, shared);
        setCharacters((prev) => prev.map((c) => (c.id === id ? character : c)));
        return character;
    }, []);

    return {
        characters,
        sharedCharacters,
        loading,
        error,
        load,
        createCharacter,
        createDraft,
        updateCharacter,
        deleteCharacter,
        setShared,
    };
}
