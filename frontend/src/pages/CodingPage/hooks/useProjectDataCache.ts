import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { FeatureCollection } from "geojson";

import {
  fetchProjectDetail,
  fetchProjectAttributes,
  fetchProjectGeoJSON,
  fetchProjectMetadata,
  fetchCustomAttrOptions,
  calculateScore,
  updateProject,
} from "../../../api";
import type { AttributeRow, AttributesResponse } from "../../../api";
import { getCachedAttributeMappingsSync, getCachedAttributeMappings } from "../../../api/projectDataCache";
import { toaster } from "../../../components/ui/toaster";
import type { AttrMappings, ProjectDataState } from "../codingConstants";
import { migrateAttrRows } from "../codingHelpers";

/**
 * Module-level singletons that back useProjectDataCache. They live at module scope
 * (NOT React state) so the loaded project data survives navigating away to another
 * page (e.g. Help) and back without a re-fetch, and so async handlers can read the
 * latest snapshot without stale closures.
 *
 * - `defaultProjectData` — the empty/default per-project state shape.
 * - `projectDataCache` — project name → last-known ProjectDataState (survives remount).
 * - `savedAttrsSnapshot` — project name → attrs as last loaded/saved from the backend,
 *   used to detect genuine unsaved changes vs. the in-memory `isDirty` flag.
 *
 * Exported because the autocode and attribute-editing hooks (and a couple of
 * container handlers) read these same singletons directly.
 */
export const defaultProjectData: ProjectDataState = {
  detail: null,
  attrs: [],
  geoFeatures: [],
  scores: [],
  currentPage: 1,
  changedFieldsByRow: {},
  fieldSourcesByRow: {},
  loading: true,
  error: null,
  editedRow: null,
  isDirty: false,
};

// Global cache for project data to prevent reloading when navigating away and back (e.g. to Help page)
export const projectDataCache: Record<string, ProjectDataState> = {};

// Snapshot of attrs as last loaded/saved from backend — used to detect real changes vs. isDirty flag
export const savedAttrsSnapshot: Record<string, AttributeRow[]> = {};

/**
 * Empty both singletons in place (other modules hold them by reference).
 *
 * Both maps are keyed by project name only, so when a different profile signs
 * in on this tab it must never inherit the previous profile's rows, unsaved
 * edits or saved-attrs snapshot for a same-named (e.g. shared) project.
 * ProfileProvider fires "psat:profile:changed" on login, logout and a forced
 * logout; listening here keeps the provider free of page imports.
 */
export function clearProjectDataCache(): void {
  for (const key of Object.keys(projectDataCache)) delete projectDataCache[key];
  for (const key of Object.keys(savedAttrsSnapshot)) delete savedAttrsSnapshot[key];
}

if (typeof window !== "undefined") {
  window.addEventListener("psat:profile:changed", clearProjectDataCache);
}

export interface ProjectDataCache {
  /** All loaded projects, keyed by project name (mirrors the module cache singleton). */
  projectData: Record<string, ProjectDataState>;
  /** Raw setter; used by hooks that need the functional-update form (e.g. per-row patches). */
  setProjectData: Dispatch<SetStateAction<Record<string, ProjectDataState>>>;
  /** Merge `updates` into one project's state and mirror into the module cache singleton. */
  updateProjectData: (projectName: string, updates: Partial<ProjectDataState>) => void;
  /** The active project's state (or `defaultProjectData` when none/guide is showing). */
  currentData: ProjectDataState;
  /** Re-fetch the active project's detail/attrs/geo/metadata from the backend. */
  refreshCurrentProject: () => Promise<void>;
  /** Persist + broadcast the verified-segment count for a project (clamped to [0, total]). */
  updateVerifiedSegmentCount: (projectName: string | null, count: number) => Promise<void>;
  /** Persist + broadcast the autocoded-segment count for a project (clamped to [0, total]). */
  updateAutocodedSegmentCount: (projectName: string | null, count: number) => Promise<void>;
  /** True once all of the active project's segment images have finished (pre)loading. */
  imagesLoaded: boolean;
  /** 0–100 image-preload progress for the active project. */
  imageLoadingProgress: number;
  /** Server autocode baseline rows for the active project (validation reference values). */
  baselineRows: AttributeRow[];
  /** Ref mirror of `baselineRows` so async autocode handlers avoid stale closures. */
  baselineRowsRef: React.MutableRefObject<AttributeRow[]>;
  /** Global attribute code→label mappings (augmented with custom sub-category options). */
  attrMappings: AttrMappings;
  setAttrMappings: Dispatch<SetStateAction<AttrMappings>>;
  /** User-defined custom option lists per field. */
  customAttrOptions: Record<string, string[]>;
  /** Persist a field's custom option list into `customAttrOptions` + `attrMappings`. */
  handleSaveOptions: (field: string, options: string[]) => void;
}

/**
 * useProjectDataCache — owns the Coding page's server-data spine.
 *
 * Responsible for loading + caching each open project's detail, attributes, GeoJSON,
 * metadata, autocode baseline, and scores; image preloading; verified/autocoded
 * segment counts; and the global attribute mappings. All other Coding hooks
 * (useAutocode, useAttributeEditing) consume this spine — `updateProjectData` /
 * `setProjectData` / `currentData` are threaded to them by the container.
 *
 * @param currentProjectName — active project (null while the coding guide is shown).
 * @returns the {@link ProjectDataCache} spine.
 *
 * Side effects: network fetches (project detail/attrs/geo/metadata/baseline/results/
 * mappings), image preloads, `updateProject` writes; dispatches `psat:verified:updated`,
 * `psat:autocoded:updated`, `psat:scores:updated`; listens for `psat:baseline:updated`.
 * Mutates the module-level `projectDataCache` / `savedAttrsSnapshot` singletons.
 */
export function useProjectDataCache(currentProjectName: string | null): ProjectDataCache {
  const [projectData, setProjectData] = useState<Record<string, ProjectDataState>>(projectDataCache);

  // Seed synchronously from the shared cache so attribute values render as text
  // labels (not raw numeric codes) on the very first render after a remount /
  // navigation — avoids the numeric-code flash. (Cold cache returns null → {}.)
  const [attrMappings, setAttrMappings] = useState<AttrMappings>(
    () => getCachedAttributeMappingsSync() ?? {}
  );
  const [customAttrOptions, setCustomAttrOptions] = useState<Record<string, string[]>>({});

  // Image preloading state
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [imageLoadingProgress, setImageLoadingProgress] = useState(0);

  // Get current project data with defaults
  const currentData = useMemo<ProjectDataState>(() => {
    if (!currentProjectName) return defaultProjectData;
    return projectData[currentProjectName] || defaultProjectData;
  }, [projectData, currentProjectName]);

  const attrs = currentData.attrs;

  // Helper to update a specific project's data
  const updateProjectData = (projectName: string, updates: Partial<ProjectDataState>) => {
    setProjectData(prev => {
      const newState = {
        ...prev,
        [projectName]: {
          ...prev[projectName] || defaultProjectData,
          ...updates,
        },
      };
      projectDataCache[projectName] = newState[projectName];
      return newState;
    });
  };

  const refreshCurrentProject = useCallback(async () => {
    if (!currentProjectName) return;

    updateProjectData(currentProjectName, { loading: true, error: null });

    try {
      const [d, a, gjson, metadata, autoMeta] = await Promise.all([
        fetchProjectDetail(currentProjectName),
        fetchProjectAttributes(currentProjectName) as Promise<AttributesResponse>,
        fetchProjectGeoJSON(currentProjectName) as Promise<FeatureCollection>,
        fetchProjectMetadata(currentProjectName).catch(() => null),
        fetch(`/api/projects/${encodeURIComponent(currentProjectName)}/autocode-metadata`).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      const attributes = migrateAttrRows(a?.rows ?? []);

      savedAttrsSnapshot[currentProjectName] = attributes;
      updateProjectData(currentProjectName, {
        detail: d ?? null,
        attrs: attributes,
        geoFeatures: gjson?.features ?? [],
        editedRow: null,
        verified: metadata?.verified ?? false,
        verifiedSegmentCount: metadata?.verified_segment_count ?? 0,
        autocodedSegmentCount: metadata?.autocoded_segment_count ?? 0,
        changedFieldsByRow: autoMeta?.changedFieldsByRow || {},
        fieldSourcesByRow: autoMeta?.fieldSourcesByRow || {},
        loading: false,
        isDirty: false,
      });

    } catch (e: unknown) {
      updateProjectData(currentProjectName, {
        error: e instanceof Error ? e.message : "Unknown error",
        loading: false,
      });
    }
  }, [currentProjectName]);

  // Update verified segment count for a project
  const updateVerifiedSegmentCount = async (projectName: string | null, count: number) => {
    if (!projectName) return;
    try {
      const totalSegments = projectData[projectName]?.attrs?.length ?? 0;
      // Clamp the count to be between 0 and total segments
      const clampedCount = Math.max(0, Math.min(count, totalSegments));

      await updateProject(projectName, { verified_segment_count: clampedCount });
      updateProjectData(projectName, { verifiedSegmentCount: clampedCount });
      // Notify other pages of the change with segment count
      window.dispatchEvent(new CustomEvent("psat:verified:updated", {
        detail: { projectName, verifiedSegmentCount: clampedCount }
      }));
    } catch (e: unknown) {
      toaster.create({
        title: "Failed to update",
        description: e instanceof Error ? e.message : "Failed to update verified segment count",
        type: "error",
      });
    }
  };

  // Update autocoded segment count for a project
  const updateAutocodedSegmentCount = async (projectName: string | null, count: number) => {
    if (!projectName) return;
    try {
      const totalSegments = projectData[projectName]?.attrs?.length ?? 0;
      // Clamp the count to be between 0 and total segments
      const clampedCount = Math.max(0, Math.min(count, totalSegments));

      await updateProject(projectName, { autocoded_segment_count: clampedCount });
      updateProjectData(projectName, { autocodedSegmentCount: clampedCount });
      // Notify other pages of the change with segment count
      window.dispatchEvent(new CustomEvent("psat:autocoded:updated", {
        detail: { projectName, autocodedSegmentCount: clampedCount }
      }));
    } catch (e: unknown) {
      toaster.create({
        title: "Failed to update",
        description: e instanceof Error ? e.message : "Failed to update autocoded segment count",
        type: "error",
      });
    }
  };

  // Load project data
  useEffect(() => {
    if (!currentProjectName) return;

    // If already loaded, don't reload
    if (projectData[currentProjectName] && !projectData[currentProjectName].loading) {
      setImagesLoaded(true);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        updateProjectData(currentProjectName, { loading: true, error: null });

        const [d, a, gjson, metadata, autoMeta] = await Promise.all([
          fetchProjectDetail(currentProjectName),
          fetchProjectAttributes(currentProjectName) as Promise<AttributesResponse>,
          fetchProjectGeoJSON(currentProjectName) as Promise<FeatureCollection>,
          fetchProjectMetadata(currentProjectName).catch(() => null),
          fetch(`/api/projects/${encodeURIComponent(currentProjectName)}/autocode-metadata`).then(r => r.ok ? r.json() : null).catch(() => null),
        ]);

        if (cancelled) return;


        const attributes = migrateAttrRows(a?.rows ?? []);

        // Store original autocode values (baseline) for validation tracking
        // This is version 0 of the baseline - created when project is first loaded
        // IMPORTANT: Only create baseline if it doesn't exist - don't overwrite on subsequent loads
        try {
          const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectName)}/baseline`);
          const baselineData = await res.json();
          const baselineExists = baselineData?.rows && baselineData.rows.length > 0;

          // Only save baseline if it doesn't already exist
          if (!baselineExists) {
            const normalized = attributes.map(row => {
              const normalizedRow: AttributeRow = {};
              for (const [key, value] of Object.entries(row)) {
                if (value === null || value === undefined) {
                  normalizedRow[key] = value;
                } else if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) {
                  normalizedRow[key] = Number(value);
                } else {
                  normalizedRow[key] = value;
                }
              }
              return normalizedRow;
            });

            // Save baseline to server (version 0 - default values) only on first load
            fetch(`/api/projects/${encodeURIComponent(currentProjectName)}/baseline`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ rows: normalized })
            });
          }
        } catch {
        }

        // Start image preloading
        const uniqueRefs = new Set<string>();
        attributes.forEach(row => {
          const r = row as any;
          const ref = r["Image Reference"] ?? r["image"] ?? r["img"];
          if (ref) uniqueRefs.add(ref);
        });

        // Also check geoFeatures for image refs if not in attributes
        const features = gjson?.features || [];
        features.forEach((f: any) => {
          const p = f.properties || {};
          const ref = p["Image Reference"] ?? p["Image_Reference"] ?? p["image"] ?? p["img"];
          if (ref) uniqueRefs.add(ref);
        });

        const refList = Array.from(uniqueRefs);

        if (refList.length === 0) {
          setImagesLoaded(true);
        } else {
          let loadedCount = 0;
          // Cap concurrent requests if needed, but browser handles queueing.
          // Loop and fetch
          refList.forEach(ref => {
            const img = new Image();
            img.src = `/api/projects/${encodeURIComponent(currentProjectName)}/images/${encodeURIComponent(ref)}`;

            const onFinish = () => {
              loadedCount++;
              const pct = Math.round((loadedCount / refList.length) * 100);
              setImageLoadingProgress(pct);
              if (loadedCount >= refList.length) {
                setImagesLoaded(true);
              }
            };

            img.onload = onFinish;
            img.onerror = onFinish; // Don't block on error
          });
        }

        savedAttrsSnapshot[currentProjectName] = attributes;
        updateProjectData(currentProjectName, {
          detail: d ?? null,
          attrs: attributes,
          geoFeatures: gjson?.features ?? [],
          editedRow: null,
          verified: metadata?.verified ?? false,
          verifiedSegmentCount: metadata?.verified_segment_count ?? 0,
          autocodedSegmentCount: metadata?.autocoded_segment_count ?? 0,
          changedFieldsByRow: autoMeta?.changedFieldsByRow || {},
          fieldSourcesByRow: autoMeta?.fieldSourcesByRow || {},
          loading: false,
          isDirty: false,
        });
      } catch (e: unknown) {
        if (!cancelled) {
          updateProjectData(currentProjectName, {
            error: e instanceof Error ? e.message : "Unknown error",
            loading: false,
          });
        }
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectName]);

  // Store baseline rows fetched from server
  const [baselineRows, setBaselineRows] = useState<AttributeRow[]>([]);
  const baselineRowsRef = useRef<AttributeRow[]>([]);

  // Fetch baseline from server when project changes
  useEffect(() => {
    if (!currentProjectName) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectName)}/baseline`);
        if (!res.ok) {
          setBaselineRows([]);
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setBaselineRows(migrateAttrRows(data.rows || []));
        }
      } catch (e) {
        setBaselineRows([]);
      }
    })();

    return () => { cancelled = true; };
  }, [currentProjectName]);

  // Keep ref in sync so async handlers can read the current baseline without stale closures
  useEffect(() => {
    baselineRowsRef.current = baselineRows;
  }, [baselineRows]);

  // Listen for baseline updates from autocode operations and refetch
  useEffect(() => {
    const handleBaselineUpdate = async () => {
      if (!currentProjectName) return;

      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectName)}/baseline`);
        if (!res.ok) {
          setBaselineRows([]);
          return;
        }
        const data = await res.json();
        setBaselineRows(data.rows || []);
      } catch (e) {
      }
    };

    window.addEventListener("psat:baseline:updated", handleBaselineUpdate);
    return () => {
      window.removeEventListener("psat:baseline:updated", handleBaselineUpdate);
    };
  }, [currentProjectName]);

  // Auto-calculate scores on project load
  useEffect(() => {
    if (!currentProjectName || attrs.length === 0) return;

    let isMounted = true;

    (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectName)}/results`);
        if (!res.ok) {
          throw new Error("Failed to fetch results");
        }

        const data = await res.json();

        if (!data.ok || !Array.isArray(data.result_rows) || data.result_rows.length === 0) {
          let loadingToastId: string | undefined;

          if (isMounted) {
            loadingToastId = toaster.create({
              description: "Auto-calculating scores for all segments...",
              type: "loading",
            });
          }

          const result = await calculateScore(currentProjectName);

          if (isMounted && result.ok && Array.isArray(result.result_rows)) {
            if (loadingToastId) {
              toaster.dismiss(loadingToastId);
            }

            updateProjectData(currentProjectName, {
              scores: result.result_rows as any,
            });
            toaster.create({
              title: "Scores calculated",
              description: `Auto-calculated scores for ${result.result_rows.length} segments`,
              type: "success",
            });

            window.dispatchEvent(new CustomEvent("psat:scores:updated"));
          } else if (isMounted && loadingToastId) {
            toaster.dismiss(loadingToastId);
          }
        } else if (isMounted) {
          updateProjectData(currentProjectName, {
            scores: data.result_rows as any,
          });
        }
      } catch {
      }
    })();

    return () => { isMounted = false; };
  }, [currentProjectName, attrs.length]);

  // Fetch attribute mappings (global, not per-project)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cachedMap, customOpts] = await Promise.all([
          getCachedAttributeMappings(),
          fetchCustomAttrOptions().catch(() => ({} as Record<string, string[]>)),
        ]);
        // Clone so per-page augmentation (custom options below) doesn't mutate the
        // shared cached object.
        const map: AttrMappings = { ...cachedMap };
        // Ensure "Line of Sight" always has a dropdown even if the backend hasn't been restarted
        if (!map["Line of Sight"]) {
          map["Line of Sight"] = { "1": "Adequate", "2": "Inadequate" };
        }
        // Merge custom sub-category options into mappings (identity key→label)
        for (const [field, opts] of Object.entries(customOpts)) {
          map[field] = Object.fromEntries(opts.map((o) => [o, o]));
        }
        if (!cancelled) {
          setCustomAttrOptions(customOpts);
          setAttrMappings(map);
        }
      } catch {
        if (!cancelled) setAttrMappings({ "Line of Sight": { "1": "Adequate", "2": "Inadequate" } });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function handleSaveOptions(field: string, options: string[]) {
    const updatedCustom = { ...customAttrOptions, [field]: options };
    setCustomAttrOptions(updatedCustom);
    setAttrMappings((prev) => ({
      ...prev,
      [field]: Object.fromEntries(options.map((o) => [o, o])),
    }));
  }

  return {
    projectData,
    setProjectData,
    updateProjectData,
    currentData,
    refreshCurrentProject,
    updateVerifiedSegmentCount,
    updateAutocodedSegmentCount,
    imagesLoaded,
    imageLoadingProgress,
    baselineRows,
    baselineRowsRef,
    attrMappings,
    setAttrMappings,
    customAttrOptions,
    handleSaveOptions,
  };
}
