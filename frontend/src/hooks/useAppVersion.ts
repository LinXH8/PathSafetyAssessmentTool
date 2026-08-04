import { useEffect, useState } from "react";
import { getAppVersion, type AppVersion } from "../api/updates";
import { APP_META } from "../appMeta";

/**
 * Live installed version + release date, sourced from the backend
 * (`GET /api/health`) rather than a hardcoded constant.
 *
 * The fetch promise is memoised at module level so every consumer — the landing
 * footer and the app sidebar — shares a SINGLE `/api/health` request for the
 * lifetime of the SPA session (same promise-cache idea as `projectDataCache`).
 * The promise is cleared on rejection so a transient failure can retry on the
 * next mount. Until it resolves (or if it fails), callers get the `APP_META`
 * fallback so the label is never blank.
 */

const FALLBACK: AppVersion = {
  version: APP_META.version,
  channel: "stable",
  released: APP_META.buildDate,
};

let cached: Promise<AppVersion> | null = null;

function loadAppVersion(): Promise<AppVersion> {
  if (!cached) {
    cached = getAppVersion().catch((err) => {
      cached = null; // allow a retry on the next mount
      throw err;
    });
  }
  return cached;
}

export function useAppVersion(): AppVersion {
  const [info, setInfo] = useState<AppVersion>(FALLBACK);

  useEffect(() => {
    let active = true;
    loadAppVersion()
      .then((v) => {
        if (active) setInfo(v);
      })
      .catch(() => {
        /* offline — keep the APP_META fallback */
      });
    return () => {
      active = false;
    };
  }, []);

  return info;
}
