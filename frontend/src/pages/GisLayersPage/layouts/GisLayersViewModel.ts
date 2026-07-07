/**
 * Typed seam for the GIS Layers page (container/shell architecture — see
 * temp/UI_V2_REDESIGN_GUIDE.md §3).
 *
 * The container (`GisLayersPage.tsx`) owns ALL logic — shapefile fetching,
 * GeoJSON loading, rename/delete/revert, filter state — and assembles this one
 * object. Both shells (`GisLayersLayoutV1`, `GisLayersLayoutV2`) are pure
 * functions of it and consume the identical contract.
 */
import type { RefObject } from "react";
import type { ShapefileInfo } from "../../../api";
import type { FilterMode, MapFeatures } from "../gisLayersConstants";

export interface GisLayersViewModel {
  // ── Layer list ──
  shapefiles: ShapefileInfo[];
  loading: boolean;
  error: string | null;
  onReload: () => void;

  // ── Filtering ──
  filterMode: FilterMode;
  setFilterMode: (m: FilterMode) => void;
  filterText: string;
  setFilterText: (t: string) => void;
  dropdownOpen: boolean;
  setDropdownOpen: (v: boolean | ((o: boolean) => boolean)) => void;
  hoveredFilter: FilterMode | null;
  setHoveredFilter: (m: FilterMode | null) => void;
  tooltipPos: { x: number; y: number } | null;
  setTooltipPos: (p: { x: number; y: number } | null) => void;
  filterDropdownRef: RefObject<HTMLDivElement | null>;

  // ── Selection + map ──
  selectedLayer: ShapefileInfo | null;
  onSelectLayer: (file: ShapefileInfo | null) => void;
  mapLoading: boolean;
  mapError: string | null;
  mapFeatures: MapFeatures | null;
  initialCenter: [number, number];

  // ── Inline rename ──
  editingPath: string | null;
  editName: string;
  setEditName: (v: string) => void;
  onStartEdit: (file: ShapefileInfo) => void;
  onCancelEdit: () => void;
  onSaveEdit: (file: ShapefileInfo) => void;

  // ── Inline delete ──
  confirmDeletePath: string | null;
  onDeleteClick: (file: ShapefileInfo) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (file: ShapefileInfo) => void;

  // ── Inline revert (renamed layers) ──
  confirmRevertPath: string | null;
  onRevertClick: (file: ShapefileInfo) => void;
  onCancelRevert: () => void;
  onConfirmRevert: (file: ShapefileInfo) => void;

  // ── Action status ──
  actionLoading: boolean;
  actionError: string | null;
  onClearActionError: () => void;

  // ── Modals ──
  shapefileModalOpen: boolean;
  onOpenUpdateModal: () => void;
  onCloseUpdateModal: () => void;
  editingParamsFile: ShapefileInfo | null;
  onEditParams: (file: ShapefileInfo) => void;
  onCloseParams: () => void;
  onParamsSaved: () => void;
}
