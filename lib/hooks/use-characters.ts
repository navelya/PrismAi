'use client';

import { useCallback, useEffect, useState } from 'react';
import { charactersApi, type Character, type CharacterInput } from '@/lib/api/client';

export function useCharacters() {
    const [characters, setCharacters] = useState<Character[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const { characters } = await charactersApi.list();
            setCharacters(characters);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load characters');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const createCharacter = useCallback(async (input: CharacterInput) => {
        const { character } = await charactersApi.create(input);
        setCharacters((prev) => [character, ...prev]);
        return character;
    }, []);

    const updateCharacter = useCallback(async (id: string, input: Partial<CharacterInput>) => {
        const { character } = await charactersApi.update(id, input);
        setCharacters((prev) => prev.map((c) => (c.id === id ? character : c)));
        return character;
    }, []);

    const deleteCharacter = useCallback(async (id: string) => {
        setCharacters((prev) => prev.filter((c) => c.id !== id));
        await charactersApi.delete(id);
    }, []);

    return { characters, loading, error, load, createCharacter, updateCharacter, deleteCharacter };
}
