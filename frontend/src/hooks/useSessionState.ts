import { useCallback, useState } from "react";

/**
 * Typed `useState` backed by sessionStorage.
 *
 * Behaves identically to React's `useState` but:
 *   - Seeds the initial value from sessionStorage on mount (so state survives
 *     route unmounts within the same SPA session without an extra `useEffect`).
 *   - Persists every `setState` call to sessionStorage immediately, before the
 *     React render, using the functional updater form so reads and writes are
 *     always consistent even with concurrent renders.
 *
 * Use a `SESSION_KEYS.*` constant from `constants/sessionKeys.ts` as the key —
 * never inline a raw string.
 *
 * **Shell restriction:** only call this hook from containers or custom hooks.
 * Layout shells must never touch sessionStorage (frontend/CLAUDE.md §0 rule 2).
 *
 * @param key          sessionStorage key — use a `SESSION_KEYS.*` constant.
 * @param defaultValue Returned when the key is absent or the stored value is
 *                     not valid JSON.
 * @returns `[value, setValue]` — same interface as React's `useState`.
 */
export function useSessionState<T>(
  key: string,
  defaultValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setStateRaw] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const setState = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStateRaw((prev) => {
        const next =
          typeof value === "function" ? (value as (prev: T) => T)(prev) : value;
        try {
          sessionStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* sessionStorage unavailable (private mode) — state update still applies in-memory */
        }
        return next;
      });
    },
    [key]
  );

  return [state, setState];
}
