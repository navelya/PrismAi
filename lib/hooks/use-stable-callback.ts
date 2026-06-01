import { useCallback, useRef } from 'react';

/**
 * Returns a function whose identity is STABLE for the component's lifetime but
 * which always invokes the latest `fn` passed in. Use it to hand an
 * inline/recreated-every-render handler to a `React.memo` child without
 * defeating the memo.
 *
 * Unlike `useCallback(fn, deps)` there is no dependency array, so there is no
 * stale-closure footgun: `ref.current` is refreshed every render and the
 * returned wrapper reads it at call time. The ref is assigned during render
 * (not in an effect) on purpose — the wrapper is only ever invoked later, from
 * event handlers, never during render, so it always sees the latest committed
 * `fn`. This avoids the `useLayoutEffect`-during-SSR warning in Next client
 * components.
 *
 * Trade-off: do NOT call the returned function during render.
 */
export function useStableCallback<T extends (...args: any[]) => any>(fn: T): T {
    const ref = useRef(fn);
    ref.current = fn;
    return useCallback(((...args: any[]) => ref.current(...args)) as T, []);
}
