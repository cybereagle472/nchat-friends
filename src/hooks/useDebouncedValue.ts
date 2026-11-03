import { useEffect, useState } from 'react';

/**
 * Returns a version of `value` that only updates after it's stopped
 * changing for `delayMs`. Used by every live/real-time search bar in the
 * app that needs to query the server as the user types (e.g. Discover's
 * "Find people" tab) without firing a network request on every single
 * keystroke — only once typing actually pauses.
 *
 * This intentionally debounces the *value*, not the callback, so it
 * composes cleanly with a plain `useEffect([debouncedQuery])` at the
 * call site instead of every caller having to manage its own timer.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
