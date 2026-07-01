import type { KeyboardEvent } from "react";
import type { SourceFolderPreview, SourceFolderSummary, ProjectSelectionGeometry } from "../../../api";
import type { SelectedRoad } from "../SelectRoadsMap";

/**
 * The seam between the Create Project container (logic) and its layout shells
 * (presentation). The container assembles ONE of these and passes it to
 * whichever shell is active (v1 / v2). Both shells consume the identical props.
 * Nothing component-internal lives here — no fetch, no server state, no
 * sessionStorage. See temp/UI_V2_REDESIGN_GUIDE.md §3.
 */
export interface CreateProjectViewModel {
  // ── project identity ──
  name: string;
  setName: (value: string) => void;

  // ── tags ──
  tags: string[];
  tagInput: string;
  setTagInput: (value: string) => void;
  tagSuggestionsOpen: boolean;
  setTagSuggestionsOpen: (open: boolean) => void;
  filteredTagSuggestions: string[];
  commitTag: (rawTag: string) => void;
  removeTag: (tag: string) => void;
  handleTagInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;

  // ── source folder ──
  folders: string[];
  folder: string;
  setFolder: (value: string) => void;
  /** v2 folder table multi-select (v1 combobox uses the single `folder`). */
  selectedFolders: string[];
  setSelectedFolders: (names: string[]) => void;
  folderComboboxOpen: boolean;
  setFolderComboboxOpen: (open: boolean) => void;
  loadingFolders: boolean;
  selectedFolderExists: boolean;
  folderPreview: SourceFolderPreview | null;
  loadingFolderPreview: boolean;
  folderPreviewError: string | null;
  /** Per-folder summary stats auto-loaded for the v2 folder table. */
  folderSummaries: Record<string, SourceFolderSummary>;
  /** True while any folder summary is still being fetched in the background. */
  loadingFolderSummaries: boolean;
  /** Count of existing projects created from each source folder. */
  folderProjectCounts: Record<string, number>;

  // ── road selection ──
  usingRoadSelection: boolean;
  selectedRoadFolders: SelectedRoad[];
  unavailableSelectedRoads: SelectedRoad[];
  roadAvailabilityVersion: number;
  onRoadSelectionChange: (roads: SelectedRoad[]) => void;
  onSelectionGeometryChange: (geometry: ProjectSelectionGeometry | null) => void;

  // ── status + actions ──
  err: string | null;
  canCreate: boolean;
  creating: boolean;
  onCreate: () => void;
  onCancel: () => void;

  // ── image-upload modal ──
  imageUploadModalOpen: boolean;
  openImageUploadModal: () => void;
  closeImageUploadModal: () => void;
  onImageUploadSuccess: (details: { folderName: string }) => void;
}
