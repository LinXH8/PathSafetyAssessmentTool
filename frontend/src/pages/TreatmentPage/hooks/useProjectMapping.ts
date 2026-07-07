/**
 * @file useProjectMapping.ts
 * Owns the Treatment page's multi-project global-index bookkeeping (see root
 * CLAUDE.md "Multi-Project Index Mapping"). When multiple projects are loaded,
 * their segments are aggregated into flat global arrays (`attrs`, `geoFeatures`,
 * `scores`); `projectMap` records each project's `startIndex`/`count` window
 * within those arrays, and `resolveIndex` maps a global index back to
 * `{ projectName, localIndex }`.
 *
 * This hook is intentionally narrow: it owns ONLY `projectMap` state and the
 * pure `resolveIndex` lookup. Filter-mode-aware helpers
 * (`getProjectSegmentCount` / `getProjectFirstSegmentIndex`) stay in the
 * container because they depend on `filterMode`/`filteredGlobalIndices`, which
 * themselves are derived FROM `projectMap` — folding them into this hook would
 * create a circular data-dependency within the same render pass.
 */
import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ProjectDetail } from "../treatmentConstants";

export interface ProjectMapEntry {
  name: string;
  startIndex: number;
  count: number;
  detail: ProjectDetail;
}

export interface UseProjectMappingResult {
  /** Ordered list of loaded projects with their global-index window. */
  projectMap: ProjectMapEntry[];
  setProjectMap: Dispatch<SetStateAction<ProjectMapEntry[]>>;
  /**
   * Maps a global segment index to its owning project + local index, or
   * `null` if the index falls outside every loaded project's window.
   */
  resolveIndex: (globalIndex: number) => { name: string; localIndex: number } | null;
}

/**
 * Manages the `projectMap` state and the `resolveIndex` lookup shared by every
 * consumer of the Treatment page's aggregated (multi-project) arrays.
 *
 * @returns `projectMap`/`setProjectMap` (populated by the container's
 * `fetchData`) and the memoised `resolveIndex` helper.
 */
export function useProjectMapping(): UseProjectMappingResult {
  const [projectMap, setProjectMap] = useState<ProjectMapEntry[]>([]);

  const resolveIndex = useCallback(
    (globalIndex: number) => {
      for (const p of projectMap) {
        if (globalIndex >= p.startIndex && globalIndex < p.startIndex + p.count) {
          return { name: p.name, localIndex: globalIndex - p.startIndex };
        }
      }
      return null;
    },
    [projectMap]
  );

  return { projectMap, setProjectMap, resolveIndex };
}
