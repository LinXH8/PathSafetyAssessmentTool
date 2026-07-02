import { useEffect, useState } from "react";

/**
 * Single source of truth for which UI version renders.
 *
 * Resolution order (synchronous, safe to call at app root):
 *   1. URL `?ui=v1` / `?ui=v2`  → use it AND persist to localStorage.
 *   2. localStorage["psat:uiVersion"] → use it.
 *   3. default → "v2" (v2 is the production default since the swap; an explicit
 *      stored "v1" is still honoured so testers can pin the old UI).
 *
 * Flip live with `?ui=v2` / `?ui=v1`; the choice sticks per browser.
 * Note: the Chakra theme is picked from this flag at provider mount, so
 * changing the flag requires a reload to re-pick the theme.
 *
 * FUTURE PLAN — remove v1 entirely once v2 has been stable in internal use with
 * no rollback needed. v1/v2 are interchangeable siblings, so this is clean
 * deletion, not surgery:
 *   1. Delete every `*LayoutV1.tsx`.
 *   2. In each page container, drop the `useUiVersion()` branch and render v2
 *      unconditionally.
 *   3. Collapse the `variant?: "v1" | "v2"` props on shared components
 *      (GeoDataPanel, AttributesPanel, PathAnalysisMapView, FilterPanel, etc.)
 *      to v2-only; delete v1-only chrome.
 *   4. Remove the inline `isV2` branches (reportBuilderPage, GisLayersPage) and
 *      v1-only CSS (sidebar.css vs sidebar-v2.css).
 *   5. Delete this file + the v1 Chakra theme in provider.tsx.
 * Do NOT start until v2 is confirmed stable. (Fuller checklist in CLAUDE.md.)
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
  return stored === "v1" ? "v1" : "v2";
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
