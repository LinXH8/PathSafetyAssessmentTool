/**
 * useReportLayout.ts — the Report Builder's section-layout + persistence state.
 *
 * Extracted verbatim from `reportBuilderPage.tsx` (S2.5 decomposition). Owns the
 * `elements` array (section visibility / order / sizes, restored lazily from the
 * `LOCAL_KEYS.REPORT_LAYOUT` localStorage blob), the editable report metadata
 * (title, OIC, purpose, recommendations, date, per-project display names,
 * per-section titles), the includeFiltered flag, save / auto-save / restore /
 * reset of the layout blob, dnd-kit reorder wiring, page navigation, and the
 * visibleElements / sectionChecklist derivations.
 *
 * Deliberately NOT owned here (stays in the container): the data-coupled height
 * web — `computeIdealHeight`, `autoFitElements`, `showElement`,
 * `toggleIncludeFiltered`, the flow-layout / canvas-height memos — because those
 * read the datasets from `useReportData`. They mutate this hook's state through
 * the returned `setElements` / `setIncludeFiltered`, exactly as before.
 *
 * Side effects: reads/writes localStorage key `LOCAL_KEYS.REPORT_LAYOUT`
 * (byte-identical blob shape); smooth-scrolls the canvas container on page nav.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PointerSensor, KeyboardSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { LOCAL_KEYS } from "../../../constants/sessionKeys";
import {
  DEFAULT_ELEMENTS, FILTERED_SECTIONS_ENABLED, PAGE_H,
} from "../reportBuilderConstants";
import { readSavedLayout } from "../reportBuilderHelpers";
import type { ElementState } from "../reportBuilderTypes";
import type { SectionChecklistItem } from "../layouts/ReportBuilderViewModel";

/** DOM refs the page-navigation helpers scroll (owned by the container). */
export interface UseReportLayoutParams {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  canvasContainerRef: React.RefObject<HTMLDivElement | null>;
}

export interface UseReportLayoutResult {
  // Section model
  elements: ElementState[];
  setElements: React.Dispatch<React.SetStateAction<ElementState[]>>;
  visibleElements: ElementState[];
  sectionChecklist: SectionChecklistItem[];
  updateElement: (id: string, changes: Partial<ElementState>) => void;
  hideElement: (id: string) => void;
  // Editable metadata
  reportTitle: string; setReportTitle: React.Dispatch<React.SetStateAction<string>>;
  projectNameOverrides: Record<string, string>;
  setProjectNameOverrides: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  sectionTitles: Record<string, string>;
  setSectionTitles: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  oicName: string; setOicName: React.Dispatch<React.SetStateAction<string>>;
  purpose: string; setPurpose: React.Dispatch<React.SetStateAction<string>>;
  recommendations: string; setRecommendations: React.Dispatch<React.SetStateAction<string>>;
  reportDate: string; setReportDate: React.Dispatch<React.SetStateAction<string>>;
  includeFiltered: boolean;
  setIncludeFiltered: React.Dispatch<React.SetStateAction<boolean>>;
  // Persistence
  hasSaved: boolean;
  saveLayout: () => void;
  restoreLayout: () => void;
  resetLayout: () => void;
  saveToastVisible: boolean;
  setSaveToastVisible: React.Dispatch<React.SetStateAction<boolean>>;
  restoreBannerVisible: boolean;
  setRestoreBannerVisible: React.Dispatch<React.SetStateAction<boolean>>;
  // dnd-kit reorder
  sensors: ReturnType<typeof useSensors>;
  handleDragEnd: (event: DragEndEvent) => void;
  // Page navigation
  currentPage: number;
  goToPage: (page: number) => void;
  scrollToSection: (id: string) => void;
  handleCanvasScroll: () => void;
}

/**
 * Own the report's section-layout state, its localStorage persistence, dnd-kit
 * reordering, and page navigation.
 */
export function useReportLayout({ canvasRef, canvasContainerRef }: UseReportLayoutParams): UseReportLayoutResult {
  // ── State: auto-restored from localStorage if a saved layout exists ──────
  const [elements, setElements] = useState<ElementState[]>(() => {
    const REMOVED_IDS = new Set(["riskStats", "recommendations", "methodology", "segmentGallery", "deepDive", "filterAnalysis"]);
    const l = readSavedLayout();
    if (Array.isArray(l?.elements)) {
      const saved = (l.elements as ElementState[])
        .filter((e) => !REMOVED_IDS.has(e.id));
      // Inject any new default elements missing from the saved layout (e.g. benchmarkStats added after save)
      const savedIds = new Set(saved.map((e: ElementState) => e.id));
      const injected = DEFAULT_ELEMENTS.filter((e) => !savedIds.has(e.id));
      return injected.length > 0 ? [...saved, ...injected] : saved;
    }
    return DEFAULT_ELEMENTS;
  });
  const [currentPage, setCurrentPage] = useState(0);

  // ── Editable metadata ────────────────────────────────────────────────────
  const [reportTitle, setReportTitle] = useState(() => {
    const l = readSavedLayout(); return typeof l?.reportTitle === "string" ? l.reportTitle : "Path Safety Analysis Executive Summary";
  });
  const [projectNameOverrides, setProjectNameOverrides] = useState<Record<string, string>>(() => {
    const l = readSavedLayout(); return (l?.projectNameOverrides && typeof l.projectNameOverrides === "object") ? l.projectNameOverrides as Record<string, string> : {};
  });
  const [sectionTitles, setSectionTitles] = useState<Record<string, string>>(() => {
    const l = readSavedLayout(); return (l?.sectionTitles && typeof l.sectionTitles === "object") ? l.sectionTitles as Record<string, string> : {};
  });
  const [oicName, setOicName] = useState(() => {
    const l = readSavedLayout(); return typeof l?.oicName === "string" ? l.oicName : "";
  });
  const [purpose, setPurpose] = useState(() => {
    const l = readSavedLayout(); return typeof l?.purpose === "string" ? l.purpose : "";
  });
  const [recommendations, setRecommendations] = useState(() => {
    const l = readSavedLayout(); return typeof l?.recommendations === "string" ? l.recommendations : "";
  });
  const [reportDate, setReportDate] = useState(() => {
    const l = readSavedLayout(); return typeof l?.reportDate === "string" ? l.reportDate : new Date().toISOString().split("T")[0];
  });
  const [includeFiltered, setIncludeFiltered] = useState<boolean>(() => {
    const l = readSavedLayout(); return l?.includeFiltered === true;
  });

  const [hasSaved, setHasSaved] = useState(() => { try { return !!localStorage.getItem(LOCAL_KEYS.REPORT_LAYOUT); } catch { return false; } });
  const [saveToastVisible, setSaveToastVisible] = useState(false);
  const saveToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // true when this mount auto-restored a previously saved layout
  const [wasAutoRestored] = useState(() => { try { return !!localStorage.getItem(LOCAL_KEYS.REPORT_LAYOUT); } catch { return false; } });
  const [restoreBannerVisible, setRestoreBannerVisible] = useState(wasAutoRestored);

  // ── Element helpers ───────────────────────────────────────────────────────
  const updateElement = useCallback((id: string, changes: Partial<ElementState>) => {
    setElements((prev) => prev.map((el) => (el.id === id ? { ...el, ...changes } : el)));
  }, []);
  const hideElement = useCallback((id: string) => updateElement(id, { visible: false }), [updateElement]);

  // ── Drag end: reorder the elements array (dnd-kit drives ordering) ─────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setElements((prev) => {
      const oldIndex = prev.findIndex((e) => e.id === active.id);
      const newIndex = prev.findIndex((e) => e.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  // ── Save / Restore layout ─────────────────────────────────────────────────
  const saveLayout = useCallback(() => {
    try {
      localStorage.setItem(LOCAL_KEYS.REPORT_LAYOUT, JSON.stringify({
        elements, reportTitle, oicName, purpose, recommendations,
        reportDate, projectNameOverrides, sectionTitles, includeFiltered,
      }));
      setHasSaved(true);
      setSaveToastVisible(true);
      if (saveToastTimerRef.current) clearTimeout(saveToastTimerRef.current);
      saveToastTimerRef.current = setTimeout(() => setSaveToastVisible(false), 4000);
    } catch (e) { console.error("Save layout failed:", e); }
  }, [elements, reportTitle, oicName, purpose, recommendations, reportDate, projectNameOverrides, sectionTitles, includeFiltered]);

  // Auto-save layout on every change so navigation away never loses section arrangement.
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_KEYS.REPORT_LAYOUT, JSON.stringify({
        elements, reportTitle, oicName, purpose, recommendations,
        reportDate, projectNameOverrides, sectionTitles, includeFiltered,
      }));
      setHasSaved(true);
    } catch (e) { /* quota exceeded or private browsing — silent */ }
  }, [elements, reportTitle, oicName, purpose, recommendations, reportDate, projectNameOverrides, sectionTitles, includeFiltered]);

  const restoreLayout = useCallback(() => {
    try {
      const saved = localStorage.getItem(LOCAL_KEYS.REPORT_LAYOUT);
      if (!saved) return;
      const l = JSON.parse(saved);
      if (l.elements) setElements(l.elements);
      if (l.reportTitle !== undefined) setReportTitle(l.reportTitle);
      if (l.oicName !== undefined) setOicName(l.oicName);
      if (l.purpose !== undefined) setPurpose(l.purpose);
      if (l.recommendations !== undefined) setRecommendations(l.recommendations);
      if (l.reportDate !== undefined) setReportDate(l.reportDate);
      if (l.projectNameOverrides !== undefined) setProjectNameOverrides(l.projectNameOverrides);
      if (l.sectionTitles !== undefined) setSectionTitles(l.sectionTitles);
      if (l.includeFiltered !== undefined) setIncludeFiltered(l.includeFiltered);
    } catch (e) { console.error("Restore layout failed:", e); }
  }, []);

  const resetLayout = useCallback(() => {
    if (window.confirm("Are you sure you want to reset the layout to default? All unsaved changes will be lost.")) {
      localStorage.removeItem(LOCAL_KEYS.REPORT_LAYOUT);
      setElements(DEFAULT_ELEMENTS);
      setReportTitle("Path Safety Analysis Executive Summary");
      setOicName("");
      setPurpose("");
      setRecommendations("");
      setReportDate(new Date().toISOString().split("T")[0]);
      setProjectNameOverrides({});
      setSectionTitles({});
      setIncludeFiltered(false);
      setHasSaved(false);
    }
  }, []);

  // ── Page navigation ───────────────────────────────────────────────────────
  const goToPage = useCallback((page: number) => {
    setCurrentPage(page);
    if (!canvasContainerRef.current || !canvasRef.current) return;
    const canvasTop = canvasRef.current.offsetTop;
    canvasContainerRef.current.scrollTo({ top: canvasTop + page * PAGE_H, behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- canvasRef/canvasContainerRef are stable ref objects (deps match the pre-extraction container code)
  }, []);

  // Scroll the canvas so the start of the given section is brought into view.
  const scrollToSection = useCallback((id: string) => {
    const container = canvasContainerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const el = canvas.querySelector(`[data-element-id="${id}"]`) as HTMLElement | null;
    if (!el) return;
    const elRect = el.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const top = container.scrollTop + (elRect.top - containerRect.top) - 16;
    container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- canvasRef/canvasContainerRef are stable ref objects (deps match the pre-extraction container code)
  }, []);

  const handleCanvasScroll = useCallback(() => {
    if (!canvasContainerRef.current || !canvasRef.current) return;
    const scrolled = canvasContainerRef.current.scrollTop;
    const canvasTop = canvasRef.current.offsetTop;
    const scrollInCanvas = Math.max(0, scrolled - canvasTop);
    setCurrentPage(Math.floor(scrollInCanvas / PAGE_H));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- canvasRef/canvasContainerRef are stable ref objects (deps match the pre-extraction container code)
  }, []);

  // ── Flow-layout inputs (single source of truth for section visibility) ────
  const visibleElements = useMemo(
    () => elements.filter((e) => e.visible && (FILTERED_SECTIONS_ENABLED || !e.filtered)),
    [elements],
  );

  // ── Checklist memo ────────────────────────────────────────────────────────
  const sectionChecklist = useMemo(() =>
    elements
      .filter((el) => FILTERED_SECTIONS_ENABLED || !el.filtered)
      .map((el) => ({ id: el.id, label: el.label, visible: el.visible, filtered: !!el.filtered })),
    [elements]
  );

  return {
    elements, setElements, visibleElements, sectionChecklist, updateElement, hideElement,
    reportTitle, setReportTitle, projectNameOverrides, setProjectNameOverrides,
    sectionTitles, setSectionTitles, oicName, setOicName, purpose, setPurpose,
    recommendations, setRecommendations, reportDate, setReportDate,
    includeFiltered, setIncludeFiltered,
    hasSaved, saveLayout, restoreLayout, resetLayout,
    saveToastVisible, setSaveToastVisible, restoreBannerVisible, setRestoreBannerVisible,
    sensors, handleDragEnd,
    currentPage, goToPage, scrollToSection, handleCanvasScroll,
  };
}
