/**
 * useImportedShapefile.ts — user-uploaded boundary shapefile overlay state for
 * the Path Analysis map view (`PathAnalysisMapView.tsx`).
 *
 * Single responsibility: accept a dropped/selected shapefile (.zip or .shp +
 * companions), preview it via the backend, parse the returned GeoJSON into
 * renderable boundary features, and expose the overlay + loading/error state.
 * Extracted from the map-view monolith [S2.1].
 *
 * Side effects: one network call per import (`previewUploadedShapefiles`) and
 * user-facing toasts on success/failure. No storage access.
 */

import { useCallback, useState } from "react";
import { toaster } from "../../../../components/ui/toaster";
import { previewUploadedShapefiles } from "../../../../api";
import { extractUploadedBoundaryFeatures, type UploadedBoundaryFeature } from "./mapViewUtils";

/**
 * @returns
 *  - `importedBoundaries` — parsed overlay features (empty when none loaded)
 *  - `importedBoundaryName` / `importedBoundaryLoading` / `importedBoundaryError`
 *  - `handleImportFiles(files)` — validates + uploads + parses the selection
 *  - `handleClearImportedShapefile()` — clears the overlay
 */
export function useImportedShapefile() {
  const [importedBoundaries, setImportedBoundaries] = useState<UploadedBoundaryFeature[]>([]);
  const [importedBoundaryName, setImportedBoundaryName] = useState<string | null>(null);
  const [importedBoundaryLoading, setImportedBoundaryLoading] = useState(false);
  const [importedBoundaryError, setImportedBoundaryError] = useState<string | null>(null);

  const handleImportFiles = useCallback(async (files: File[]) => {
    const sourceFile = files.find((f) => f.name.toLowerCase().endsWith(".shp") || f.name.toLowerCase().endsWith(".zip"));
    if (!sourceFile) {
      const message = "Upload a .zip shapefile or a .shp file with its companion files (.dbf, .shx, .prj).";
      setImportedBoundaryError(message);
      toaster.create({ title: "Import failed", description: message, type: "warning" });
      return;
    }
    setImportedBoundaryLoading(true);
    setImportedBoundaryError(null);
    try {
      const geojson = await previewUploadedShapefiles(files);
      const boundaries = extractUploadedBoundaryFeatures(geojson);
      if (boundaries.length === 0) {
        throw new Error("No polygon or line features were found in the uploaded shapefile.");
      }
      setImportedBoundaryName(sourceFile.name);
      setImportedBoundaries(boundaries);
      toaster.create({ title: "Shapefile imported", description: `Loaded ${boundaries.length} feature(s) from ${sourceFile.name}.`, type: "success" });
    } catch (err: any) {
      const message = err?.message ?? "Failed to import shapefile.";
      setImportedBoundaryError(message);
      toaster.create({ title: "Import failed", description: message, type: "error" });
    } finally {
      setImportedBoundaryLoading(false);
    }
  }, []);

  const handleClearImportedShapefile = useCallback(() => {
    setImportedBoundaries([]);
    setImportedBoundaryName(null);
    setImportedBoundaryError(null);
  }, []);

  return {
    importedBoundaries,
    importedBoundaryName,
    importedBoundaryLoading,
    importedBoundaryError,
    handleImportFiles,
    handleClearImportedShapefile,
  };
}
