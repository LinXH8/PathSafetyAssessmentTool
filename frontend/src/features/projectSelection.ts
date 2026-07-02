import { useCallback, useEffect, useState } from "react";

/**
 * Shared project-selection store. The Home page (pages/Projects) and the v2
 * sidebar Quick Select both drive the SAME selection through this hook, so the
 * two can never drift:
 *
 *   - Select projects on Home  → Quick Select shows them checked.
 *   - Navigate to Coding/etc.  → Quick Select still remembers them (the sidebar
 *     stays mounted, and the value is persisted to sessionStorage so a remount
 *     restores it too).
 *   - Uncheck in Quick Select  → Home reflects it when you return.
 *
 * The selection lives in sessionStorage (survives navigation within the SPA
 * session, clears on a fresh tab) and is broadcast live via a CustomEvent so
 * every mounted consumer updates in the same tick.
 */

const KEY = "psat:projectSelection";
const EVENT = "psat:projectSelection:updated";

function read(): string[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(names: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(names));
  } catch {
    /* sessionStorage may be unavailable (private mode) — degrade to event-only */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: names }));
}

type Updater = Set<string> | ((prev: Set<string>) => Set<string>);

export function useProjectSelection(): [Set<string>, (updater: Updater) => void] {
  const [selected, setSelectedState] = useState<Set<string>>(() => new Set(read()));

  // Live-sync from any other consumer (same tab via CustomEvent, other tabs via
  // the native storage event).
  useEffect(() => {
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail as string[] | undefined;
      setSelectedState(new Set(Array.isArray(detail) ? detail : read()));
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setSelectedState(new Set(read()));
    };
    window.addEventListener(EVENT, onUpdate);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onUpdate);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setSelected = useCallback((updater: Updater) => {
    setSelectedState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      write(Array.from(next));
      return next;
    });
  }, []);

  return [selected, setSelected];
}
