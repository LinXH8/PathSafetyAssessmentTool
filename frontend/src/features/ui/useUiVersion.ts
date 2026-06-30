import { useEffect, useState } from "react";

/**
 * Single source of truth for which UI version renders.
 *
 * Resolution order (synchronous, safe to call at app root):
 *   1. URL `?ui=v1` / `?ui=v2`  → use it AND persist to localStorage.
 *   2. localStorage["psat:uiVersion"] → use it.
 *   3. default → "v1" (v1 is production until the swap).
 *
 * Flip live with `?ui=v2` / `?ui=v1`; the choice sticks per browser.
 * Note: the Chakra theme is picked from this flag at provider mount, so
 * changing the flag requires a reload to re-pick the theme.
 */
export type UiVersion = "v1" | "v2";

const KEY = "psat:uiVersion";

export function resolveUiVersion(): UiVersion {
  const param = new URLSearchParams(window.location.search).get("ui");
  if (param === "v1" || param === "v2") {
    localStorage.setItem(KEY, param);
    return param;
  }
  const stored = localStorage.getItem(KEY);
  return stored === "v2" ? "v2" : "v1";
}

export function useUiVersion(): UiVersion {
  const [version, setVersion] = useState<UiVersion>(resolveUiVersion);

  useEffect(() => {
    // Keep tabs in sync if the flag is changed elsewhere.
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setVersion(resolveUiVersion());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return version;
}
