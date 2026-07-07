/**
 * ReportSection.tsx — the two chrome components that frame report content.
 *
 * Extracted verbatim from `reportBuilderPage.tsx` (S2.5 decomposition).
 * - `ReportSection`       — one visible canvas section: absolute-flow wrapper +
 *   hide button + error boundary around the section body.
 * - `SortableSectionRow`  — a row in the left "Sections" panel: dnd-kit grip +
 *   visibility checkbox + label (+ optional inline controls).
 *
 * Both are pure presentational components — layout geometry / ordering comes in
 * as props; they own no data. Side effects: none.
 */
import React from "react";
import { GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import SectionErrorBoundary from "../SectionErrorBoundary";
import { CANVAS_W } from "../reportBuilderConstants";

/**
 * One per visible section, laid out in normal document flow + a `marginTop`
 * spacer (page-break avoidance). Reordering is done from the left Sections panel,
 * so these are static — not draggable.
 */
export function ReportSection({
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

/**
 * A lightweight row — grip handle + visibility checkbox + label — for reordering
 * sections without dragging the full (map/chart-heavy) canvas section. Shares
 * the same `elements` array order, so reordering here reorders the report.
 */
export function SortableSectionRow({
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
