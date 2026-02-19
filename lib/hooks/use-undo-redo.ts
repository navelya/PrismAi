import { useState, useCallback, useEffect, useRef } from 'react';

// Use a type that can be anything (generic)
export interface UndoRedoOptions<T> {
    limit?: number; // Max history length
    enableShortcuts?: boolean; // Enable Ctrl+Z / Ctrl+Y
}

export interface UndoRedoState<T> {
    past: T[];
    present: T;
    future: T[];
}

export interface SetOptions {
    history?: 'ignore' | 'push' | 'replace';
}

export function useUndoRedo<T>(initialState: T, options: UndoRedoOptions<T> = {}) {
    const { limit = 50, enableShortcuts = true } = options;

    const [state, setState] = useState<UndoRedoState<T>>({
        past: [],
        present: initialState,
        future: [],
    });

    // Refs for shortcut handler access to state without stale closures
    const stateRef = useRef(state);
    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    const canUndo = state.past.length > 0;
    const canRedo = state.future.length > 0;

    const undo = useCallback(() => {
        setState((currentState) => {
            if (currentState.past.length === 0) return currentState;

            const previous = currentState.past[currentState.past.length - 1];
            const newPast = currentState.past.slice(0, currentState.past.length - 1);

            return {
                past: newPast,
                present: previous,
                future: [currentState.present, ...currentState.future],
            };
        });
    }, []);

    const redo = useCallback(() => {
        setState((currentState) => {
            if (currentState.future.length === 0) return currentState;

            const next = currentState.future[0];
            const newFuture = currentState.future.slice(1);

            return {
                past: [...currentState.past, currentState.present],
                present: next,
                future: newFuture,
            };
        });
    }, []);

    const set = useCallback((newPresent: T | ((prev: T) => T), setOptions: SetOptions = {}) => {
        const { history = 'push' } = setOptions;

        setState((currentState) => {
            const resolvedPresent = (typeof newPresent === 'function')
                ? (newPresent as (prev: T) => T)(currentState.present)
                : newPresent;

            if (history === 'ignore') {
                // Just update present, don't touch stacks
                return {
                    ...currentState,
                    present: resolvedPresent,
                    future: [], // Clear future on deviation
                };
            }

            if (history === 'replace') {
                return {
                    ...currentState,
                    present: resolvedPresent,
                    future: [], // Clear future on deviation
                };
            }

            // Default: 'push'
            const contentToPush = currentState.present;
            let newPast = [...currentState.past, contentToPush];

            if (limit && newPast.length > limit) {
                newPast = newPast.slice(newPast.length - limit);
            }

            return {
                past: newPast,
                present: resolvedPresent,
                future: [], // Clear future on new branch
            };
        });
    }, [limit]);

    const reset = useCallback((newPresent: T) => {
        setState({
            past: [],
            present: newPresent,
            future: [],
        });
    }, []);

    // Keyboard Shortcuts
    useEffect(() => {
        if (!enableShortcuts) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Check for Ctrl (or Cmd on Mac)
            const isCtrlOrCmd = e.ctrlKey || e.metaKey;

            if (!isCtrlOrCmd) return;

            if (e.key === 'z') {
                if (e.shiftKey) {
                    // Ctrl+Shift+Z -> Redo
                    e.preventDefault();
                    redo();
                } else {
                    // Ctrl+Z -> Undo
                    e.preventDefault();
                    undo();
                }
            } else if (e.key === 'y') {
                // Ctrl+Y -> Redo
                e.preventDefault();
                redo();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [enableShortcuts, undo, redo]); // undo/redo are stable

    return {
        state: state.present,
        set,
        undo,
        redo,
        canUndo,
        canRedo,
        reset,
        history: state // specific requested property 'state' which usually means present, but return full state if needed for debug
    };
}
