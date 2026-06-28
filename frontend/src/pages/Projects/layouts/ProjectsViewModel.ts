import type { ProjectListItem, ProfileSummary } from "../../../api";

/**
 * The seam between the Projects container (logic) and its layout shells
 * (presentation). The container assembles ONE of these and passes it to
 * whichever shell is active (v1 / v2). Both shells consume the identical
 * props. Nothing component-internal lives here — no fetch, no server state,
 * no sessionStorage. See temp/UI_V2_REDESIGN_GUIDE.md §3.
 */

export type SortDirection = "asc" | "desc";
export interface SortCriterion {
  key: string;
  direction: SortDirection;
}
export interface SortMeta {
  direction: SortDirection;
  priority: number;
}

export interface ProjectsViewModel {
  // ── profile / legacy-migration banner ──
  activeProfile: ProfileSummary | null;
  legacyProjects: string[];
  migratingLegacyProjects: boolean;
  moveLegacyProjects: () => void;

  // ── search + tag filters ──
  nameQuery: string;
  setNameQuery: (value: string) => void;
  tagFilters: string[];
  addTagFilter: (tag: string) => void;
  removeTagFilter: (tag: string) => void;
  tagInputValue: string;
  setTagInputValue: (value: string) => void;
  tagSuggestionsOpen: boolean;
  setTagSuggestionsOpen: (open: boolean) => void;
  filteredTagOptions: string[];
  hasActiveFilters: boolean;
  clearAllFilters: () => void;

  // ── list data + status ──
  projects: ProjectListItem[];
  filtered: ProjectListItem[];
  selected: Set<string>;
  loadingProjects: boolean;
  error: string | null;
  status: string;
  showCreateProjectPrompt: boolean;

  // ── selection ──
  onRowClick: (name: string) => void;
  toggleSelectAll: () => void;

  // ── primary actions ──
  onCreateProject: () => void;
  askDelete: () => void;
  loadProject: () => void;
  loadPathAnalysis: () => void;
  loadTreatment: () => void;
  askShare: () => void;
  shareTargets: ProfileSummary[];

  // ── sorting ──
  sortConfig: SortCriterion[];
  getSortMeta: (key: string) => SortMeta | null;
  handleSort: (key: string, event: React.MouseEvent) => void;

  // ── edit dialog ──
  editingProject: ProjectListItem | null;
  setEditingProject: (project: ProjectListItem | null) => void;
  openEdit: boolean;
  setOpenEdit: (open: boolean) => void;
  handleEditSuccess: (newName: string, newTags: string[]) => void;

  // ── delete dialog ──
  openDelete: boolean;
  setOpenDelete: (open: boolean) => void;
  deleting: boolean;
  confirmDelete: () => void;

  // ── share dialog ──
  openShare: boolean;
  setOpenShare: (open: boolean) => void;
  sharing: boolean;
  shareTargetId: string;
  setShareTargetId: (id: string) => void;
  confirmShare: () => void;
}
