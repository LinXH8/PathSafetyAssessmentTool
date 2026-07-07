/**
 * useSegmentEditTools.ts — segment delete/copy tooling state for GeoDataPanel.
 *
 * Single responsibility: the map's editing tools — single-point delete/copy
 * modes, polygon batch delete/copy modes, the polygon vertex list, the
 * delete-confirmation and add-segments dialog state, and the backend calls
 * (`DELETE /segments/<idx>`, `POST /segments/delete-batch`). Extracted
 * verbatim from GeoDataPanel.tsx in S2.2.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toaster } from "../../../../components/ui/toaster";
import { isPointInPolygon } from "../../../../components/map/polygonUtils";

/** Minimal shape of a segment dot needed by the polygon selection tools. */
export type SelectablePoint = { latlng: [number, number]; globalIdx: number };

/**
 * Owns GeoDataPanel's segment editing tool state and actions.
 *
 * @param decodedName decoded project name (null → delete actions no-op).
 * @param points segment dots (latlng + global index) for polygon hit-testing.
 * @param onDataChange parent refresh callback fired after a successful
 *   mutation; falls back to `window.location.reload()` when absent.
 * @returns mode flags + setters, selection state, dialog state and the
 *   delete/polygon action callbacks consumed by the toolbar, the segment
 *   dots' click handlers and the dialogs.
 * Side effects: network DELETE/POST calls, toaster notifications, full page
 * reload fallback when no `onDataChange` is provided.
 */
export function useSegmentEditTools(
  decodedName: string | null,
  points: SelectablePoint[],
  onDataChange?: () => void,
) {
  // Delete Mode State
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [isPointAddMode, setIsPointAddMode] = useState(false);
  const [isPolygonMode, setIsPolygonMode] = useState(false); // Polygon batch delete mode
  const [isPolygonAddMode, setIsPolygonAddMode] = useState(false); // Polygon batch copy mode
  const [polygonPoints, setPolygonPoints] = useState<[number, number][]>([]);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [isAddSegmentsDialogOpen, setIsAddSegmentsDialogOpen] = useState(false);
  const [segmentToDelete, setSegmentToDelete] = useState<number | null>(null);
  const [segmentToAdd, setSegmentToAdd] = useState<number | null>(null);
  const [segmentsToDelete, setSegmentsToDelete] = useState<number[]>([]); // For batch delete
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Clear single selections when toggling point modes
  useEffect(() => {
    if (!isDeleteMode && !isPointAddMode) {
      setSegmentToDelete(null);
      setSegmentToAdd(null);
    }
  }, [isDeleteMode, isPointAddMode]);

  // Clear polygon points and close dialog when toggling polygon mode
  useEffect(() => {
    setPolygonPoints([]);
    setDeleteConfirmationOpen(false);
    setSegmentsToDelete([]);
  }, [isPolygonMode]);

  const handleDeleteSegment = useCallback(async () => {
    if (segmentToDelete === null || !decodedName) return;

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(decodedName)}/segments/${segmentToDelete}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error(await res.text().catch(() => res.statusText));
      }

      toaster.create({
        title: "Point Deleted",
        description: `Segment #${segmentToDelete + 1} deleted successfully.`,
        type: "success",
      });

      // Clear selection and close dialog
      setSegmentToDelete(null);
      setDeleteConfirmationOpen(false);
      setIsDeleteMode(false);

      // Trigger data refresh if callback provided
      if (onDataChange) {
        onDataChange();
      } else {
        // Fallback: reload page? Or maybe just re-fetch Geodata?
        // Re-fetching geodata isn't enough as indices shift globally.
        // Ideally parent should handle this.
        window.location.reload();
      }

    } catch (e) {
      toaster.create({
        title: "Delete Failed",
        description: (e as Error)?.message ?? "Failed to delete segment",
        type: "error",
      });
    }
  }, [segmentToDelete, decodedName, onDataChange]);

  // Handle adding points to polygon
  const handlePolygonPoint = useCallback((latlng: [number, number]) => {
    setPolygonPoints(prev => {
      // Double click logic is hard with simple click handler, using a Close button instead usually better
      // But let's check if clicked near first point to close?
      // Or just let user click a "Finish" button.
      // Let's rely on a "Finish Selection" button in the header instead of complex map interaction.
      return [...prev, latlng];
    });
  }, []);

  // Handle updating points when dragged
  const handlePointUpdate = useCallback((index: number, latlng: [number, number]) => {
    setPolygonPoints(prev => {
      const newPoints = [...prev];
      newPoints[index] = latlng;
      return newPoints;
    });
  }, []);

  // Finish Polygon Selection: Find points inside and confirm
  const finishPolygonSelection = useCallback(() => {
    if (polygonPoints.length < 3) {
      toaster.create({ title: "Invalid Polygon", description: "Need at least 3 points.", type: "warning" });
      return;
    }

    // Find all points inside
    const indicesInside: number[] = [];
    points.forEach(p => {
      if (isPointInPolygon(p.latlng, polygonPoints)) {
        indicesInside.push(p.globalIdx);
      }
    });

    if (indicesInside.length === 0) {
      toaster.create({ title: "No Points Selected", description: "No points found inside the polygon.", type: "info" });
      setPolygonPoints([]);
      setIsPolygonMode(false);
      return;
    }

    setSegmentsToDelete(indicesInside);
    setDeleteConfirmationOpen(true);
  }, [polygonPoints, points]);

  // Handle Batch Deletion
  const handleBatchDelete = useCallback(async () => {
    if (segmentsToDelete.length === 0 || !decodedName) return;

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(decodedName)}/segments/delete-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ indices: segmentsToDelete })
      });

      if (!res.ok) {
        throw new Error(await res.text().catch(() => res.statusText));
      }

      toaster.create({
        title: "Batch Delete Successful",
        description: `Deleted ${segmentsToDelete.length} segments.`,
        type: "success",
      });

      // Reset states
      setSegmentsToDelete([]);
      setPolygonPoints([]);
      setDeleteConfirmationOpen(false);
      setIsPolygonMode(false);
      setIsDeleteMode(false); // also turn off single delete mode if on

      // Refresh
      if (onDataChange) {
        onDataChange();
      } else {
        window.location.reload();
      }

    } catch (e) {
      toaster.create({
        title: "Delete Failed",
        description: (e as Error)?.message ?? "Failed to delete segments",
        type: "error",
      });
    }
  }, [segmentsToDelete, decodedName, onDataChange]);

  const finishAddSegmentsSelection = useCallback(() => {
    if (polygonPoints.length < 3) {
      toaster.create({ title: "Invalid Polygon", description: "Need at least 3 points.", type: "warning" });
      return;
    }
    const indices = points
      .filter(p => isPointInPolygon(p.latlng, polygonPoints))
      .map(p => p.globalIdx);

    if (indices.length === 0) {
      toaster.create({ title: "No Segments", description: "No segments selected.", type: "warning" });
      return;
    }

    setIsAddSegmentsDialogOpen(true);
  }, [polygonPoints, points]);

  return {
    // mode flags + setters (toolbar + map cursor + dot click handlers)
    isDeleteMode, setIsDeleteMode,
    isPointAddMode, setIsPointAddMode,
    isPolygonMode, setIsPolygonMode,
    isPolygonAddMode, setIsPolygonAddMode,
    // polygon vertices (drawing tool + selection counts)
    polygonPoints, setPolygonPoints,
    // dialog state
    deleteConfirmationOpen, setDeleteConfirmationOpen,
    isAddSegmentsDialogOpen, setIsAddSegmentsDialogOpen,
    // selections
    segmentToDelete, setSegmentToDelete,
    segmentToAdd, setSegmentToAdd,
    segmentsToDelete,
    cancelRef,
    // actions
    handleDeleteSegment,
    handlePolygonPoint,
    handlePointUpdate,
    finishPolygonSelection,
    handleBatchDelete,
    finishAddSegmentsSelection,
  };
}
