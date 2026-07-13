/**
 * Typed seam for the Generated Reports page (container/shell architecture — see
 * temp/UI_V2_REDESIGN_GUIDE.md §3).
 *
 * The container (`GeneratedReportsPage.tsx`) owns ALL logic — report fetching,
 * delete, download, filter + selection state — and assembles this one object.
 * Both shells (`GeneratedReportsLayoutV1`, `GeneratedReportsLayoutV2`) are pure
 * functions of it and consume the identical contract.
 */
import type { GeneratedReportInfo } from "../../../api";

export interface GeneratedReportsViewModel {
  // ── Report list ──
  reports: GeneratedReportInfo[]; // all, unfiltered
  filtered: GeneratedReportInfo[]; // after filterText (container computes)
  loading: boolean;
  error: string | null;
  onReload: () => void; // Refresh (global → teal)

  // ── Filter ──
  filterText: string;
  setFilterText: (t: string) => void;

  // ── Selection + preview ──
  selected: GeneratedReportInfo | null;
  onSelect: (r: GeneratedReportInfo | null) => void;
  previewUrl: string | null; // container builds `/api/generated-reports/<name>`

  // ── Actions ──
  onDownload: (name: string) => void; // v1 only (v2 downloads via the PDF embed)

  // ── Rename (v2 — Edit opens the RenameReportModalV2, mirrors Home > Edit) ──
  editingReport: GeneratedReportInfo | null; // report whose rename modal is open
  onEditClick: (r: GeneratedReportInfo) => void;
  onCloseEdit: () => void;
  onRenamed: (oldName: string, newName: string) => void;

  // ── Inline delete (mirror GisLayers confirmDeletePath) ──
  confirmDelete: string | null; // report name pending confirm, or null
  onDeleteClick: (name: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (name: string) => void;

  // ── Action status ──
  actionLoading: boolean;
  actionError: string | null;
  onClearActionError: () => void;
}
