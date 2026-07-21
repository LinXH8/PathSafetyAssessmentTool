/**
 * reportPrimitives.tsx — small presentational building blocks for the Report
 * Builder canvas.
 *
 * Extracted verbatim from `reportBuilderPage.tsx` (S2.5 decomposition). Each is
 * a pure, self-contained component driven entirely by props (plus local
 * presentational state for the edit/error toggles). No data fetching, no
 * sessionStorage — safe to render inside any report section.
 *
 * - `SegmentImage`   — image with a "No image available" fallback on error.
 * - `AttrTag`        — a single "• name +multiplier" risk-factor line.
 * - `TreatmentBadge` — the green "TREATMENTS APPLIED" list for a segment.
 * - `EditableText`   — click-to-edit inline text field.
 */
import React, { useState } from "react";
import { TREATMENT_NAMES } from "../reportBuilderConstants";

/** Image with graceful "No image available" fallback on missing/broken src. */
export function SegmentImage({ src, width, height }: { src?: string; width: number | string; height: number | string }) {
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

/** One "• attribute +multiplier" risk-factor line. */
export function AttrTag({ name, multiplier }: { name: string; multiplier: number }) {
  return (
    <span style={{ fontSize: 9, color: "#555", display: "block", lineHeight: 1.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
      • {name} <span style={{ color: "#cc2200", fontWeight: 700 }}>+{multiplier.toFixed(1)}</span>
    </span>
  );
}

/** The green "TREATMENTS APPLIED (n)" list; renders nothing when empty. */
export function TreatmentBadge({ ids }: { ids: number[] }) {
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

/** Click-to-edit inline text: shows a value with a ✎ hint, swaps to an input on click. */
export function EditableText({ value, onChange, style, placeholder }: {
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
      <span data-html2canvas-ignore="true" style={{ marginLeft: 3, fontSize: "0.65em", color: "#a020d0", opacity: 0.45, verticalAlign: "middle" }}>✎</span>
    </span>
  );
}
