import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Loader2 } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip as RechartTooltip } from "recharts";
import SectionErrorBoundary from "./SectionErrorBoundary";
// html2canvas-pro is a maintained drop-in fork of html2canvas (^1.4.1) that fixes
// the text-baseline bug which rendered text shifted *down* (form-control values,
// pills, table cells all sat too low in the exported PDF — niklasvh/html2canvas
// issues #2107 / #2775 / #2691, fix PR #2938). API-compatible: same default export.
import html2canvas from "html2canvas-pro";
import jsPDF from "jspdf";
import { useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, CircleMarker, useMap } from "react-leaflet";
import L from "leaflet";
import proj4 from "proj4";
import type { FeatureCollection, Position } from "geojson";
import "leaflet/dist/leaflet.css";
import "./reportBuilderPage.css";

// ── SVY21 (EPSG:3414) → WGS84 ───────────────────────────────────────────────
proj4.defs(
  "EPSG:3414",
  "+proj=tmerc +lat_0=1.366666666666667 +lon_0=103.8333333333333 +k=1 +x_0=28001.642 +y_0=38744.572 +ellps=WGS84 +units=m +no_defs"
);
const to4326 = (p: Position): [number, number] => {
  const [lon, lat] = proj4("EPSG:3414", "EPSG:4326", [p[0], p[1]]) as [number, number];
  return [lat, lon];
};

// ── Constants ────────────────────────────────────────────────────────────────
const CANVAS_W = 794;
const PAGE_H = 1123;
const PAGE_GAP = 24;
const LAYOUT_KEY = "psat_report_layout";

// ── Project Details paging ───────────────────────────────────────────────────
// Project Details renders ALL projects, chunked into pages of PROJ_PAGE_SIZE.
// Each non-final chunk is sized to exactly one PAGE_H so its boundary lands on
// the PDF page-break grid (a real page break in the report), instead of a
// click-to-paginate widget. Heights below are generous per-project estimates
// used both for chunk-fit and section sizing.
const PROJ_PAGE_SIZE = 5;
const PROJ_ROW_H = 188; // est. height of one project's detail block
const PROJ_HEADER_H = 66;  // full section header (first chunk)
const PROJ_CONT_HEADER_H = 30; // "(continued)" header (later chunks)

const RISK_COLORS: Record<number, string> = {
  1: "#87C424", 2: "#FFCC1A", 3: "#FF5B1A", 4: "#CD1AFF",
};
const RISK_LABELS: Record<number, string> = {
  1: "Low", 2: "Medium", 3: "High", 4: "Extreme",
};
const CRASH_TYPE_LABELS: Record<string, string> = {
  Overall: "Overall Risk", VB: "Vehicle–Bicycle", BB: "Bicycle–Bicycle",
  SB: "Single-Bicycle", BP: "Bicycle–Pedestrian",
};
const TREATMENT_NAMES: Record<number, string> = {
  1: "Upgrade to on-road bicycle lane with light segregation",
  2: "Safety barrier (Adjacent road 0-1m)",
  3: "Safety barrier (Adjacent road 1-3m)",
  4: "Upgrade to cycling-priority street",
  5: "Upgrade to multi-use path",
  6: "Upgrade to off-road bicycle path",
  7: "Convert to one-way facility",
  8: "Improve surface conditions",
  9: "Install light segregation",
  10: "Install street lighting",
  11: "Remove fixed obstacles",
  12: "Remove non-fixed obstacles",
  13: "Remove width restriction",
  14: "Improve facility access",
  15: "Redesign sharp curves",
  16: "Widen the facility",
  17: "Install protective barrier",
  18: "Improve delineation",
  19: "Review intersection approach",
  20: "Improve crossing facility",
  21: "Evaluate grade separation",
  22: "Reconfigure/remove parking",
  23: "Review tram/train rails",
  24: "Install traffic calming",
  25: "Bicycle speed control",
};

const METHODOLOGY_TEXT = `This report uses the CycleRAP (Cycling Road Assessment Programme) methodology to assess the safety of cycling infrastructure. Each segment is evaluated against a set of risk attributes covering facility design, surface quality, hazards, intersections, and usage patterns. A risk multiplier is computed for each attribute based on its coded value, and the combined score determines the segment's risk band (Low / Medium / High / Extreme) for four crash types: Vehicle–Bicycle (VB), Bicycle–Bicycle (BB), Single-Bicycle (SB), and Bicycle–Pedestrian (BP). Higher scores and bands indicate greater risk exposure and a greater need for intervention.`;

// ── Types ────────────────────────────────────────────────────────────────────
type ElementType =
  | "title" | "riskBands" | "map" | "summary" | "topRisk" | "treatmentSummary"
  | "projectDetails" | "riskStats" | "topAttributes" | "recommendations" | "methodology" | "segmentGallery"
  | "benchmarkStats";

type ViewMode = "grid" | "tabular" | "full-page";

interface ElementState {
  id: string; type: ElementType; label: string;
  x: number; y: number; width: number; height: number;
  visible: boolean; viewMode?: ViewMode; topN?: number;
}
type BandDist = Record<number, number>;
interface Distributions {
  VB: BandDist; BB: BandDist; SB: BandDist; BP: BandDist; Overall: BandDist;
}
interface TopRiskRow {
  _project: string; _segIndex: number; _sumScore: number; _maxBand: number;
  VB: number; "VB Band": number; BB: number; "BB Band": number;
  SB: number; "SB Band": number; BP: number; "BP Band": number;
  "Overall Risk Level Band"?: number;
  "Top 1 Contributor"?: string; "Top 1 Contribution"?: number;
  "Top 2 Contributor"?: string; "Top 2 Contribution"?: number;
  "Top 3 Contributor"?: string; "Top 3 Contribution"?: number;
  "Top 4 Contributor"?: string; "Top 4 Contribution"?: number;
  "Top 5 Contributor"?: string; "Top 5 Contribution"?: number;
}
interface EnrichedDetail {
  imageUrl?: string;
  topAttributes: { name: string; multiplier: number }[];
}
interface ProjectTreatmentSummary {
  project: string;
  treatedSegments: number;
  treatmentCounts: Record<number, number>;
}
interface GeoEntry { name: string; data: FeatureCollection }
interface StatEntry { min: string; max: string; avg: string }
interface ScoreStats {
  VB: StatEntry; BB: StatEntry; SB: StatEntry; BP: StatEntry; Overall: StatEntry;
}
interface FilterCategoryItem { category: string; isActive: boolean; color: string }
interface FilterCategoryStatus {
  attribute: string;
  categories: FilterCategoryItem[];
  rangeFilter?: { min: number; max: number; currentMin: number; currentMax: number };
}

// ── Default layout ───────────────────────────────────────────────────────────
// Page 1: title, summary (with filters), map
// Page 2: risk bands, top risk stretches
// Page 3+: treatments, supplementary (off by default)
// Auto-fit corrects positions on first load.
const DEFAULT_ELEMENTS: ElementState[] = [
  // — Page 1 —
  { id: "title", type: "title", label: "Title", x: 20, y: 20, width: 754, height: 205, visible: true },
  { id: "summary", type: "summary", label: "Summary", x: 20, y: 240, width: 754, height: 150, visible: true },
  { id: "map", type: "map", label: "Map", x: 20, y: 405, width: 754, height: 350, visible: true },
  // — Page 2 —
  { id: "benchmarkStats", type: "benchmarkStats", label: "Benchmarking Stats", x: 20, y: 1163, width: 754, height: 340, visible: false },
  { id: "riskBands", type: "riskBands", label: "Risk Bands", x: 20, y: 1523, width: 754, height: 450, visible: true },
  { id: "topAttributes", type: "topAttributes", label: "Risk Factors", x: 20, y: 1993, width: 754, height: 210, visible: true },
  { id: "projectDetails", type: "projectDetails", label: "Project Details", x: 20, y: 2223, width: 754, height: 220, visible: true },
  // — Page 3 —
  { id: "topRisk", type: "topRisk", label: "Top Risk Stretches", x: 20, y: 2463, width: 754, height: 730, visible: true, viewMode: "full-page", topN: 10 },
  { id: "treatmentSummary", type: "treatmentSummary", label: "Treatments", x: 20, y: 3213, width: 754, height: 360, visible: true },
];

// ── Shared table styles ──────────────────────────────────────────────────────
const thStyle: React.CSSProperties = {
  padding: "5px 8px", textAlign: "left", fontWeight: 600,
  fontSize: 10, color: "#555", borderBottom: "2px solid #e0d0f0", whiteSpace: "nowrap",
};
const tdStyle: React.CSSProperties = { padding: "3px 6px", fontSize: 10, color: "#333" };

// ── Small components ─────────────────────────────────────────────────────────
function SegmentImage({ src, width, height }: { src?: string; width: number | string; height: number | string }) {
  const [errored, setErrored] = useState(false);
  if (!src || errored) {
    return (
      <div style={{ width, height, background: "#eee", borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <span style={{ fontSize: 14, color: "#bbb" }}>No image available</span>
      </div>
    );
  }
  return <img src={src} alt="" onError={() => setErrored(true)} style={{ width, height, objectFit: "cover", borderRadius: 3, flexShrink: 0, display: "block" }} />;
}

function AttrTag({ name, multiplier }: { name: string; multiplier: number }) {
  return (
    <span style={{ fontSize: 9, color: "#555", display: "block", lineHeight: 1.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
      • {name} <span style={{ color: "#cc2200", fontWeight: 700 }}>+{multiplier.toFixed(1)}</span>
    </span>
  );
}

function TreatmentBadge({ ids }: { ids: number[] }) {
  if (ids.length === 0) return null;
  return (
    <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px dashed #d0e8d0" }}>
      <span style={{ fontSize: 8, fontWeight: 700, color: "#228833", letterSpacing: 0.3, display: "block", marginBottom: 2 }}>
        TREATMENTS APPLIED ({ids.length})
      </span>
      {ids.map((id) => (
        <span key={id} style={{ fontSize: 9, color: "#226633", display: "block", lineHeight: 1.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          ✓ {id}. {TREATMENT_NAMES[id] ?? `Treatment ${id}`}
        </span>
      ))}
    </div>
  );
}

// ── Inline editable text ─────────────────────────────────────────────────────
function EditableText({ value, onChange, style, placeholder }: {
  value: string; onChange: (v: string) => void;
  style?: React.CSSProperties; placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        defaultValue={value}
        onBlur={(e) => { onChange(e.target.value.trim() || value); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { onChange((e.target as HTMLInputElement).value.trim() || value); setEditing(false); }
          if (e.key === "Escape") setEditing(false);
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        autoFocus
        style={{ ...style, border: "1px solid #a020d0", borderRadius: 3, outline: "none", background: "#fff", padding: "1px 6px", fontFamily: "inherit", minWidth: 80, boxSizing: "border-box" }}
      />
    );
  }
  return (
    <span
      style={{ ...style, cursor: "text", borderRadius: 2 }}
      title="Click to edit"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {value || <span style={{ color: "#ccc", fontStyle: "italic" }}>{placeholder ?? "—"}</span>}
      <span style={{ marginLeft: 3, fontSize: "0.65em", color: "#a020d0", opacity: 0.45, verticalAlign: "middle" }}>✎</span>
    </span>
  );
}

// ── Leaflet map sub-components ───────────────────────────────────────────────
function FitAllBounds({ points }: { points: L.LatLngExpression[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    map.fitBounds(L.latLngBounds(points), { padding: [20, 20] });
  }, [points, map]);
  return null;
}

function ReportMiniMap({ projects, bandMap, orderIndex }: { projects: string[]; bandMap: Map<string, number>; orderIndex: number }) {
  const [geoEntries, setGeoEntries] = useState<GeoEntry[]>([]);
  // The MapContainer key combines a per-mount random base with the section's
  // position in the report (`orderIndex`). react-leaflet 5 creates the Leaflet
  // map in a ref callback guarded by `!mapInstanceRef.current` and only removes
  // it on unmount — so when a section reorder moves the map's subtree, React
  // keeps the same fiber/<div> and Leaflet never re-inits cleanly, eventually
  // throwing "Map container is being reused by another instance". Folding
  // `orderIndex` into the key turns each reorder into a deliberate clean
  // remount: the old MapContainer unmounts (its effect cleanup calls
  // `map.remove()`, clearing `_leaflet_id`) and a brand-new <div> is created.
  // `geoEntries` lives in this component's state (not remounted), so the
  // reorder rebuilds only the Leaflet map — no geodata refetch.
  const mapBase = useRef(`reportmap-${Math.random().toString(36).slice(2)}`);
  const mapKey = `${mapBase.current}-${orderIndex}`;

  useEffect(() => {
    if (projects.length === 0) return;
    setGeoEntries([]);
    Promise.all(
      projects.map(async (name) => {
        try {
          const res = await fetch(`/api/projects/${encodeURIComponent(name)}/geodata`);
          return { name, data: await res.json() } as GeoEntry;
        } catch { return null; }
      })
    ).then((r) => setGeoEntries(r.filter(Boolean) as GeoEntry[]));
  }, [projects]);

  // One point per scored segment, placed at the LineString's first coordinate —
  // mirrors PathAnalysisPage's map (CircleMarker points, not lines).
  const points = useMemo(() => {
    const out: { key: string; latlng: [number, number]; color: string }[] = [];
    geoEntries.forEach(({ name, data }) => {
      data.features?.forEach((f, i) => {
        const g = f.geometry;
        if (g?.type !== "LineString" || !Array.isArray(g.coordinates) || g.coordinates.length === 0) return;
        // Use array index (1-based) to look up band — consistent with how _segIndex is set in score rows
        const band = bandMap.get(`${name}_${i + 1}`);
        // Skip features with no scored band — eliminates connector/padding features
        if (band === undefined) return;
        out.push({ key: `${name}_${i}`, latlng: to4326(g.coordinates[0]), color: RISK_COLORS[band] });
      });
    });
    return out;
  }, [geoEntries, bandMap]);
  const latlngs = useMemo(() => points.map((p) => p.latlng), [points]);

  return (
    <MapContainer key={mapKey} style={{ width: "100%", height: "100%" }} center={[1.35, 103.82]} zoom={12} scrollWheelZoom zoomControl>
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
      />
      {points.map(({ key, latlng, color }) => (
        <CircleMarker
          key={key}
          center={latlng}
          radius={5}
          pathOptions={{ color, weight: 1, opacity: 0.9, fillOpacity: 0.8 }}
        />
      ))}
      <FitAllBounds points={latlngs} />
    </MapContainer>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
// ── Page-break avoidance ──────────────────────────────────────────────────────
// If placing an element at `y` with height `h` would straddle a page break,
// push it to just after the break. Elements taller than a full page are left
// as-is (nothing we can do without splitting them).
function avoidPageBreak(y: number, h: number, margin = 20): number {
  if (h >= PAGE_H) return y;
  // Push sections that land inside the shadow zone at the top of a new page
  const prevBreak = Math.floor(y / PAGE_H) * PAGE_H;
  if (prevBreak > 0 && y < prevBreak + margin) {
    return avoidPageBreak(prevBreak + margin, h, margin);
  }
  // Push sections that straddle the next page break, ONLY if they can fit on a single page
  const nextBreak = Math.ceil(y / PAGE_H) * PAGE_H;
  const usableH = PAGE_H - PAGE_GAP - margin;
  if (nextBreak > y && y + h > nextBreak - PAGE_GAP && h <= usableH) {
    return avoidPageBreak(nextBreak + margin, h, margin);
  }
  return y;
}

// ── Flow layout (replaces resolveOverlaps) ───────────────────────────────────
// Sections now render in document flow in array order (dnd-kit drives the order).
// This pass turns the ordered list + per-section heights into the `marginTop`
// spacer each section needs: a constant 10px gap, plus any extra push required
// so the section doesn't straddle a page break (avoidPageBreak). `top` is kept
// for reference/debug; `bottom` is the total stacked height for canvas sizing.
interface FlowEntry { height: number; top: number; marginTop: number }
function computeFlowLayout(
  visible: ElementState[],
  heightOf: (el: ElementState) => number,
): { map: Map<string, FlowEntry>; bottom: number } {
  const map = new Map<string, FlowEntry>();
  let cursor = 20;     // top padding before the first section
  let prevBottom = 0;  // bottom edge of the previously placed section
  for (const el of visible) {
    const height = heightOf(el);
    let top = avoidPageBreak(cursor, height);
    // Project Details chunks projects into PAGE_H-tall pages. When it spans more
    // than one page it must begin exactly on a page boundary so every internal
    // chunk boundary coincides with the PDF slice grid (real page breaks).
    if ((el.type === "projectDetails" || (el.type === "topRisk" && el.viewMode === "full-page")) && height > PAGE_H && prevBottom > 0) {
      top = Math.ceil(cursor / PAGE_H) * PAGE_H;
    }
    map.set(el.id, { height, top, marginTop: top - prevBottom });
    prevBottom = top + height;
    cursor = prevBottom + 10;
  }
  return { map, bottom: prevBottom };
}

// ── Read saved layout once (used by lazy state initialisers below) ──────────
function _readSaved(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ── Report section (canvas) ──────────────────────────────────────────────────
// One per visible section, laid out in normal document flow + a `marginTop`
// spacer (page-break avoidance). Reordering is done from the left Sections panel,
// so these are static — not draggable.
function ReportSection({
  id, label, height, marginTop, onHide, children,
}: {
  id: string; label: string; height: number; marginTop: number;
  onHide: () => void; children: React.ReactNode;
}) {
  const style: React.CSSProperties = {
    position: "relative",
    marginLeft: 20,
    width: CANVAS_W - 40,
    height,
    marginTop,
    zIndex: 1,
  };
  return (
    <div style={style}>
      <div className="rb-element" data-element-id={id}>
        <button
          className="rb-element-close"
          onClick={onHide}
          title={`Hide ${label}`}
          aria-label={`Hide ${label}`}
        >×</button>
        <div className="rb-element-body">
          <SectionErrorBoundary label={label} resetKeys={[marginTop, height]}>
            {children}
          </SectionErrorBoundary>
        </div>
      </div>
    </div>
  );
}

// ── Compact reorder-list row (the "Sections" panel) ──────────────────────────
// A lightweight row — grip handle + visibility checkbox + label — for reordering
// sections without dragging the full (map/chart-heavy) canvas section. Shares
// the same `elements` array order, so reordering here reorders the report.
function SortableSectionRow({
  id, label, visible, onToggle, onSelect, children
}: {
  id: string; label: string; visible: boolean; onToggle: () => void; onSelect?: () => void; children?: React.ReactNode;
}) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 2 : 1,
  };

  if (children) {
    return (
      <div ref={setNodeRef} style={{ ...style, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 0, padding: "6px 0 0 0" }} className={`rb-reorder-row${isDragging ? " rb-reorder-row-dragging" : ""}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px 6px", boxSizing: "border-box" }}>
          <span
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            className="rb-reorder-grip"
            title="Drag to reorder"
            aria-label={`Reorder ${label}`}
            style={{ cursor: isDragging ? "grabbing" : "grab", touchAction: "none" }}
          >
            <GripVertical size={16} />
          </span>
          <input
            type="checkbox"
            checked={visible}
            onChange={onToggle}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ accentColor: "#a020d0", cursor: "pointer", flexShrink: 0 }}
            title={visible ? "Hide section" : "Show section"}
          />
          <span
            className="rb-reorder-label"
            style={{ opacity: visible ? 1 : 0.45, cursor: onSelect && visible ? "pointer" : "default" }}
            onClick={onSelect && visible ? onSelect : undefined}
            title={onSelect && visible ? "Scroll to this section" : undefined}
          >{label}</span>
        </div>
        <div style={{ width: "100%", boxSizing: "border-box" }}>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} className={`rb-reorder-row${isDragging ? " rb-reorder-row-dragging" : ""}`}>
      <span
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="rb-reorder-grip"
        title="Drag to reorder"
        aria-label={`Reorder ${label}`}
        style={{ cursor: isDragging ? "grabbing" : "grab", touchAction: "none" }}
      >
        <GripVertical size={16} />
      </span>
      <input
        type="checkbox"
        checked={visible}
        onChange={onToggle}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ accentColor: "#a020d0", cursor: "pointer", flexShrink: 0 }}
        title={visible ? "Hide section" : "Show section"}
      />
      <span
        className="rb-reorder-label"
        style={{ opacity: visible ? 1 : 0.45, cursor: onSelect && visible ? "pointer" : "default" }}
        onClick={onSelect && visible ? onSelect : undefined}
        title={onSelect && visible ? "Scroll to this section" : undefined}
      >{label}</span>
    </div>
  );
}

export default function ReportBuilderPage() {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const hasAutoFit = useRef(false);

  // ── State: auto-restored from localStorage if a saved layout exists ──────
  const [elements, setElements] = useState<ElementState[]>(() => {
    const REMOVED_IDS = new Set(["riskStats", "recommendations", "methodology", "segmentGallery", "deepDive", "filterAnalysis"]);
    const l = _readSaved();
    if (Array.isArray(l?.elements)) {
      // Migration: display order is now driven by array order, not `el.y`.
      // Pre-dnd-kit layouts encoded their arrangement purely in `y` (react-rnd
      // never reordered the array), so sort by `y` once to preserve it.
      const saved = (l.elements as ElementState[])
        .filter((e) => !REMOVED_IDS.has(e.id))
        .sort((a, b) => a.y - b.y);
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
    const l = _readSaved(); return typeof l?.reportTitle === "string" ? l.reportTitle : "Path Safety Analysis Executive Summary";
  });
  const [projectNameOverrides, setProjectNameOverrides] = useState<Record<string, string>>(() => {
    const l = _readSaved(); return (l?.projectNameOverrides && typeof l.projectNameOverrides === "object") ? l.projectNameOverrides as Record<string, string> : {};
  });
  const [sectionTitles, setSectionTitles] = useState<Record<string, string>>(() => {
    const l = _readSaved(); return (l?.sectionTitles && typeof l.sectionTitles === "object") ? l.sectionTitles as Record<string, string> : {};
  });
  const [oicName, setOicName] = useState(() => {
    const l = _readSaved(); return typeof l?.oicName === "string" ? l.oicName : "";
  });
  const [purpose, setPurpose] = useState(() => {
    const l = _readSaved(); return typeof l?.purpose === "string" ? l.purpose : "";
  });
  const [recommendations, setRecommendations] = useState(() => {
    const l = _readSaved(); return typeof l?.recommendations === "string" ? l.recommendations : "";
  });
  const [reportDate, setReportDate] = useState(() => {
    const l = _readSaved(); return typeof l?.reportDate === "string" ? l.reportDate : new Date().toISOString().split("T")[0];
  });
  const [imageDate, setImageDate] = useState(() => {
    const l = _readSaved(); return typeof l?.imageDate === "string" ? l.imageDate : "";
  });

  // ── Projects ─────────────────────────────────────────────────────────────
  const [loadedProjects, setLoadedProjects] = useState<string[]>([]);

  // ── Score data ────────────────────────────────────────────────────────────
  const [distributions, setDistributions] = useState<Distributions | null>(null);
  const [totalSegments, setTotalSegments] = useState(0);
  const [projectSegmentCounts, setProjectSegmentCounts] = useState<Record<string, number>>({});
  const [topRiskRows, setTopRiskRows] = useState<TopRiskRow[]>([]);
  const [allScoreRows, setAllScoreRows] = useState<TopRiskRow[]>([]);
  const [allBandMap, setAllBandMap] = useState<Map<string, number>>(new Map());
  const [enrichedMap, setEnrichedMap] = useState<Map<string, EnrichedDetail>>(new Map());
  const [isLoadingScores, setIsLoadingScores] = useState(false);

  // ── Treatment data ────────────────────────────────────────────────────────
  const [treatmentSummaries, setTreatmentSummaries] = useState<ProjectTreatmentSummary[]>([]);
  const [segmentTreatmentMap, setSegmentTreatmentMap] = useState<Map<string, number[]>>(new Map());

  // ── Project metadata (name, dates, length) ────────────────────────────────
  const [projectMeta, setProjectMeta] = useState<Record<string, { dateCreated?: string; lastUpdated?: string; lengthKm?: number }>>({});

  // ── Path Analysis filter sync ─────────────────────────────────────────────
  const [activeFilterNames, setActiveFilterNames] = useState<string[]>([]);
  const [activeCategoryStatus, setActiveCategoryStatus] = useState<FilterCategoryStatus[]>([]);

  const [exporting, setExporting] = useState<"pdf" | "word" | null>(null);
  const [hasSaved, setHasSaved] = useState(() => { try { return !!localStorage.getItem(LAYOUT_KEY); } catch { return false; } });
  const [saveToastVisible, setSaveToastVisible] = useState(false);
  const saveToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // true when this mount auto-restored a previously saved layout
  const [wasAutoRestored] = useState(() => { try { return !!localStorage.getItem(LAYOUT_KEY); } catch { return false; } });
  const [restoreBannerVisible, setRestoreBannerVisible] = useState(wasAutoRestored);

  // ── Project picker (shown when session storage has no projects) ───────────
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [availableProjects, setAvailableProjects] = useState<string[]>([]);
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());
  const [pickerLoading, setPickerLoading] = useState(false);

  // ── Session storage ───────────────────────────────────────────────────────
  useEffect(() => {
    const pa = sessionStorage.getItem("pathAnalysis_loadedProjects");
    const tr = sessionStorage.getItem("treatment_loadedProjects");
    const filters = sessionStorage.getItem("pathAnalysis_activeFilters");
    const catStatus = sessionStorage.getItem("pathAnalysis_categoryStatus");
    const paP: string[] = pa ? JSON.parse(pa) : [];
    const trP: string[] = tr ? JSON.parse(tr) : [];
    const flt: string[] = filters ? JSON.parse(filters) : [];
    const cst: FilterCategoryStatus[] = catStatus ? JSON.parse(catStatus) : [];
    const combined = [...new Set([...paP, ...trP])];
    setLoadedProjects(combined);
    setActiveFilterNames(flt);
    setActiveCategoryStatus(cst);
    if (combined.length === 0) {
      setPickerLoading(true);
      fetch("/api/projects")
        .then((r) => r.json())
        .then((d) => {
          const names: string[] = (d.projects ?? []).map((p: { name: string }) => p.name).sort();
          setAvailableProjects(names);
          setShowProjectPicker(true);
        })
        .catch(() => setShowProjectPicker(true))
        .finally(() => setPickerLoading(false));
    }
  }, []);


  // ── Project metadata fetch (dates + route length) ────────────────────────
  useEffect(() => {
    if (loadedProjects.length === 0) return;
    const fetchMeta = async () => {
      const entries = await Promise.all(
        loadedProjects.map(async (name) => {
          try {
            const metaRes = await fetch(`/api/projects/${encodeURIComponent(name)}/metadata`);
            const meta = await metaRes.json();
            return {
              name,
              dateCreated: meta.date_created ?? undefined,
              lastUpdated: meta.last_updated ?? undefined,
            };
          } catch { return null; }
        })
      );
      const map: Record<string, { dateCreated?: string; lastUpdated?: string; lengthKm?: number }> = {};
      entries.forEach((e) => { if (e) map[e.name] = { dateCreated: e.dateCreated, lastUpdated: e.lastUpdated }; });
      setProjectMeta(map);
    };
    fetchMeta();
  }, [loadedProjects]);

  // ── Auto-populate Image Date from the earliest project survey date ────────
  useEffect(() => {
    const dates = Object.values(projectMeta)
      .map((m) => m.dateCreated)
      .filter(Boolean) as string[];
    if (dates.length === 0) return;
    const earliest = dates.sort()[0].split("T")[0]; // YYYY-MM-DD
    setImageDate(earliest);
  }, [projectMeta]);

  // ── Score data fetch ──────────────────────────────────────────────────────
  useEffect(() => {
    if (loadedProjects.length === 0) return;
    const fetchAll = async () => {
      setIsLoadingScores(true);
      try {
        const results = await Promise.all(
          loadedProjects.map(async (name) => {
            try {
              const res = await fetch(`/api/projects/${encodeURIComponent(name)}/results`);
              const data = await res.json();
              if (!data.ok || !Array.isArray(data.result_rows)) return { name, rows: [] };
              return { name, rows: data.result_rows.map((row: Record<string, unknown>, i: number) => ({ ...row, _project: name, _segIndex: i + 1 })) };
            } catch { return { name, rows: [] as unknown[] }; }
          })
        );
        const counts: Record<string, number> = {};
        const allRows: TopRiskRow[] = [];
        results.forEach(({ name, rows }) => { counts[name] = (rows as TopRiskRow[]).length; allRows.push(...(rows as TopRiskRow[])); });
        setProjectSegmentCounts(counts);
        setTotalSegments(allRows.length);
        if (allRows.length === 0) return;

        const dist: Distributions = {
          VB: { 1: 0, 2: 0, 3: 0, 4: 0 }, BB: { 1: 0, 2: 0, 3: 0, 4: 0 },
          SB: { 1: 0, 2: 0, 3: 0, 4: 0 }, BP: { 1: 0, 2: 0, 3: 0, 4: 0 },
          Overall: { 1: 0, 2: 0, 3: 0, 4: 0 },
        };
        const bMap = new Map<string, number>();
        allRows.forEach((row) => {
          if (row["VB Band"] >= 1 && row["VB Band"] <= 4) dist.VB[row["VB Band"]]++;
          if (row["BB Band"] >= 1 && row["BB Band"] <= 4) dist.BB[row["BB Band"]]++;
          if (row["SB Band"] >= 1 && row["SB Band"] <= 4) dist.SB[row["SB Band"]]++;
          if (row["BP Band"] >= 1 && row["BP Band"] <= 4) dist.BP[row["BP Band"]]++;
          // Overall band = max of the four individual bands (matches backend logic)
          const overall = row["Overall Risk Level Band"] ??
            Math.max(row["VB Band"] || 0, row["BB Band"] || 0, row["SB Band"] || 0, row["BP Band"] || 0);
          if (overall >= 1 && overall <= 4) { dist.Overall[overall]++; bMap.set(`${row._project}_${row._segIndex}`, overall); }
        });
        setDistributions(dist);
        setAllBandMap(bMap);

        const withSum = allRows.map((row) => {
          const sumScore = (row["VB"] || 0) + (row["BB"] || 0) + (row["SB"] || 0) + (row["BP"] || 0);
          const maxBand = row["Overall Risk Level Band"] ??
            Math.max(row["VB Band"] || 0, row["BB Band"] || 0, row["SB Band"] || 0, row["BP Band"] || 0);
          return { ...row, _sumScore: sumScore, _maxBand: maxBand };
        }).sort((a, b) => b._sumScore - a._sumScore);

        setAllScoreRows(withSum);
        setTopRiskRows(withSum.slice(0, 10));
      } finally {
        setIsLoadingScores(false);
      }
    };
    fetchAll();
  }, [loadedProjects]);

  // ── Enrichment fetch ──────────────────────────────────────────────────────
  useEffect(() => {
    if (topRiskRows.length === 0) return;
    const go = async () => {
      try {
        const res = await fetch("/api/report/segment-details", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ segments: topRiskRows.map((r) => ({ project: r._project, segIndex: r._segIndex })) }),
        });
        const data = await res.json();
        if (data.ok && Array.isArray(data.details)) {
          const map = new Map<string, EnrichedDetail>();
          data.details.forEach((d: { project: string; segIndex: number; imageUrl?: string; topAttributes?: { name: string; multiplier: number }[] }) => {
            map.set(`${d.project}_${d.segIndex}`, { imageUrl: d.imageUrl ?? undefined, topAttributes: d.topAttributes || [] });
          });
          setEnrichedMap(map);
        }
      } catch (err) { console.error("Enrichment failed:", err); }
    };
    go();
  }, [topRiskRows]);

  // ── Treatment fetch ───────────────────────────────────────────────────────
  useEffect(() => {
    if (loadedProjects.length === 0) return;
    const go = async () => {
      const newSegTreatMap = new Map<string, number[]>();
      const summaries = await Promise.all(
        loadedProjects.map(async (name) => {
          try {
            const res = await fetch(`/api/projects/${encodeURIComponent(name)}/treatments/all`);
            const data = await res.json();
            if (!data.ok) return null;
            const segments = (data.segments || {}) as Record<string, { treatments_applied?: number[] }>;
            const treatmentCounts: Record<number, number> = {};
            Object.entries(segments).forEach(([idx, seg]) => {
              const ids = seg.treatments_applied || [];
              if (ids.length > 0) {
                newSegTreatMap.set(`${name}_${parseInt(idx) + 1}`, ids);
                ids.forEach((id) => { treatmentCounts[id] = (treatmentCounts[id] || 0) + 1; });
              }
            });
            return { project: name, treatedSegments: Object.keys(segments).length, treatmentCounts } as ProjectTreatmentSummary;
          } catch { return null; }
        })
      );
      setSegmentTreatmentMap(newSegTreatMap);
      setTreatmentSummaries(summaries.filter(Boolean) as ProjectTreatmentSummary[]);
    };
    go();
  }, [loadedProjects]);

  // ── Derived / computed ────────────────────────────────────────────────────
  const scoreStats = useMemo((): ScoreStats | null => {
    if (allScoreRows.length === 0) return null;
    const stat = (vals: number[]): StatEntry => {
      const sorted = [...vals].sort((a, b) => a - b);
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      return { min: sorted[0].toFixed(1), max: sorted[sorted.length - 1].toFixed(1), avg: avg.toFixed(1) };
    };
    return {
      VB: stat(allScoreRows.map((r) => r.VB || 0)),
      BB: stat(allScoreRows.map((r) => r.BB || 0)),
      SB: stat(allScoreRows.map((r) => r.SB || 0)),
      BP: stat(allScoreRows.map((r) => r.BP || 0)),
      Overall: stat(allScoreRows.map((r) => r._sumScore || 0)),
    };
  }, [allScoreRows]);

  const attributeFrequency = useMemo(() => {
    const count = new Map<string, number>();
    allScoreRows.forEach((row) => {
      for (let i = 1; i <= 3; i++) {
        const name = row[`Top ${i} Contributor` as keyof TopRiskRow] as string | undefined;
        if (name) count.set(name, (count.get(name) || 0) + 1);
      }
    });
    return [...count.entries()].sort(([, a], [, b]) => b - a).slice(0, 10);
  }, [allScoreRows]);

  // Total length = segments × 10 m per segment (CycleRAP standard segment length)
  const totalKm = useMemo(
    () => totalSegments * 10 / 1000,
    [totalSegments]
  );

  // ── Ideal height per element type (based on current data) ────────────────
  const computeIdealHeight = useCallback((el: ElementState): number => {
    const H = 30; // handle
    switch (el.type) {
      case "title": {
        // The "Projects:" line wraps when many/long project names are listed;
        // each extra wrapped line pushes the date inputs down. Without accounting
        // for this the fixed-height body (overflow:hidden) clips the bottom rows.
        const projChars = loadedProjects.reduce((s, n) => s + (projectNameOverrides[n] ?? n).length + 2, 9 /* "Projects: " */);
        const projLines = Math.max(1, Math.ceil(projChars / 80)); // ~80 chars/line at fontSize 12 across 754px
        return H + 160 + projLines * 17;
      }
      case "riskBands": return H + (distributions ? 480 : 60);
      case "map": return H + 350;
      case "summary": {
        // The "Active Filters" panel grows one row per filter, and each row's
        // category chips wrap — a flat constant clips it once >1 filter is set.
        if (activeFilterNames.length === 0) return H + 110;
        let h = H + 110 + 38; // base stats + panel padding/label
        activeFilterNames.forEach((fn) => {
          const st = activeCategoryStatus.find((s) => s.attribute === fn);
          const chips = st?.rangeFilter ? 1 : Math.max(1, st?.categories.length ?? 1);
          h += Math.max(1, Math.ceil(chips / 5)) * 18 + 6; // wrapped chip lines + row gap
        });
        return h;
      }
      case "topRisk": {
        const n = el.topN ?? 10;
        const header = 60;   // title + subtitle
        const thead = 36;   // table header row
        if (el.viewMode === "full-page") {
          // Exactly one stretch per page. Total height = n * PAGE_H.
          // Since the section itself includes a header (about 60px), we reserve n full pages.
          return n * PAGE_H;
        }
        if (!el.viewMode || el.viewMode === "tabular") return H + header + thead + n * 52 + 24;
        return H + header + Math.ceil(n / 3) * 240 + 24; // grid
      }
      case "treatmentSummary": {
        if (treatmentSummaries.length === 0) return H + 100;
        let h = H + 36;
        treatmentSummaries.forEach((ts) => { h += 54 + Object.keys(ts.treatmentCounts).length * 38 + 18; });
        return h + 16;
      }
      case "projectDetails": {
        if (loadedProjects.length === 0) return H + 60;
        // All projects render, chunked PROJ_PAGE_SIZE per PAGE_H-tall page. Each
        // non-final chunk occupies a full page; the section's total height is
        // (chunks-1) full pages + the natural height of the final chunk.
        const numChunks = Math.ceil(loadedProjects.length / PROJ_PAGE_SIZE);
        const lastCount = loadedProjects.length - (numChunks - 1) * PROJ_PAGE_SIZE;
        const headerH = numChunks > 1 ? PROJ_CONT_HEADER_H : PROJ_HEADER_H;
        const lastChunkH = H + headerH + lastCount * PROJ_ROW_H + 16;
        return (numChunks - 1) * PAGE_H + lastChunkH;
      }
      case "benchmarkStats": return H + 36 + 32 + 5 * 56 + 24; // header + thead + 5 rows (VB/BB/SB/BP/Overall) + footer
      case "riskStats": return H + 36 + (scoreStats ? 5 * 54 + 24 : 50); // each row: label line + range bar + scale labels + spacing
      case "topAttributes": return H + 36 + (attributeFrequency.length > 0 ? attributeFrequency.length * 34 + 16 : 50);
      case "recommendations": {
        // Auto-suggestion panel grows one (often wrapping) line per top risk
        // factor; flat 120 clipped the panel + textarea when several appear.
        const sug = Math.min(5, attributeFrequency.length) + (topRiskRows.some((r) => r._maxBand === 4) ? 1 : 0);
        const boxH = sug > 0 ? 30 + sug * 24 : 0;
        return H + 36 + boxH + 78; // + editable notes textarea (min height) & gaps
      }
      case "methodology": return H + 36 + 290; // intro paragraph (~5 wrapped lines) + thresholds table (6 rows) + segment-length note
      case "segmentGallery": return H + 36 + Math.max(1, Math.ceil(topRiskRows.length / 6)) * 92 + 16;
      default: return el.height;
    }
  }, [distributions, treatmentSummaries, loadedProjects, projectMeta, scoreStats, attributeFrequency, topRiskRows, activeFilterNames, activeCategoryStatus, projectNameOverrides]);

  // ── Auto-fit: snapshot ideal heights into state ───────────────────────────
  // Gap removal and page-break spacing are now automatic (see `layout` memo +
  // computeFlowLayout), so this only persists each section's ideal height so
  // saved layouts carry accurate `height` values. Order/`y` are untouched.
  const autoFitElements = useCallback(() => {
    setElements((prev) =>
      prev.map((el) => (el.visible ? { ...el, height: computeIdealHeight(el) } : el)),
    );
  }, [computeIdealHeight]);

  // ── Auto-fit on first data load ───────────────────────────────────────────
  // Must come after autoFitElements is defined to avoid a TDZ crash.
  useEffect(() => {
    if (!distributions || hasAutoFit.current) return;
    hasAutoFit.current = true;
    setTimeout(autoFitElements, 150);
  }, [distributions, autoFitElements]);

  // ── Element helpers ───────────────────────────────────────────────────────
  const updateElement = useCallback((id: string, changes: Partial<ElementState>) => {
    setElements((prev) => prev.map((el) => (el.id === id ? { ...el, ...changes } : el)));
  }, []);
  const hideElement = useCallback((id: string) => updateElement(id, { visible: false }), [updateElement]);
  const showElement = useCallback((id: string) => {
    setElements((prev) => {
      const target = prev.find((e) => e.id === id);
      if (!target) return prev;
      const h = computeIdealHeight(target);
      // Re-show and move to the end of the array so it stacks below all other
      // visible sections (array order drives display order).
      const updated = [
        ...prev.filter((e) => e.id !== id),
        { ...target, visible: true, height: h },
      ];
      // Scroll the canvas to the bottom once the new section has laid out.
      setTimeout(() => {
        const c = canvasContainerRef.current;
        if (c) c.scrollTo({ top: c.scrollHeight, behavior: "smooth" });
      }, 30);
      return updated;
    });
  }, [computeIdealHeight]);

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
  const getEnriched = (row: TopRiskRow): EnrichedDetail => {
    const fromMap = enrichedMap.get(`${row._project}_${row._segIndex}`);
    // Pull top contributors directly from the scoring result row (already computed during scoring)
    const topAttributes: { name: string; multiplier: number }[] = [];
    for (let i = 1; i <= 5; i++) {
      const name = row[`Top ${i} Contributor` as keyof TopRiskRow] as string | undefined;
      const contribution = row[`Top ${i} Contribution` as keyof TopRiskRow] as number | undefined;
      if (name && contribution != null && contribution > 0) {
        topAttributes.push({ name, multiplier: contribution });
      }
    }
    return {
      imageUrl: fromMap?.imageUrl,
      topAttributes: topAttributes.length > 0 ? topAttributes : (fromMap?.topAttributes ?? []),
    };
  };
  const getSegmentTreatments = (row: TopRiskRow): number[] =>
    segmentTreatmentMap.get(`${row._project}_${row._segIndex}`) ?? [];

  // ── Display-name helpers ──────────────────────────────────────────────────
  const dispName = useCallback(
    (name: string) => projectNameOverrides[name] ?? name,
    [projectNameOverrides]
  );
  const setProjectName = useCallback(
    (orig: string, display: string) =>
      setProjectNameOverrides((prev) => ({ ...prev, [orig]: display })),
    []
  );
  const secTitle = useCallback(
    (id: string, defaultTitle: string) => sectionTitles[id] ?? defaultTitle,
    [sectionTitles]
  );
  const setSecTitle = useCallback(
    (id: string, title: string) =>
      setSectionTitles((prev) => ({ ...prev, [id]: title })),
    []
  );

  // ── Save / Restore layout ─────────────────────────────────────────────────
  const saveLayout = useCallback(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({
        elements, reportTitle, oicName, purpose, recommendations,
        reportDate, imageDate, projectNameOverrides, sectionTitles,
      }));
      setHasSaved(true);
      setSaveToastVisible(true);
      if (saveToastTimerRef.current) clearTimeout(saveToastTimerRef.current);
      saveToastTimerRef.current = setTimeout(() => setSaveToastVisible(false), 4000);
    } catch (e) { console.error("Save layout failed:", e); }
  }, [elements, reportTitle, oicName, purpose, recommendations, reportDate, imageDate, projectNameOverrides, sectionTitles]);

  const restoreLayout = useCallback(() => {
    try {
      const saved = localStorage.getItem(LAYOUT_KEY);
      if (!saved) return;
      const l = JSON.parse(saved);
      if (l.elements) setElements(l.elements);
      if (l.reportTitle !== undefined) setReportTitle(l.reportTitle);
      if (l.oicName !== undefined) setOicName(l.oicName);
      if (l.purpose !== undefined) setPurpose(l.purpose);
      if (l.recommendations !== undefined) setRecommendations(l.recommendations);
      if (l.reportDate !== undefined) setReportDate(l.reportDate);
      if (l.imageDate !== undefined) setImageDate(l.imageDate);
      if (l.projectNameOverrides !== undefined) setProjectNameOverrides(l.projectNameOverrides);
      if (l.sectionTitles !== undefined) setSectionTitles(l.sectionTitles);
    } catch (e) { console.error("Restore layout failed:", e); }
  }, []);

  const resetLayout = useCallback(() => {
    if (window.confirm("Are you sure you want to reset the layout to default? All unsaved changes will be lost.")) {
      localStorage.removeItem(LAYOUT_KEY);
      setElements(DEFAULT_ELEMENTS);
      setReportTitle("Path Safety Analysis Executive Summary");
      setOicName("");
      setPurpose("");
      setRecommendations("");
      setReportDate(new Date().toISOString().split("T")[0]);
      setImageDate("");
      setProjectNameOverrides({});
      setSectionTitles({});
      setHasSaved(false);
    }
  }, []);

  // ── Project picker confirm ────────────────────────────────────────────────
  const loadSelectedProjects = useCallback(() => {
    setLoadedProjects([...pickerSelected]);
    setShowProjectPicker(false);
  }, [pickerSelected]);

  // ── Page navigation ───────────────────────────────────────────────────────
  const goToPage = useCallback((page: number) => {
    setCurrentPage(page);
    if (!canvasContainerRef.current || !canvasRef.current) return;
    const canvasTop = canvasRef.current.offsetTop;
    canvasContainerRef.current.scrollTo({ top: canvasTop + page * PAGE_H, behavior: "smooth" });
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
  }, []);

  const handleCanvasScroll = useCallback(() => {
    if (!canvasContainerRef.current || !canvasRef.current) return;
    const scrolled = canvasContainerRef.current.scrollTop;
    const canvasTop = canvasRef.current.offsetTop;
    const scrollInCanvas = Math.max(0, scrolled - canvasTop);
    setCurrentPage(Math.floor(scrollInCanvas / PAGE_H));
  }, []);

  // ── PDF export ────────────────────────────────────────────────────────────
  const handleDownloadPDF = async () => {
    if (!canvasRef.current) return;
    setExporting("pdf");
    try {
      const canvas = canvasRef.current;
      const restore: Array<() => void> = [];

      // Hide decorative page labels so they don't appear in the PDF
      canvas.querySelectorAll<HTMLElement>(".rb-page-label").forEach((el) => {
        const prev = el.style.visibility;
        el.style.visibility = "hidden";
        restore.push(() => { el.style.visibility = prev; });
      });

      // WYSIWYG capture — do NOT mutate section heights here.
      //
      // The canvas is A4-proportioned by construction (CANVAS_W 794px ≈ 210mm,
      // PAGE_H 1123px ≈ 297mm at 96 DPI). `computeFlowLayout` + `avoidPageBreak`
      // insert `marginTop` spacers so no section straddles a PAGE_H boundary, and
      // the PDF below slices the captured image on that exact same 297mm/PAGE_H
      // grid. The preview draws its page-break markers on the same grid too.
      //
      // Previously this function expanded every `.rb-element` to its scrollHeight
      // (to reveal text that overflowed the estimated section height). But the
      // image is still sliced on the fixed PAGE_H grid, so any expanded section
      // pushed all following sections downward → positions no longer matched the
      // preview, sections straddled page breaks (the marginTop spacers were
      // computed for the un-expanded heights), and the map (a later section) was
      // displaced. Each section is already sized to its content by
      // `computeIdealHeight` in the preview, so capturing the canvas exactly as
      // rendered keeps the PDF identical to what the user sees and aligned to the
      // page grid. (If a section ever clips, fix its `computeIdealHeight` estimate
      // so the preview grows too — never re-expand only at export time.)
      //
      // html2canvas renders the text of native form controls (<input>, <textarea>)
      // with broken vertical alignment — the value/placeholder is drawn *below* the
      // box (visible on the Title section's OIC/Purpose/Date fields). Fix it in the
      // cloned capture doc only (live UI untouched): replace each field with a <div>
      // holding the same text, vertically centred via flex. Match each clone to its
      // live counterpart by index to copy the exact rendered height so layout (and
      // thus the page-break grid) is preserved.
      const liveFields = Array.from(
        canvas.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"),
      ).filter((f) => !(f instanceof HTMLInputElement && (f.type === "checkbox" || f.type === "radio")));

      // Ensure every <img> (segment photos, etc.) has finished decoding before
      // capture — html2canvas draws whatever is loaded at call time, so an export
      // fired right after the page loads could otherwise capture blank images.
      await Promise.all(
        Array.from(canvas.querySelectorAll("img"))
          .filter((img) => !img.complete)
          .map((img) => img.decode().catch(() => undefined)),
      );

      const captured = await html2canvas(canvas, {
        scale: 2, useCORS: true, logging: false, backgroundColor: "#ffffff",
        onclone: (doc) => {
          const cloneFields = Array.from(
            doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(".rb-canvas input, .rb-canvas textarea"),
          ).filter((f) => !(f instanceof HTMLInputElement && (f.type === "checkbox" || f.type === "radio")));
          cloneFields.forEach((field, i) => {
            const live = liveFields[i];
            const isArea = field.tagName === "TEXTAREA";
            const div = doc.createElement("div");
            div.style.cssText = field.style.cssText;       // same box/padding/border/font
            div.style.boxSizing = "border-box";
            div.style.display = "flex";
            div.style.alignItems = isArea ? "flex-start" : "center";
            div.style.whiteSpace = isArea ? "pre-wrap" : "nowrap";
            div.style.overflow = "hidden";
            // Native form controls render their value/placeholder oddly under
            // html2canvas(-pro), so swap to a <div>. With the baseline fix in
            // html2canvas-pro, flex align-items:center now centres correctly.
            // Match the clone to its live counterpart by index to copy the exact
            // offsetHeight (the clone isn't laid out when onclone runs).
            if (live) div.style.height = `${live.offsetHeight}px`;
            const val = field.value;
            div.textContent = val || field.placeholder || "";
            if (!val && field.placeholder) div.style.color = "#aaa";
            field.parentNode?.replaceChild(div, field);
          });
        },
      });

      restore.forEach((fn) => fn());

      const imgData = captured.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pdfW = 210, pdfH = 297;
      const imgH = (captured.height * pdfW) / captured.width;
      let remaining = imgH, yPos = 0;
      pdf.addImage(imgData, "PNG", 0, yPos, pdfW, imgH);
      remaining -= pdfH;
      while (remaining > 0) { yPos -= pdfH; pdf.addPage(); pdf.addImage(imgData, "PNG", 0, yPos, pdfW, imgH); remaining -= pdfH; }
      pdf.save("PSAT_Report.pdf");
    } catch (err) { console.error("PDF export failed:", err); }
    finally { setExporting(null); }
  };

  // ── Capture a canvas element body as a base64 PNG ────────────────────────
  const captureElementImage = async (elementId: string): Promise<string | null> => {
    const el = canvasRef.current?.querySelector(`[data-element-id="${elementId}"] .rb-element-body`) as HTMLElement | null;
    if (!el) return null;
    await new Promise((r) => setTimeout(r, 800)); // let map tiles finish loading
    try {
      const captured = await html2canvas(el, {
        useCORS: true, allowTaint: false, scale: 1.5, logging: false, backgroundColor: "#ffffff",
        imageTimeout: 20000,
      });
      return captured.toDataURL("image/png").split(",")[1];
    } catch { return null; }
  };

  // ── Word export ───────────────────────────────────────────────────────────
  const handleDownloadWord = async () => {
    setExporting("word");
    const topN = elements.find((e) => e.id === "topRisk")?.topN ?? 10;
    const topRows = topRiskRows.slice(0, topN).map((row) => ({ ...row, _treatments: getSegmentTreatments(row) }));

    // Capture visual sections as images for Word embed
    const visibleIds = new Set(elements.filter((e) => e.visible).map((e) => e.id));
    const [mapImageB64] = await Promise.all([
      visibleIds.has("map") ? captureElementImage("map") : Promise.resolve(null),
    ]);

    try {
      const res = await fetch("/api/report/generate-docx", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedProjects: loadedProjects,
          elements: elements.filter((el) => el.visible),
          scoreData: distributions,
          totalSegments,
          topRiskRows: topRows,
          treatmentSummaries,
          treatmentNames: TREATMENT_NAMES,
          reportTitle,
          oicName,
          purpose,
          reportDate,
          imageDate,
          recommendations,
          scoreStats,
          attributeFrequency: Object.fromEntries(attributeFrequency),
          projectSegmentCounts,
          projectMeta,
          activeFilterNames,
          activeCategoryStatus,
          projectDisplayNames: projectNameOverrides,
          sectionTitles,
          mapImageB64,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "PSAT_Report.docx";
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) { console.error("Word export failed:", err); }
    finally { setExporting(null); }
  };

  // ── Shared renderers ──────────────────────────────────────────────────────
  const renderDonutLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    if (percent < 0.03) return null;
    return (
      <text x={x} y={y} fill="#111" textAnchor="middle" dominantBaseline="central" style={{ fontSize: "10px", fontWeight: 700 }}>
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  const renderBandDonut = (dist: BandDist, total: number) => {
    if (total === 0) return <div style={{ color: "#888", fontSize: 11, textAlign: "center", padding: "20px 0" }}>No data</div>;

    const chartData = [1, 2, 3, 4].map((band) => ({
      name: RISK_LABELS[band],
      value: dist[band] || 0,
      color: RISK_COLORS[band],
      band
    })).filter(d => d.value > 0);

    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
        <div style={{ fontSize: 10, color: "#666", marginBottom: 6 }}>Total: {total} segments</div>
        <div style={{ width: 140, height: 140 }}>
          <PieChart width={140} height={140}>
            <Pie
              data={chartData}
              cx={70}
              cy={70}
              labelLine={false}
              label={renderDonutLabel}
              innerRadius={30}
              outerRadius={65}
              dataKey="value"
              stroke="none"
              isAnimationActive={false}
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <RechartTooltip contentStyle={{ fontSize: 10, padding: "4px 8px", borderRadius: 4 }} itemStyle={{ fontSize: 10, color: "#222" }} />
          </PieChart>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "6px 12px", marginTop: 8 }}>
          {chartData.map((item) => (
            <div key={item.band} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: item.color }} />
              <div style={{ color: "#222", fontWeight: 700 }}>{item.name}: {item.value}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };


  const renderBandBadge = (band: number, short = false) => (
    <span style={{ display: "inline-block", padding: short ? "1px 4px" : "1px 6px", borderRadius: 3, fontSize: short ? 9 : 10, fontWeight: 600, background: RISK_COLORS[band] || "#eee", color: band === 2 ? "#333" : "#fff" }}>
      {short ? (RISK_LABELS[band]?.slice(0, 3).toUpperCase() ?? "—") : (RISK_LABELS[band] ?? "—")}
    </span>
  );

  const renderViewToggle = (el: ElementState) => {
    const topN = el.topN ?? 10;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px 8px", borderTop: "1px dashed #e0d8f0", background: "transparent" }} onPointerDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "#aaa", marginRight: 2, width: 30 }}>View:</span>
          {(["grid", "tabular", "full-page"] as ViewMode[]).map((mode) => {
            const active = (el.viewMode || "tabular") === mode;
            return (
              <button key={mode}
                style={{ padding: "2px 9px", borderRadius: 10, border: `1px solid ${active ? "#a020d0" : "#ddd"}`, background: active ? "#f0e4f8" : "#fff", color: active ? "#a020d0" : "#777", cursor: "pointer", fontSize: 10, fontWeight: active ? 700 : 400 }}
                onClick={(e) => { e.stopPropagation(); updateElement(el.id, { viewMode: mode }); setTimeout(autoFitElements, 50); }}
                onMouseDown={(e) => e.stopPropagation()}>
                {mode === "grid" ? "Grid" : mode === "tabular" ? "Tabular" : "Full Page"}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "#aaa", marginRight: 2, width: 30 }}>Top:</span>
          {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
            const active = topN === n;
            return (
              <button key={n}
                style={{ padding: "2px 5px", borderRadius: 10, border: `1px solid ${active ? "#a020d0" : "#ddd"}`, background: active ? "#f0e4f8" : "#fff", color: active ? "#a020d0" : "#777", cursor: "pointer", fontSize: 10, fontWeight: active ? 700 : 400, minWidth: 20 }}
                onClick={(e) => { e.stopPropagation(); updateElement(el.id, { topN: n }); setTimeout(autoFitElements, 50); }}
                onMouseDown={(e) => e.stopPropagation()}>{n}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // ── Top Risk renderers ────────────────────────────────────────────────────
  const renderTopRiskFullPage = (rows: TopRiskRow[], elId: string) => (
    <div style={{ flex: 1, overflow: "visible", display: "flex", flexDirection: "column" }}>
      {rows.map((row, i) => {
        const e = getEnriched(row);
        const t = getSegmentTreatments(row);
        const isFirst = i === 0;
        const isLast = i === rows.length - 1;

        // Each page must exactly equal PAGE_H (except possibly the last one)
        // so that the chunks break precisely on the PDF boundaries.
        const height = isLast ? "auto" : PAGE_H;

        return (
          <div key={i} style={{ height, boxSizing: "border-box", paddingBottom: isLast ? 0 : PAGE_GAP, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {isFirst ? (
              <div style={{ padding: "8px 12px 12px", flexShrink: 0 }}>
                <EditableText value={secTitle(elId, "Top Risk Stretches")} onChange={(val) => setSecTitle(elId, val)} style={{ fontSize: 20, fontWeight: 600, color: "#1a1a2e" }} />
                <div style={{ fontSize: 10, color: "#999" }}>Ranked highest to lowest · Before risk factors & after treatments applied</div>
              </div>
            ) : (
              <div style={{ padding: "10px 14px 12px", flexShrink: 0, fontSize: 20, fontWeight: 600, color: "#1a1a2e" }}>
                {secTitle(elId, "Top Risk Stretches")} <span style={{ color: "#aaa", fontWeight: 500 }}>(#{i + 1})</span>
              </div>
            )}

            <div style={{ flex: 1, background: "#fff", border: `2px solid ${RISK_COLORS[row._maxBand] || "#ddd"}`, borderRadius: 8, margin: "0 14px", display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
              {/* Image Section */}
              <div style={{ height: 360, position: "relative", flexShrink: 0 }}>
                <SegmentImage src={e.imageUrl} width="100%" height="100%" />
                {/* Ranking Badge */}
                <div style={{ position: "absolute", top: 16, left: 16, background: RISK_COLORS[row._maxBand] || "#333", color: "#fff", width: 48, height: 48, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: "bold", boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}>
                  {i + 1}
                </div>
              </div>

              {/* Content Section */}
              <div style={{ flex: 1, padding: "24px 32px", display: "flex", flexDirection: "column", gap: 20, overflow: "auto" }}>
                {/* Header: Project & Segment & Score */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid #eee", paddingBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: "#1a1a2e", marginBottom: 4 }}>{dispName(row._project)}</div>
                    <div style={{ fontSize: 16, color: "#666" }}>Segment {row._segIndex}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 36, fontWeight: 800, color: RISK_COLORS[row._maxBand] || "#222", lineHeight: 1 }}>{row._sumScore.toFixed(1)}</div>
                    <div style={{ fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginTop: 4 }}>Risk Score</div>
                  </div>
                </div>

                {/* Main Factors */}
                <div style={{ display: "flex", gap: 40 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#a020d0", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 12 }}>Top Contributing Attribute</div>
                    {e.topAttributes.length > 0 ? (
                      <div style={{ fontSize: 18, color: "#333", fontWeight: 500, display: "flex", alignItems: "center" }}>
                        <span style={{ marginRight: 8, color: "#cc2200" }}>⚠️</span>
                        {e.topAttributes[0].name}
                        <span style={{ marginLeft: 12, fontSize: 14, color: "#cc2200", fontWeight: 700, background: "#fdeded", padding: "2px 8px", borderRadius: 12 }}>+{e.topAttributes[0].multiplier.toFixed(1)}</span>
                      </div>
                    ) : (
                      <div style={{ fontSize: 16, color: "#bbb", fontStyle: "italic" }}>No contributing factors identified</div>
                    )}

                    {e.topAttributes.length > 1 && (
                      <div style={{ marginTop: 16 }}>
                        <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>Other significant factors:</div>
                        <ul style={{ margin: 0, paddingLeft: 18, color: "#555", fontSize: 13, lineHeight: 1.6 }}>
                          {e.topAttributes.slice(1).map((a, j) => (
                            <li key={j}>{a.name} <span style={{ color: "#cc2200", fontWeight: 600 }}>(+{a.multiplier.toFixed(1)})</span></li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Applied Treatments */}
                  <div style={{ width: 280, flexShrink: 0, background: "#f5fbf6", padding: 16, borderRadius: 8, border: "1px solid #c8e8d0" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#27ae60", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 }}>Applied Treatments</div>
                    {t.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: 16, color: "#226633", fontSize: 12, lineHeight: 1.5 }}>
                        {t.map(id => <li key={id}>{TREATMENT_NAMES[id] ?? `Treatment ${id}`}</li>)}
                      </ul>
                    ) : (
                      <div style={{ fontSize: 12, color: "#88ca99", fontStyle: "italic" }}>No treatments applied</div>
                    )}
                  </div>
                </div>

                <div style={{ flex: 1, minHeight: 20 }} /> {/* Spacer */}

                {/* Crash Type Scores */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, background: "#faf8fd", padding: 16, borderRadius: 8, border: "1px solid #ede8f5", flexShrink: 0 }}>
                  {(["VB", "BB", "SB", "BP"] as const).map((ct) => {
                    const band = row[`${ct} Band` as keyof TopRiskRow] as number;
                    const score = row[ct as keyof TopRiskRow] as number;
                    return (
                      <div key={ct} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#555" }}>{CRASH_TYPE_LABELS[ct] || ct}</div>
                        <div style={{ fontSize: 24, fontWeight: 700, color: RISK_COLORS[band] || "#333" }}>{score.toFixed(1)}</div>
                        <div style={{ padding: "4px 12px", borderRadius: 12, background: RISK_COLORS[band] || "#eee", color: band === 2 ? "#333" : "#fff", fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>
                          {RISK_LABELS[band] || "None"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderTopRiskGrid = (rows: TopRiskRow[]) => (
    <div style={{ flex: 1, overflow: "visible", padding: "8px 10px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, alignContent: "start" }}>
      {rows.map((row, i) => {
        const e = getEnriched(row); const t = getSegmentTreatments(row);
        return (
          <div key={i} style={{ border: `2px solid ${RISK_COLORS[row._maxBand] || "#ddd"}`, borderRadius: 6, background: "#fff", overflow: "hidden" }}>
            <SegmentImage src={e.imageUrl} width={999} height={85} />
            <div style={{ padding: "7px 9px" }}>
              <div style={{ fontSize: 9, color: "#bbb" }}>Rank #{i + 1}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#222", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dispName(row._project)}</div>
              <div style={{ fontSize: 10, color: "#777", marginBottom: 4 }}>Segment {row._segIndex}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                <span style={{ fontSize: 17, fontWeight: 700, color: "#222" }}>{row._sumScore.toFixed(1)}</span>
                {renderBandBadge(row._maxBand)}
              </div>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#888", letterSpacing: 0.3, marginBottom: 2 }}>CONTRIBUTING FACTORS</div>
              <div style={{ marginBottom: 5 }}>
                {e.topAttributes.length > 0 ? e.topAttributes.map((a, j) => <AttrTag key={j} {...a} />) : <span style={{ fontSize: 9, color: "#bbb" }}>—</span>}
              </div>
              <TreatmentBadge ids={t} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 4px", marginTop: 5 }}>
                {(["VB", "BB", "SB", "BP"] as const).map((ct) => (
                  <div key={ct} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <span style={{ fontSize: 8, color: "#888", width: 16 }}>{ct}</span>
                    {renderBandBadge(row[`${ct} Band` as keyof TopRiskRow] as number, true)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderTopRiskTabular = (rows: TopRiskRow[]) => (
    <div style={{ flex: 1, overflow: "visible" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
        <thead>
          <tr style={{ background: "#f5f0fa", position: "sticky", top: 0, zIndex: 1 }}>
            <th style={{ ...thStyle, width: 24 }}>#</th>
            <th style={{ ...thStyle, width: 60 }}>Image</th>
            <th style={{ ...thStyle, width: 110 }}>Project</th>
            <th style={{ ...thStyle, width: 32 }}>Seg</th>
            <th style={{ ...thStyle, width: 44 }}>Score</th>
            <th style={thStyle}>Top 5 Risk Factors (Before)</th>
            <th style={thStyle}>Applied Treatments (After)</th>
            <th style={{ ...thStyle, width: 36, textAlign: "center" }}>VB</th>
            <th style={{ ...thStyle, width: 36, textAlign: "center" }}>BB</th>
            <th style={{ ...thStyle, width: 36, textAlign: "center" }}>SB</th>
            <th style={{ ...thStyle, width: 36, textAlign: "center" }}>BP</th>
            <th style={{ ...thStyle, width: 44, textAlign: "center" }}>Overall</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const e = getEnriched(row); const t = getSegmentTreatments(row);
            return (
              <tr key={i} style={{ borderBottom: "1px solid #f0f0f0", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                <td style={{ ...tdStyle, fontWeight: 700, color: "#888" }}>{i + 1}</td>
                <td style={{ padding: "4px 6px" }}><SegmentImage src={e.imageUrl} width={55} height={38} /></td>
                <td style={{ ...tdStyle, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dispName(row._project)}</td>
                <td style={tdStyle}>{row._segIndex}</td>
                <td style={{ ...tdStyle, fontWeight: 700, fontSize: 12 }}>{row._sumScore.toFixed(1)}</td>
                <td style={{ ...tdStyle, maxWidth: 160 }}>
                  {e.topAttributes.length > 0 ? e.topAttributes.map((a, j) => <AttrTag key={j} {...a} />) : <span style={{ color: "#bbb" }}>—</span>}
                </td>
                <td style={{ ...tdStyle, maxWidth: 160 }}>
                  {t.length > 0
                    ? t.map((id) => <span key={id} style={{ fontSize: 9, color: "#226633", display: "block", lineHeight: 1.5 }}>✓ {id}. {TREATMENT_NAMES[id] ?? `Treatment ${id}`}</span>)
                    : <span style={{ color: "#ccc", fontSize: 9 }}>None</span>}
                </td>
                {(["VB", "BB", "SB", "BP"] as const).map((ct) => (
                  <td key={ct} style={{ ...tdStyle, textAlign: "center", padding: "3px 2px" }}>
                    {renderBandBadge(row[`${ct} Band` as keyof TopRiskRow] as number, true)}
                  </td>
                ))}
                <td style={{ ...tdStyle, textAlign: "center", padding: "3px 2px" }}>{renderBandBadge(row._maxBand, true)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  // ── Treatment Summary renderer ────────────────────────────────────────────
  const renderTreatmentSummary = (summaries: ProjectTreatmentSummary[]) => {
    return (
      <div style={{ padding: "6px 12px" }}>
        {summaries.map((summary) => {
          const total = projectSegmentCounts[summary.project] ?? 0;
          const sorted = Object.entries(summary.treatmentCounts).sort(([, a], [, b]) => b - a);
          return (
            <div key={summary.project} style={{ marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid #ede8f5" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e", flex: 1 }}>
                  <EditableText value={dispName(summary.project)} onChange={(v) => setProjectName(summary.project, v)} style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e" }} />
                </div>
                <div style={{ fontSize: 11, color: "#a020d0", fontWeight: 600, background: "#f0e4f8", padding: "2px 8px", borderRadius: 10 }}>
                  {summary.treatedSegments} / {total || "?"} segments treated
                </div>
              </div>
              {sorted.length === 0 ? <div style={{ fontSize: 11, color: "#aaa" }}>No treatments applied yet.</div> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {sorted.map(([idStr, count]) => {
                    const id = parseInt(idStr);
                    const name = TREATMENT_NAMES[id] ?? `Treatment ${id}`;
                    const pct = total > 0 ? ((count / total) * 100).toFixed(0) : null;
                    return (
                      <div key={id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 22, height: 22, borderRadius: 11, background: "#a020d0", color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{id}</span>
                        <div style={{ flex: 1, overflow: "hidden" }}>
                          <div style={{ fontSize: 11, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2 }}>{name}</div>
                          {total > 0 && <div style={{ height: 5, background: "#f0f0f0", borderRadius: 3, overflow: "hidden" }}><div style={{ width: `${pct}%`, background: "#a020d0", height: "100%", opacity: 0.7 }} /></div>}
                        </div>
                        <span style={{ fontSize: 11, color: "#a020d0", fontWeight: 600, flexShrink: 0, width: 60, textAlign: "right" }}>
                          {count} seg{count !== 1 ? "s" : ""}{pct ? ` (${pct}%)` : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // ── Section header helper ─────────────────────────────────────────────────
  const SectionHeader = ({ title, subtitle, onTitleChange }: { title: string; subtitle?: string; onTitleChange?: (t: string) => void }) => (
    <div style={{ padding: "8px 14px 6px", flexShrink: 0, borderBottom: "1px solid #ede8f5" }}>
      {onTitleChange
        ? <EditableText value={title} onChange={onTitleChange} style={{ fontSize: 20, fontWeight: 600, color: "#1a1a2e" }} />
        : <div style={{ fontSize: 20, fontWeight: 600, color: "#1a1a2e" }}>{title}</div>
      }
      {subtitle && <div style={{ fontSize: 10, color: "#999" }}>{subtitle}</div>}
    </div>
  );

  // ── Element content ───────────────────────────────────────────────────────
  const renderContent = (el: ElementState, orderIndex = 0) => {
    switch (el.type) {

      // ── Title ──────────────────────────────────────────────────────────────
      case "title":
        return (
          <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
            <EditableText value={reportTitle} onChange={setReportTitle} style={{ fontSize: 20, fontWeight: 700, color: "#1a1a2e" }} placeholder="Report Title" />
            <div style={{ fontSize: 12, color: "#555" }}>
              <strong>Projects:</strong>{" "}
              {loadedProjects.length > 0
                ? loadedProjects.map((name, i) => (
                  <span key={name}>
                    {i > 0 && ", "}
                    <EditableText
                      value={dispName(name)}
                      onChange={(v) => setProjectName(name, v)}
                      style={{ fontSize: 12, color: "#555" }}
                      placeholder={name}
                    />
                  </span>
                ))
                : "—"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 14px" }}>
              {[
                { label: "OIC In-charge", value: oicName, setter: setOicName, placeholder: "Enter name…", type: "text" },
                { label: "Purpose", value: purpose, setter: setPurpose, placeholder: "Enter purpose of report…", type: "text" },
              ].map(({ label, value, setter, placeholder, type }) => (
                <div key={label}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#a020d0", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
                  <input type={type} value={value} onChange={(e) => setter(e.target.value)} placeholder={placeholder}
                    onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
                    style={{ width: "100%", padding: "4px 8px", borderRadius: 4, border: "1px solid #ddd", fontSize: 12, color: "#222", background: "#fafafa", boxSizing: "border-box" }} />
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 14px" }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#a020d0", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.4 }}>Report Date</div>
                <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)}
                  onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
                  style={{ width: "100%", padding: "4px 8px", borderRadius: 4, border: "1px solid #ddd", fontSize: 11, color: "#222", background: "#fafafa", boxSizing: "border-box" }} />
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#a020d0", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.4 }}>
                  Image Date
                  <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 400, color: "#27ae60", textTransform: "none", letterSpacing: 0 }}>auto</span>
                </div>
                <input type="date" value={imageDate} onChange={(e) => setImageDate(e.target.value)}
                  onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
                  style={{ width: "100%", padding: "4px 8px", borderRadius: 4, border: "1px solid #c8e8d0", fontSize: 11, color: "#222", background: "#f5fbf6", boxSizing: "border-box" }} />
              </div>
            </div>
          </div>
        );

      // ── Risk Bands ─────────────────────────────────────────────────────────
      case "riskBands":
        return (
          <div style={{ padding: "10px 14px" }}>
            <EditableText value={secTitle(el.id, "Risk Band Distribution")} onChange={(t) => setSecTitle(el.id, t)} style={{ fontSize: 20, fontWeight: 600, color: "#1a1a2e", display: "block", marginBottom: 10 }} />
            {!distributions ? <div style={{ color: "#888", fontSize: 12 }}>Loading…</div> : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 20px" }}>
                {(["Overall", "VB", "BB", "SB", "BP"] as const).map((type) => {
                  const dist = distributions[type];
                  const total = Object.values(dist).reduce((s, v) => s + v, 0);
                  return (
                    <div key={type}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#222", textAlign: "center", marginBottom: 2 }}>{CRASH_TYPE_LABELS[type]}</div>
                      {renderBandDonut(dist, total)}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );

      // ── Map ────────────────────────────────────────────────────────────────
      case "map":
        return (
          <div style={{ height: "calc(100% - 30px)", display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 4, margin: 2 }}>
            {loadedProjects.length === 0
              ? <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, background: "#f7f7f7", border: "2px dashed #ccc", borderRadius: 4 }}><span style={{ fontSize: 12, color: "#aaa" }}>No projects loaded</span></div>
              : <div style={{ flex: 1, overflow: "hidden" }}><ReportMiniMap projects={loadedProjects} bandMap={allBandMap} orderIndex={orderIndex} /></div>}
            {loadedProjects.length > 0 && (
              <div style={{ display: "flex", gap: 18, padding: "4px 10px", background: "#faf8fd", borderTop: "1px solid #ede8f5", flexShrink: 0, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#555" }}>
                  <strong style={{ color: "#a020d0" }}>{totalSegments}</strong> segments
                </span>
                {totalKm > 0 && (
                  <span style={{ fontSize: 11, color: "#555" }}>
                    <strong style={{ color: "#a020d0" }}>{totalKm.toFixed(1)} km</strong> total length
                  </span>
                )}
                <span style={{ fontSize: 11, color: "#555" }}>
                  {loadedProjects.length} project{loadedProjects.length !== 1 ? "s" : ""}
                </span>
              </div>
            )}
          </div>
        );

      // ── Summary ────────────────────────────────────────────────────────────
      case "summary":
        return (
          <div style={{ padding: "12px 18px" }}>
            <EditableText value={secTitle(el.id, "Summary")} onChange={(t) => setSecTitle(el.id, t)} style={{ fontSize: 20, fontWeight: 600, color: "#1a1a2e", display: "block", marginBottom: 10 }} />
            <div style={{ display: "flex", gap: 32, marginBottom: activeFilterNames.length > 0 ? 10 : 0 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#a020d0" }}>{loadedProjects.length}</div>
                <div style={{ fontSize: 11, color: "#666" }}>Projects</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#a020d0" }}>{totalSegments}</div>
                <div style={{ fontSize: 11, color: "#666" }}>Total Segments</div>
              </div>
              {totalKm > 0 && (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "#a020d0" }}>{totalKm.toFixed(1)}</div>
                  <div style={{ fontSize: 11, color: "#666" }}>km Total Length</div>
                </div>
              )}
            </div>
            {activeFilterNames.length > 0 && (
              <div style={{ padding: "8px 10px", background: "#f5f0fa", borderRadius: 6, border: "1px solid #e8d8f8" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#a020d0", textTransform: "uppercase", letterSpacing: 0.4, display: "block", marginBottom: 6 }}>Active Filters:</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {activeFilterNames.map((filterName) => {
                    const status = activeCategoryStatus.find((s) => s.attribute === filterName);
                    const hasRange = !!status?.rangeFilter;
                    const inactiveCount = status?.categories.filter((c) => !c.isActive).length ?? 0;
                    return (
                      <div key={filterName} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: "#5a2a8a", minWidth: 130, flexShrink: 0, paddingTop: 2 }}>{filterName}</span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 5px", flex: 1 }}>
                          {hasRange && status?.rangeFilter ? (
                            <span style={{ fontSize: 10, color: "#555", background: "#ede8f8", borderRadius: 8, padding: "1px 7px" }}>
                              {status.rangeFilter.currentMin} – {status.rangeFilter.currentMax}
                              {(status.rangeFilter.currentMin !== status.rangeFilter.min || status.rangeFilter.currentMax !== status.rangeFilter.max) && (
                                <span style={{ color: "#a020d0", marginLeft: 4 }}>✱ filtered</span>
                              )}
                            </span>
                          ) : status?.categories ? (
                            status.categories.map((cat) => (
                              // inline-block + vertical-align middle + lineHeight:1 (not
                              // inline-flex) so html2canvas centres the dot & label in the
                              // PDF — it ignores flex align-items and drops text to the
                              // bottom of the line box. Browser-identical to the old flex pill.
                              <span key={cat.category} style={{ display: "inline-block", whiteSpace: "nowrap", lineHeight: 1, fontSize: 9, padding: "2px 6px", borderRadius: 8, background: cat.isActive ? cat.color + "22" : "#f0f0f0", border: `1px solid ${cat.isActive ? cat.color : "#ddd"}`, color: cat.isActive ? "#333" : "#bbb" }}>
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: cat.isActive ? cat.color : "#ccc", display: "inline-block", verticalAlign: "middle", marginRight: 3 }} />
                                <span style={{ verticalAlign: "middle" }}>{cat.category}</span>
                              </span>
                            ))
                          ) : (
                            <span style={{ fontSize: 10, color: "#888", fontStyle: "italic" }}>all categories shown</span>
                          )}
                          {inactiveCount > 0 && (
                            <span style={{ fontSize: 9, color: "#e08800", background: "#fff8e0", borderRadius: 8, padding: "1px 6px", border: "1px solid #f0d080" }}>
                              {inactiveCount} hidden
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );

      // ── Benchmarking Statistics ────────────────────────────────────────────
      case "benchmarkStats": {
        const crashRows = [
          { key: "VB" as const, label: "Vehicle–Bicycle", short: "VB" },
          { key: "BB" as const, label: "Bicycle–Bicycle", short: "BB" },
          { key: "SB" as const, label: "Single-Bicycle", short: "SB" },
          { key: "BP" as const, label: "Bicycle–Pedestrian", short: "BP" },
          { key: "Overall" as const, label: "Overall Risk", short: "ALL" },
        ];

        // Count segments that are Low or Medium overall
        const safePct = (distributions && totalSegments > 0)
          ? (((distributions.Overall[1] || 0) + (distributions.Overall[2] || 0)) / totalSegments * 100).toFixed(1)
          : null;

        return (
          <div style={{ padding: "10px 14px" }}>
            <EditableText
              value={secTitle(el.id, "Benchmarking Statistics")}
              onChange={(t) => setSecTitle(el.id, t)}
              style={{ fontSize: 20, fontWeight: 600, color: "#1a1a2e", display: "block", marginBottom: 4 }}
            />
            <div style={{ fontSize: 10, color: "#888", marginBottom: 10 }}>
              Risk band distribution &amp; score averages across all crash types · {totalSegments} segments total
              {safePct !== null && (
                <span style={{ marginLeft: 12, color: "#27ae60", fontWeight: 600 }}>
                  ✓ {safePct}% Low or Medium overall
                </span>
              )}
            </div>

            {!distributions ? (
              isLoadingScores ? (
                <div style={{ color: "#888", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  <Loader2 size={14} className="rb-spinner" /> Loading score data...
                </div>
              ) : (
                <div style={{ color: "#888", fontSize: 12 }}>No score data — run scoring first.</div>
              )
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                <thead>
                  <tr style={{ background: "#f5f0fa" }}>
                    <th style={{ ...thStyle, width: 140 }}>Crash Type</th>
                    {[1, 2, 3, 4].map((band) => (
                      <th key={band} style={{ ...thStyle, textAlign: "center", color: RISK_COLORS[band] }}>
                        {RISK_LABELS[band]}
                      </th>
                    ))}
                    <th style={{ ...thStyle, textAlign: "center" }}>Avg Score</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>Distribution</th>
                  </tr>
                </thead>
                <tbody>
                  {crashRows.map(({ key, label }, ri) => {
                    const dist = distributions[key];
                    const total = Object.values(dist).reduce((a, b) => a + b, 0) || 1;
                    const isOverall = key === "Overall";
                    const avg = scoreStats?.[key as keyof ScoreStats]?.avg ?? "—";
                    return (
                      <tr
                        key={key}
                        style={{
                          borderBottom: "1px solid #f0eaf8",
                          background: isOverall ? "#f0e8fc" : ri % 2 === 0 ? "#fff" : "#fafafa",
                          fontWeight: isOverall ? 700 : 400,
                        }}
                      >
                        <td style={{ ...tdStyle, fontWeight: isOverall ? 700 : 600, color: "#1a1a2e" }}>
                          {label}
                        </td>
                        {[1, 2, 3, 4].map((band) => {
                          const count = dist[band] || 0;
                          const pct = (count / total * 100);
                          return (
                            <td key={band} style={{ ...tdStyle, textAlign: "center", padding: "4px 4px" }}>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                <span style={{ color: RISK_COLORS[band], fontWeight: isOverall ? 800 : 600, fontSize: isOverall ? 11 : 10 }}>
                                  {pct.toFixed(1)}%
                                </span>
                                <span style={{ color: "#bbb", fontSize: 8 }}>({count})</span>
                              </div>
                            </td>
                          );
                        })}
                        <td style={{ ...tdStyle, textAlign: "center", fontWeight: isOverall ? 700 : 500, color: isOverall ? "#a020d0" : "#333" }}>
                          {avg}
                        </td>
                        {/* Mini stacked bar */}
                        <td style={{ ...tdStyle, padding: "4px 8px", width: 100 }}>
                          <div style={{ display: "flex", height: 10, borderRadius: 4, overflow: "hidden", gap: 1 }}>
                            {[1, 2, 3, 4].map((band) => {
                              const pct = (dist[band] || 0) / total * 100;
                              return pct > 0 ? (
                                <div
                                  key={band}
                                  title={`${RISK_LABELS[band]}: ${pct.toFixed(1)}%`}
                                  style={{ width: `${pct}%`, background: RISK_COLORS[band], minWidth: pct > 0 ? 2 : 0 }}
                                />
                              ) : null;
                            })}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      }

      // ── Top Risk Stretches ─────────────────────────────────────────────────
      case "topRisk": {
        const viewMode = el.viewMode || "tabular";
        const displayRows = topRiskRows.slice(0, el.topN ?? 10);

        if (viewMode === "full-page") {
          return (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {displayRows.length === 0 ? (
                <>
                  <div style={{ padding: "8px 12px 2px", flexShrink: 0 }}>
                    <EditableText value={secTitle(el.id, "Top Risk Stretches")} onChange={(t) => setSecTitle(el.id, t)} style={{ fontSize: 20, fontWeight: 600, color: "#1a1a2e" }} />
                    <div style={{ fontSize: 10, color: "#999" }}>Ranked highest to lowest · Before risk factors & after treatments applied</div>
                  </div>
                  {isLoadingScores ? (
                    <div style={{ padding: 14, color: "#888", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                      <Loader2 size={14} className="rb-spinner" /> Loading score data...
                    </div>
                  ) : (
                    <div style={{ padding: 14, color: "#888", fontSize: 12 }}>No score data. Run scoring first.</div>
                  )}
                </>
              ) : (
                renderTopRiskFullPage(displayRows, el.id)
              )}
            </div>
          );
        }

        return (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "8px 12px 2px", flexShrink: 0 }}>
              <EditableText value={secTitle(el.id, "Top Risk Stretches")} onChange={(t) => setSecTitle(el.id, t)} style={{ fontSize: 20, fontWeight: 600, color: "#1a1a2e" }} />
              <div style={{ fontSize: 10, color: "#999" }}>Ranked highest to lowest · Before risk factors & after treatments applied</div>
            </div>
            {displayRows.length === 0
              ? isLoadingScores ? (
                  <div style={{ padding: 14, color: "#888", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                    <Loader2 size={14} className="rb-spinner" /> Loading score data...
                  </div>
                ) : (
                  <div style={{ padding: 14, color: "#888", fontSize: 12 }}>No score data. Run scoring first.</div>
                )
              : viewMode === "grid" ? renderTopRiskGrid(displayRows)
                : renderTopRiskTabular(displayRows)}
          </div>
        );
      }

      // ── Treatment Summary ──────────────────────────────────────────────────
      case "treatmentSummary": {
        if (loadedProjects.length === 0) {
          return (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <SectionHeader title={secTitle(el.id, "Treatment Summary")} onTitleChange={(t) => setSecTitle(el.id, t)} subtitle="" />
              <div style={{ flex: 1, overflow: "hidden" }}>
                <div style={{ padding: "12px 14px", color: "#888", fontSize: 12 }}>No project data loaded.</div>
              </div>
            </div>
          );
        }
        if (treatmentSummaries.length === 0) {
          return (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <SectionHeader title={secTitle(el.id, "Treatment Summary")} onTitleChange={(t) => setSecTitle(el.id, t)} subtitle={`Data from: ${loadedProjects.map(dispName).join(", ")}`} />
              <div style={{ flex: 1, overflow: "hidden" }}>
                <div style={{ padding: "12px 14px", color: "#888", fontSize: 12 }}>Loading treatment data…</div>
              </div>
            </div>
          );
        }

        const chunks: ProjectTreatmentSummary[][] = [];
        let currentChunk: ProjectTreatmentSummary[] = [];
        let currentHeight = 0;
        const MAX_H = 920; // safe max height for content below header

        for (const summary of treatmentSummaries) {
          const sorted = Object.keys(summary.treatmentCounts);
          const estHeight = 80 + (sorted.length === 0 ? 30 : sorted.length * 36);

          if (currentHeight + estHeight > MAX_H && currentChunk.length > 0) {
            chunks.push(currentChunk);
            currentChunk = [summary];
            currentHeight = estHeight;
          } else {
            currentChunk.push(summary);
            currentHeight += estHeight;
          }
        }
        if (currentChunk.length > 0) chunks.push(currentChunk);

        return (
          <div style={{ flex: 1, overflow: "visible", display: "flex", flexDirection: "column" }}>
            {chunks.map((chunk, i) => {
              const isLast = i === chunks.length - 1;
              const height = isLast ? "auto" : PAGE_H;
              const projectsInChunk = chunk.map(c => c.project);
              const subtitle = `Data from: ${projectsInChunk.map(dispName).join(", ")}`;

              return (
                <div key={i} style={{ height, boxSizing: "border-box", paddingBottom: isLast ? 0 : PAGE_GAP, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  <SectionHeader title={secTitle(el.id, "Treatment Summary") + (i > 0 ? " (Cont.)" : "")} onTitleChange={i === 0 ? (t) => setSecTitle(el.id, t) : undefined} subtitle={subtitle} />
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    {renderTreatmentSummary(chunk)}
                  </div>
                </div>
              );
            })}
          </div>
        );
      }

      // ── Project Details ────────────────────────────────────────────────────
      case "projectDetails": {
        const fmtDate = (iso?: string) => {
          if (!iso) return "—";
          try { return new Date(iso).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" }); }
          catch { return iso; }
        };
        const detailRow = (label: string, value: string) => (
          <div key={label} style={{ display: "flex", gap: 8, fontSize: 11, color: "#333", lineHeight: 1.9, borderBottom: "1px solid #f5f0fa" }}>
            <span style={{ width: 90, flexShrink: 0, color: "#888", fontWeight: 500 }}>{label}</span>
            <span style={{ fontWeight: 600, color: "#1a1a2e" }}>{value}</span>
          </div>
        );
        const renderProject = (name: string, isLastInChunk: boolean) => {
          const meta = projectMeta[name] ?? {};
          const count = projectSegmentCounts[name] ?? 0;
          const lenKm = (count * 10 / 1000).toFixed(1);
          const projRows = allScoreRows.filter((r) => r._project === name);
          const projDist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
          projRows.forEach((r) => { const b = r._maxBand; if (b >= 1 && b <= 4) projDist[b]++; });
          const projTotal = projRows.length || 1;
          return (
            <div key={name} style={{ marginBottom: isLastInChunk ? 0 : 16, paddingBottom: isLastInChunk ? 0 : 14, borderBottom: isLastInChunk ? "none" : "1px solid #ede8f5" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <EditableText value={dispName(name)} onChange={(v) => setProjectName(name, v)} style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e", flex: 1 }} />
                {projRows.length > 0 && renderBandBadge(Math.round(Object.entries(projDist).sort(([, a], [, b]) => b - a)[0][0] as unknown as number))}
              </div>
              <div style={{ marginBottom: 6 }}>
                {detailRow("Segments", `${count}`)}
                {detailRow("Length", `${lenKm} km`)}
                {detailRow("Survey", fmtDate(meta.dateCreated))}
                {detailRow("Analysis", fmtDate(meta.lastUpdated))}
              </div>
              {projRows.length > 0 && (
                <div>
                  <div style={{ fontSize: 9, color: "#aaa", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.4 }}>Overall Risk Distribution</div>
                  <div style={{ display: "flex", height: 10, borderRadius: 4, overflow: "hidden", gap: 1 }}>
                    {[1, 2, 3, 4].map((b) => {
                      const pct = projDist[b] / projTotal * 100;
                      return pct > 0 ? <div key={b} title={`${RISK_LABELS[b]}: ${pct.toFixed(1)}%`} style={{ width: `${pct}%`, background: RISK_COLORS[b], minWidth: 2 }} /> : null;
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 3 }}>
                    {[1, 2, 3, 4].map((b) => projDist[b] > 0 ? (
                      <span key={b} style={{ fontSize: 9, color: RISK_COLORS[b], fontWeight: 600 }}>
                        {RISK_LABELS[b]} {(projDist[b] / projTotal * 100).toFixed(1)}%
                      </span>
                    ) : null)}
                  </div>
                </div>
              )}
            </div>
          );
        };
        const numChunks = Math.max(1, Math.ceil(loadedProjects.length / PROJ_PAGE_SIZE));
        return (
          // Each chunk (except the last) is exactly PAGE_H tall so its boundary
          // lands on the PDF page-break grid — a real page break between every
          // PROJ_PAGE_SIZE projects, not a click-to-paginate widget.
          <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {loadedProjects.length === 0 ? (
              <>
                <SectionHeader title={secTitle(el.id, "Project Details")} onTitleChange={(t) => setSecTitle(el.id, t)} subtitle="0 projects" />
                <div style={{ padding: "8px 14px", color: "#888", fontSize: 12 }}>No projects loaded.</div>
              </>
            ) : (
              Array.from({ length: numChunks }).map((_, ci) => {
                const chunkProjects = loadedProjects.slice(ci * PROJ_PAGE_SIZE, (ci + 1) * PROJ_PAGE_SIZE);
                const isLastChunk = ci === numChunks - 1;
                return (
                  <div key={ci} style={{ height: isLastChunk ? "auto" : PAGE_H, paddingBottom: isLastChunk ? 0 : PAGE_GAP, boxSizing: "border-box", flexShrink: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                    {ci === 0 ? (
                      <SectionHeader title={secTitle(el.id, "Project Details")} onTitleChange={(t) => setSecTitle(el.id, t)} subtitle={`${loadedProjects.length} project${loadedProjects.length !== 1 ? "s" : ""} · ${totalSegments} segments · ${totalKm.toFixed(1)} km total`} />
                    ) : (
                      <div style={{ padding: "10px 14px 0", fontSize: 20, fontWeight: 600, color: "#1a1a2e" }}>
                        {secTitle(el.id, "Project Details")} <span style={{ color: "#aaa", fontWeight: 500 }}>(continued)</span>
                      </div>
                    )}
                    <div style={{ flex: 1, overflow: "hidden", padding: "8px 14px" }}>
                      {chunkProjects.map((name, pi) => renderProject(name, pi === chunkProjects.length - 1))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        );
      }

      // ── Risk Statistics ────────────────────────────────────────────────────
      case "riskStats": {
        // Scale reference: VB max ≈100, BB/BP/SB max ≈40
        const SCALE_MAX: Record<string, number> = { Overall: 200, VB: 100, BB: 40, SB: 40, BP: 40 };
        return (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <SectionHeader title={secTitle(el.id, "Risk Score Statistics")} onTitleChange={(t) => setSecTitle(el.id, t)} subtitle="Score range and average across all segments per crash type" />
            <div style={{ flex: 1, overflow: "visible", padding: "8px 14px" }}>
              {!scoreStats
                ? isLoadingScores ? (
                    <div style={{ color: "#888", fontSize: 12, padding: 8, display: "flex", alignItems: "center", gap: 6 }}>
                      <Loader2 size={14} className="rb-spinner" /> Loading score data...
                    </div>
                  ) : (
                    <div style={{ color: "#888", fontSize: 12, padding: 8 }}>No score data available.</div>
                  )
                : (["Overall", "VB", "BB", "SB", "BP"] as const).map((ct, i) => {
                  const { min, max, avg } = scoreStats[ct];
                  const scale = SCALE_MAX[ct] || 100;
                  const minN = parseFloat(min) || 0;
                  const maxN = parseFloat(max) || 0;
                  const avgN = parseFloat(avg) || 0;
                  const minPct = Math.min(100, minN / scale * 100);
                  const maxPct = Math.min(100, maxN / scale * 100);
                  const avgPct = Math.min(100, avgN / scale * 100);
                  const isOverall = ct === "Overall";
                  return (
                    <div key={ct} style={{ marginBottom: i < 4 ? 10 : 0, paddingBottom: i < 4 ? 10 : 0, borderBottom: i < 4 ? "1px solid #f5f0fa" : "none" }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: isOverall ? 700 : 600, color: isOverall ? "#a020d0" : "#333", width: 130, flexShrink: 0 }}>{CRASH_TYPE_LABELS[ct]}</span>
                        <span style={{ fontSize: 10, color: "#87C424", fontWeight: 700 }}>min {min}</span>
                        <span style={{ fontSize: 10, color: "#aaa" }}>·</span>
                        <span style={{ fontSize: 10, color: "#555", fontWeight: 600 }}>avg {avg}</span>
                        <span style={{ fontSize: 10, color: "#aaa" }}>·</span>
                        <span style={{ fontSize: 10, color: "#CD1AFF", fontWeight: 700 }}>max {max}</span>
                      </div>
                      <div style={{ position: "relative", height: 12, background: "#f0eaf8", borderRadius: 6, overflow: "hidden" }}>
                        {/* range band */}
                        <div style={{ position: "absolute", left: `${minPct}%`, width: `${Math.max(0, maxPct - minPct)}%`, background: isOverall ? "#a020d0" : "#c080e8", height: "100%", opacity: 0.35 }} />
                        {/* avg marker */}
                        <div style={{ position: "absolute", left: `${avgPct}%`, width: 2, height: "100%", background: isOverall ? "#a020d0" : "#8040c0", transform: "translateX(-1px)" }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 1 }}>
                        <span style={{ fontSize: 8, color: "#ccc" }}>0</span>
                        <span style={{ fontSize: 8, color: "#ccc" }}>{scale}</span>
                      </div>
                    </div>
                  );
                })
              }
            </div>
          </div>
        );
      }

      // ── Top Contributing Attributes ────────────────────────────────────────
      case "topAttributes": {
        const ATTR_COLORS = ["#a020d0", "#4472C4", "#C0504D", "#9BBB59", "#4BACC6", "#F79646", "#7030A0", "#2C4770", "#E46C0A", "#A9D18E"];
        return (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <SectionHeader title={secTitle(el.id, "Top Risk Factors")} onTitleChange={(t) => setSecTitle(el.id, t)} subtitle={`Most frequently occurring risk contributors · ${totalSegments} segments total`} />
            <div style={{ flex: 1, overflow: "hidden", padding: "8px 14px" }}>
              {attributeFrequency.length === 0
                ? <div style={{ color: "#888", fontSize: 12 }}>No attribute data. Run scoring first.</div>
                : (() => {
                  const maxCount = attributeFrequency[0]?.[1] ?? 1;
                  return attributeFrequency.map(([name, count], i) => {
                    const pct = totalSegments > 0 ? (count / totalSegments * 100) : 0;
                    const barPct = count / maxCount * 100;
                    const color = ATTR_COLORS[i % ATTR_COLORS.length];
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <div style={{ width: 20, fontSize: 10, fontWeight: 700, color: "#bbb", textAlign: "right", flexShrink: 0 }}>#{i + 1}</div>
                        <div style={{ flex: 1, overflow: "hidden" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                            <span style={{ fontSize: 11, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "72%" }}>{name}</span>
                            <span style={{ fontSize: 10, color: "#888", flexShrink: 0, marginLeft: 4 }}>{count} segs · {pct.toFixed(1)}%</span>
                          </div>
                          <div style={{ height: 9, background: "#f0f0f0", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ width: `${barPct}%`, background: color, height: "100%", opacity: 0.8 }} />
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
            </div>
          </div>
        );
      }

      // ── Recommendations ────────────────────────────────────────────────────
      case "recommendations": {
        // Auto-generate priority actions from top risk factors
        const autoSuggestions: string[] = [];
        attributeFrequency.slice(0, 5).forEach(([name, count]) => {
          const pct = totalSegments > 0 ? (count / totalSegments * 100).toFixed(0) : "?";
          autoSuggestions.push(`Address "${name}" — affects ${count} segments (${pct}% of network)`);
        });
        if (topRiskRows.length > 0) {
          const extremeCount = topRiskRows.filter((r) => r._maxBand === 4).length;
          if (extremeCount > 0) autoSuggestions.push(`Priority intervention on ${extremeCount} Extreme-rated segment${extremeCount > 1 ? "s" : ""} — immediate action required`);
        }
        return (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <SectionHeader title={secTitle(el.id, "Recommendations")} onTitleChange={(t) => setSecTitle(el.id, t)} subtitle="Data-driven priority actions · editable notes below" />
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", padding: "6px 14px", gap: 6 }}>
              {autoSuggestions.length > 0 && (
                <div style={{ background: "#f5f0fa", borderRadius: 6, border: "1px solid #e0d0f0", padding: "8px 10px", flexShrink: 0 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "#a020d0", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>Suggested Priority Actions</div>
                  {autoSuggestions.map((s, i) => (
                    <div key={i} style={{ display: "flex", gap: 6, fontSize: 11, color: "#333", lineHeight: 1.6 }}>
                      <span style={{ color: "#a020d0", fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
                      <span>{s}</span>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                value={recommendations}
                onChange={(e) => setRecommendations(e.target.value)}
                placeholder="Add custom recommendations, observations, or next steps here…"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                style={{ flex: 1, resize: "none", border: "1px solid #e0d0f0", borderRadius: 4, padding: "8px 10px", fontSize: 11, color: "#222", fontFamily: "inherit", background: "#fafcff", boxSizing: "border-box", outline: "none", lineHeight: 1.6, minHeight: 60 }}
              />
            </div>
          </div>
        );
      }

      // ── Methodology ────────────────────────────────────────────────────────
      case "methodology":
        return (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <SectionHeader title={secTitle(el.id, "Methodology")} onTitleChange={(t) => setSecTitle(el.id, t)} subtitle="CycleRAP v2 — Cycling Road Assessment Programme" />
            <div style={{ flex: 1, overflow: "hidden", padding: "10px 14px" }}>
              <p style={{ fontSize: 11, color: "#444", lineHeight: 1.75, margin: "0 0 10px" }}>{METHODOLOGY_TEXT}</p>
              {/* Risk band thresholds table */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#a020d0", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>Risk Band Thresholds</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                  <thead>
                    <tr style={{ background: "#f5f0fa" }}>
                      <th style={{ ...thStyle }}>Crash Type</th>
                      {[1, 2, 3, 4].map((b) => (
                        <th key={b} style={{ ...thStyle, textAlign: "center", color: RISK_COLORS[b] }}>{RISK_LABELS[b]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: "Vehicle–Bicycle (VB)", ranges: ["< 10", "10 – 25", "25 – 60", "> 60"] },
                      { label: "Bicycle–Bicycle (BB)", ranges: ["< 5", "5 – 10", "10 – 20", "> 20"] },
                      { label: "Single-Bicycle (SB)", ranges: ["< 5", "5 – 10", "10 – 20", "> 20"] },
                      { label: "Bicycle–Pedestrian (BP)", ranges: ["< 5", "5 – 10", "10 – 20", "> 20"] },
                    ].map(({ label, ranges }, i) => (
                      <tr key={label} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa", borderBottom: "1px solid #f0eaf8" }}>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{label}</td>
                        {ranges.map((r, j) => (
                          <td key={j} style={{ ...tdStyle, textAlign: "center", color: RISK_COLORS[j + 1], fontWeight: 600 }}>{r}</td>
                        ))}
                      </tr>
                    ))}
                    <tr style={{ background: "#f0e8fc", borderBottom: "1px solid #d8c4f0", fontWeight: 700 }}>
                      <td style={{ ...tdStyle, fontWeight: 700, color: "#a020d0" }}>Overall Risk</td>
                      <td colSpan={4} style={{ ...tdStyle, textAlign: "center", color: "#555", fontStyle: "italic" }}>Maximum band across all four crash types</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {/* Segment length note */}
              <div style={{ fontSize: 10, color: "#888", background: "#fafafa", borderRadius: 4, padding: "5px 8px", border: "1px solid #eee" }}>
                <strong>Segment length:</strong> Each segment represents 10 m of cycling facility (CycleRAP standard). Total network: {totalSegments} segments = {totalKm.toFixed(1)} km.
              </div>
            </div>
          </div>
        );

      // ── Segment Image Gallery ──────────────────────────────────────────────
      case "segmentGallery":
        return (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <SectionHeader title={secTitle(el.id, "Segment Image Gallery")} onTitleChange={(t) => setSecTitle(el.id, t)} subtitle="Images for top-risk segments, ordered by rank" />
            <div style={{ flex: 1, overflow: "hidden", padding: "8px 10px" }}>
              {topRiskRows.length === 0
                ? <div style={{ color: "#888", fontSize: 12 }}>No segments loaded.</div>
                : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {topRiskRows.map((row, i) => {
                      const e = getEnriched(row);
                      return (
                        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                          <div style={{ position: "relative" }}>
                            <SegmentImage src={e.imageUrl} width={90} height={65} />
                            <div style={{ position: "absolute", top: 2, left: 2, background: "rgba(0,0,0,0.55)", borderRadius: 3, padding: "1px 5px", fontSize: 9, color: "#fff", fontWeight: 700 }}>#{i + 1}</div>
                            {renderBandBadge(row._maxBand, true) && (
                              <div style={{ position: "absolute", bottom: 2, right: 2 }}>{renderBandBadge(row._maxBand, true)}</div>
                            )}
                          </div>
                          <div style={{ fontSize: 8, color: "#666", textAlign: "center", maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {dispName(row._project)} · S{row._segIndex}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
            </div>
          </div>
        );

      default: return null;
    }
  };

  // ── Flow layout (single source of truth for heights + page-break spacing) ──
  const visibleElements = useMemo(() => elements.filter((e) => e.visible), [elements]);
  const layout = useMemo(
    () => computeFlowLayout(visibleElements, computeIdealHeight),
    [visibleElements, computeIdealHeight],
  );

  // ── Dynamic canvas size ───────────────────────────────────────────────────
  const canvasH = useMemo(() => {
    if (visibleElements.length === 0) return 3400;
    return Math.max(1200, layout.bottom + 80);
  }, [visibleElements, layout]);



  // Gap-constrained page separators: each band is clipped to the actual whitespace
  // We no longer manually calculate page breaks.
  // Instead, visual page backdrops with spaces between them are rendered.
  const totalPages = useMemo(() => Math.max(1, Math.ceil(canvasH / PAGE_H)), [canvasH]);

  // ── Checklist memo ────────────────────────────────────────────────────────
  const sectionChecklist = useMemo(() =>
    elements.map((el) => ({ id: el.id, label: el.label, visible: el.visible })),
    [elements]
  );

  // ── Page ──────────────────────────────────────────────────────────────────
  return (
    <div className="rb-page">
      <div className="rb-toolbar">
        <button className="rb-btn rb-btn-secondary" onClick={() => navigate(-1)}>← Back</button>
        <button className="rb-btn rb-btn-secondary" onClick={() => navigate("/analysis/path")} title="Go to Path Analysis to download table or image exports">↗ Path Analysis</button>

        <button className="rb-btn rb-btn-secondary" onClick={autoFitElements} title="Auto-resize all sections to fit their content and remove gaps">
          ⇅ Auto-fit
        </button>

        <button className="rb-btn rb-btn-secondary" onClick={saveLayout} title="Save your report layout, section arrangement, and text to this browser. The layout will be automatically restored the next time you open the Report Builder.">
          💾 Save layout
        </button>
        <button className="rb-btn rb-btn-secondary" onClick={resetLayout} title="Reset all sections and text to their default values">
          🔄 Reset layout
        </button>
        {hasSaved && (
          <button className="rb-btn rb-btn-secondary" onClick={restoreLayout} title="Revert to the last manually saved layout (does not affect live project data)">
            ↩ Restore saved
          </button>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 4 }}>
          <button className="rb-btn rb-btn-secondary" onClick={() => goToPage(Math.max(0, currentPage - 1))} disabled={currentPage === 0} style={{ padding: "6px 10px" }}>◀</button>
          <span style={{ fontSize: 12, color: "#555", whiteSpace: "nowrap", minWidth: 64, textAlign: "center" }}>Page {currentPage + 1} / {totalPages}</span>
          <button className="rb-btn rb-btn-secondary" onClick={() => goToPage(Math.min(totalPages - 1, currentPage + 1))} disabled={currentPage >= totalPages - 1} style={{ padding: "6px 10px" }}>▶</button>
        </div>

        <div className="rb-export-group">
          <button className="rb-btn" onClick={handleDownloadPDF} disabled={!!exporting}>
            {exporting === "pdf" ? "Generating…" : "↓ PDF"}
          </button>
          <button className="rb-btn rb-btn-primary" onClick={handleDownloadWord} disabled={!!exporting}>
            {exporting === "word" ? "Generating…" : "↓ Word"}
          </button>
        </div>
      </div>

      {/* ── Save confirmation toast ─────────────────────────────────────── */}
      {saveToastVisible && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", background: "#e8f8e8", borderBottom: "1px solid #b8e0b8", fontSize: 13, color: "#1a5a1a", flexShrink: 0 }}>
          <span style={{ fontSize: 16 }}>✓</span>
          <span style={{ flex: 1 }}>
            <strong>Layout saved</strong> — your section arrangement, titles, and settings have been saved to this browser.
            {" "}This layout will be <strong>automatically restored</strong> the next time you open the Report Builder.
            {" "}Use <strong>↩ Restore saved</strong> in the toolbar to revert to this state at any time.
          </span>
          <button
            onClick={() => setSaveToastVisible(false)}
            style={{ padding: "3px 8px", borderRadius: 8, border: "1px solid #90c890", background: "transparent", color: "#2a7a2a", fontSize: 12, cursor: "pointer" }}
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Restore banner ──────────────────────────────────────────────── */}
      {restoreBannerVisible && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", background: "#f0e8fc", borderBottom: "1px solid #d8c4f4", fontSize: 13, color: "#5a2a8a", flexShrink: 0 }}>
          <span style={{ fontSize: 16 }}>↩</span>
          <span style={{ flex: 1 }}>
            <strong>Layout restored</strong> — your previously saved report layout has been applied automatically.
            {" "}New data from the current session will be loaded into the existing sections.
          </span>
          <button
            onClick={autoFitElements}
            style={{ padding: "3px 10px", borderRadius: 8, border: "1px solid #b090d8", background: "#fff", color: "#7030b8", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            ⇅ Re-fit
          </button>
          <button
            onClick={() => setRestoreBannerVisible(false)}
            style={{ padding: "3px 8px", borderRadius: 8, border: "1px solid #d0c0e8", background: "transparent", color: "#a080c0", fontSize: 12, cursor: "pointer" }}
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <div className="rb-main">
        <aside className="rb-sections-sidebar">
          <div className="rb-reorder-header">
            <span style={{ fontWeight: 600, color: "#a020d0" }}>Report Sections</span>
            <span className="rb-reorder-hint">
              Drag <GripVertical size={11} style={{ verticalAlign: "-2px" }} /> to reorder · check to show / hide
            </span>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sectionChecklist.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div className="rb-reorder-list">
                {sectionChecklist.map((sec) => {
                  const elState = elements.find((e) => e.id === sec.id);
                  return (
                    <SortableSectionRow
                      key={sec.id}
                      id={sec.id}
                      label={sec.label}
                      visible={sec.visible}
                      onToggle={() => (sec.visible ? hideElement(sec.id) : showElement(sec.id))}
                      onSelect={() => scrollToSection(sec.id)}
                    >
                      {sec.id === "topRisk" && elState && sec.visible ? renderViewToggle(elState) : null}
                    </SortableSectionRow>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        </aside>

        <div style={{ position: "relative", flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {/* Floating page nav arrows on the right side */}
          <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, zIndex: 100, pointerEvents: "none" }}>
            <button
              onClick={() => goToPage(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
              style={{ width: 36, height: 36, borderRadius: "50%", border: "1px solid #d0c0e8", background: currentPage === 0 ? "#f0f0f0" : "#fff", cursor: currentPage === 0 ? "not-allowed" : "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.12)", opacity: currentPage === 0 ? 0.35 : 1, pointerEvents: "auto", color: "#a020d0" }}
            >▲</button>
            <div style={{ background: "#fff", border: "1px solid #e0d0f0", borderRadius: 14, padding: "4px 10px", fontSize: 11, color: "#a020d0", fontWeight: 700, textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.1)", whiteSpace: "nowrap" }}>
              {currentPage + 1} / {totalPages}
            </div>
            <button
              onClick={() => goToPage(Math.min(totalPages - 1, currentPage + 1))}
              disabled={currentPage >= totalPages - 1}
              style={{ width: 36, height: 36, borderRadius: "50%", border: "1px solid #d0c0e8", background: currentPage >= totalPages - 1 ? "#f0f0f0" : "#fff", cursor: currentPage >= totalPages - 1 ? "not-allowed" : "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.12)", opacity: currentPage >= totalPages - 1 ? 0.35 : 1, pointerEvents: "auto", color: "#a020d0" }}
            >▼</button>
          </div>

          <div className="rb-canvas-container" ref={canvasContainerRef} onScroll={handleCanvasScroll}>
            <div className="rb-canvas-hint">
              Reorder &amp; show / hide sections from the left panel · Auto-fit to tidy spacing · Export when ready
            </div>
            <div ref={canvasRef} className="rb-canvas" style={{ width: CANVAS_W, height: canvasH, background: "transparent", boxShadow: "none" }}>
              {Array.from({ length: totalPages }).map((_, i) => (
                <div key={`page-bg-${i}`} style={{ position: "absolute", top: i * PAGE_H, left: 0, width: CANVAS_W, height: PAGE_H, zIndex: 0, pointerEvents: "none" }}>
                  <div style={{
                    width: CANVAS_W,
                    height: PAGE_H - PAGE_GAP,
                    background: "#fff",
                    boxShadow: "0 4px 28px rgba(0, 0, 0, 0.18)",
                  }} />
                  {i < totalPages - 1 && (
                    <div className="rb-page-label" style={{ position: "absolute", bottom: PAGE_GAP / 2 - 5, right: 12, fontSize: 10, color: "#777", fontWeight: 500 }}>
                      Page {i + 1}
                    </div>
                  )}
                </div>
              ))}

              {visibleElements.map((el, orderIndex) => {
                const lay = layout.map.get(el.id);
                return (
                  <ReportSection
                    key={el.id}
                    id={el.id}
                    label={el.label}
                    height={lay?.height ?? computeIdealHeight(el)}
                    marginTop={lay?.marginTop ?? 0}
                    onHide={() => hideElement(el.id)}
                  >
                    {renderContent(el, orderIndex)}
                  </ReportSection>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Project picker overlay ─────────────────────────────────────── */}
      {showProjectPicker && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 480, maxWidth: "90vw", maxHeight: "80vh", display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 16px 48px rgba(0,0,0,0.22)" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#2d1a4a" }}>Select Projects for Report</div>
            <div style={{ fontSize: 13, color: "#666", lineHeight: 1.5 }}>
              No projects were carried over from Path Analysis. Select one or more projects below, or go to Path Analysis to load and filter data first.
            </div>
            {pickerLoading ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#888", fontSize: 14 }}>Loading projects…</div>
            ) : availableProjects.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#888", fontSize: 14 }}>No projects found on this profile.</div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button className="rb-btn rb-btn-secondary" style={{ fontSize: 12, padding: "4px 12px" }} onClick={() => setPickerSelected(new Set(availableProjects))}>Select All</button>
                  <button className="rb-btn rb-btn-secondary" style={{ fontSize: 12, padding: "4px 12px" }} onClick={() => setPickerSelected(new Set())}>Clear</button>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "#aaa" }}>{pickerSelected.size} / {availableProjects.length} selected</span>
                </div>
                <div style={{ overflowY: "auto", flex: 1, maxHeight: 300, display: "flex", flexDirection: "column", gap: 4, border: "1px solid #e8e0f0", borderRadius: 10, padding: "10px 12px" }}>
                  {availableProjects.map((name) => {
                    const checked = pickerSelected.has(name);
                    return (
                      <label key={name} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "7px 8px", borderRadius: 8, background: checked ? "#f2e8fc" : "transparent" }}>
                        <input type="checkbox" checked={checked} onChange={() => setPickerSelected((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; })} style={{ accentColor: "#a020d0", width: 16, height: 16, flexShrink: 0 }} />
                        <span style={{ fontSize: 13, color: "#333" }}>{name}</span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="rb-btn rb-btn-secondary" onClick={() => navigate("/analysis/path")} style={{ fontSize: 13 }}>← Path Analysis</button>
              <button className="rb-btn" disabled={pickerSelected.size === 0} onClick={loadSelectedProjects} style={{ fontSize: 13 }}>
                Load {pickerSelected.size > 0 ? `${pickerSelected.size} Project${pickerSelected.size > 1 ? "s" : ""}` : "Projects"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
