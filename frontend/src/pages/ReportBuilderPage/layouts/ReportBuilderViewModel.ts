/**
 * ReportBuilderViewModel.ts — the shell-facing contract for the Report Builder.
 *
 * This is the container/shell seam introduced in the S2.5 decomposition. The
 * container (`reportBuilderPage.tsx`) owns ALL state, data fetching, and logic,
 * and assembles exactly this view-model. The presentational shell
 * (`ReportBuilderLayoutV1.tsx`, and a future `ReportBuilderLayoutV2.tsx`) is a
 * pure function of the view-model — it renders chrome + wires callbacks, but
 * never fetches, holds server state, or touches sessionStorage
 * (see UI_V2_REDESIGN_GUIDE.md §0).
 *
 * Section *bodies* are still rendered by container-owned closures
 * (`renderContent` / `renderViewToggle` / `renderMapColorToggle`) passed through
 * the view-model as callbacks, because they read the interdependent data ↔ layout
 * derivation web that stays in the container. A v2 shell swaps only the
 * surrounding chrome, calling the same callbacks.
 *
 * Side effects: none (type module).
 */
import type React from "react";
import type { NavigateFunction } from "react-router-dom";
import type { DragEndEvent, SensorDescriptor, SensorOptions } from "@dnd-kit/core";
import type { ElementState } from "../reportBuilderTypes";
import type { FlowEntry } from "../reportBuilderHelpers";

/** One row of the left "Sections" reorder panel. */
export interface SectionChecklistItem {
  id: string;
  label: string;
  visible: boolean;
  filtered: boolean;
}

/**
 * Everything a Report Builder layout shell needs. Assembled once per render by
 * the container; consumed (typically via a top-level destructure) by the shell.
 */
export interface ReportBuilderViewModel {
  // ── UI variant ─────────────────────────────────────────────────────────────
  isV2: boolean;
  accent: string;
  navigate: NavigateFunction;

  // ── Refs (DOM handles the shell attaches; owned by the container) ──────────
  canvasRef: React.RefObject<HTMLDivElement | null>;
  canvasContainerRef: React.RefObject<HTMLDivElement | null>;
  postTreatmentUploadRef: React.RefObject<HTMLInputElement | null>;
  handlePostTreatmentFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;

  // ── Toolbar actions ────────────────────────────────────────────────────────
  autoFitElements: () => void;
  saveLayout: () => void;
  resetLayout: () => void;
  restoreLayout: () => void;
  hasSaved: boolean;

  // ── Page navigation ────────────────────────────────────────────────────────
  goToPage: (page: number) => void;
  currentPage: number;
  totalPages: number;

  // ── Export ─────────────────────────────────────────────────────────────────
  handleDownloadPDF: () => Promise<void> | void;
  handleDownloadWord: () => Promise<void> | void;
  exporting: "pdf" | "word" | null;

  // ── Toasts / banners ───────────────────────────────────────────────────────
  saveToastVisible: boolean;
  setSaveToastVisible: React.Dispatch<React.SetStateAction<boolean>>;
  restoreBannerVisible: boolean;
  setRestoreBannerVisible: React.Dispatch<React.SetStateAction<boolean>>;

  // ── Filtered-sections master toggle ───────────────────────────────────────
  hasFilter: boolean;
  includeFiltered: boolean;
  toggleIncludeFiltered: () => void;

  // ── Sections panel (dnd-kit reorder + show/hide) ──────────────────────────
  sensors: SensorDescriptor<SensorOptions>[];
  handleDragEnd: (event: DragEndEvent) => void;
  sectionChecklist: SectionChecklistItem[];
  elements: ElementState[];
  hideElement: (id: string) => void;
  showElement: (id: string) => void;
  scrollToSection: (id: string) => void;
  renderViewToggle: (el: ElementState) => React.ReactNode;
  renderMapColorToggle: (el: ElementState) => React.ReactNode;

  // ── Canvas (the rendered report itself) ───────────────────────────────────
  handleCanvasScroll: () => void;
  canvasH: number;
  visibleElements: ElementState[];
  layout: { map: Map<string, FlowEntry>; bottom: number };
  computeIdealHeight: (el: ElementState) => number;
  renderContent: (el: ElementState, orderIndex?: number) => React.ReactNode;

  // ── Project picker overlay ─────────────────────────────────────────────────
  showProjectPicker: boolean;
  pickerLoading: boolean;
  availableProjects: string[];
  pickerSelected: Set<string>;
  setPickerSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  loadSelectedProjects: () => void;
}
