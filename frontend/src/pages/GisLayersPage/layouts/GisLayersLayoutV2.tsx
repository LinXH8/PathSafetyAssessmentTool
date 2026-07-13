import type { CSSProperties } from "react";
import { Spinner } from "@chakra-ui/react";
import { LuChevronDown } from "react-icons/lu";
import ThemeAwareTileLayer from "../../../components/common/ThemeAwareTileLayer";
import ShapefileModal from "../../sidebar/components/ShapefileModal";
import EditParametersModal from "../EditParametersModal";
import { MapContainer, Polyline, CircleMarker, Polygon as LeafletPolygon, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { GIS_VIEWER_GEOMETRY_COLORS } from "../../../constants/mapColors";
import { FONT, COLOR, RADIUS } from "../../../features/ui/designTokens";
import { v2CardStyle } from "../../PathAnalysisPage/components/paV2Primitives";
import {
  FitBounds,
  MapAutosize,
  getLayerMetadata,
  getLayerPurpose,
  formatBytes,
  FILTER_OPTIONS,
} from "../gisLayersConstants";
import type { ShapefileInfo } from "../../../api";
import type { GisLayersViewModel } from "./GisLayersViewModel";

/**
 * v2 GIS Layers shell — a fresh Milestone-B translation of the page to the v2
 * design system (there is no GIS comp in the design package; this follows
 * temp/psat-design/DESIGN_GUIDE.md + the established v2 pages). Fluid,
 * forced-light, tokenised.
 *
 * Layout intent:
 *  - The page **title lives on the canvas**, never inside a card, and carries
 *    **no button** (per the standing request). The "Update GIS Layer" global
 *    action is a full-width teal button anchoring the left panel — mirroring how
 *    "Import Shapefile" anchors the Layer View panel (DESIGN_GUIDE §13).
 *  - Left card: Layers header + category combobox + text filter + scrollable
 *    layer list. Right card: the map (no Leaflet zoom chrome, MapAutosize).
 */

// 400px panel → 25rem (density catalog). Fixed rem, never raw vw.
const LEFT_W = "25rem";

const labelStyle: CSSProperties = { fontFamily: FONT, fontWeight: 700, fontSize: "1rem", color: COLOR.text };
const captionStyle: CSSProperties = { fontFamily: FONT, fontWeight: 400, fontSize: "0.75rem", color: COLOR.gray500 };
const inputStyle: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  height: "2.5rem",
  padding: "0.5rem 0.75rem",
  border: `1px solid ${COLOR.borderInput}`,
  borderRadius: RADIUS,
  fontFamily: FONT,
  fontSize: "1rem",
  outline: "none",
  background: COLOR.white,
  color: COLOR.text,
};

/** Small inline row action (Edit / Revert / Delete). */
function RowBtn({
  label,
  color,
  onClick,
}: {
  label: string;
  color: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent",
        border: "none",
        padding: "0.125rem 0.25rem",
        fontFamily: FONT,
        fontWeight: 700,
        fontSize: "0.75rem",
        color,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

/** Neutral metadata chip (category / geometry). Reserved hues are off-limits here. */
function Chip({ text, outline }: { text: string; outline?: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0.125rem 0.5rem",
        borderRadius: "0.25rem",
        fontFamily: FONT,
        fontWeight: 700,
        fontSize: "0.75rem",
        background: outline ? "transparent" : COLOR.gray100,
        border: outline ? `1px solid ${COLOR.border}` : "none",
        color: COLOR.gray600,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

export default function GisLayersLayoutV2(vm: GisLayersViewModel) {
  const {
    shapefiles, loading, error,
    filterMode, setFilterMode, filterText, setFilterText,
    dropdownOpen, setDropdownOpen, hoveredFilter, setHoveredFilter, tooltipPos, setTooltipPos, filterDropdownRef,
    selectedLayer, onSelectLayer, mapLoading, mapError, mapFeatures, initialCenter,
    confirmDeletePath, onDeleteClick, onCancelDelete, onConfirmDelete,
    confirmRevertPath, onRevertClick, onCancelRevert, onConfirmRevert,
    actionLoading, actionError, onClearActionError,
    shapefileModalOpen, onOpenUpdateModal, onCloseUpdateModal,
    editingParamsFile, onEditParams, onCloseParams, onParamsSaved,
  } = vm;

  const renderTooltip = (props: any) => (
    <Tooltip sticky>
      <div style={{ padding: "0.25rem" }}>
        {Object.entries(props).slice(0, 5).map(([k, v]) => (
          <div key={k} style={{ fontFamily: FONT, fontSize: "0.75rem", color: COLOR.text }}>
            <strong>{k}:</strong> {String(v)}
          </div>
        ))}
      </div>
    </Tooltip>
  );

  const filtered = shapefiles.filter(f => {
    const modeMatch = filterMode === "all" || getLayerPurpose(f) === filterMode;
    const textMatch = !filterText || f.name.toLowerCase().includes(filterText.toLowerCase());
    return modeMatch && textMatch;
  });

  const activeFilter = FILTER_OPTIONS.find(o => o.value === filterMode);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        padding: "2rem",
        boxSizing: "border-box",
        height: "100vh",
        overflow: "hidden",
        background: COLOR.canvas,
        fontFamily: FONT,
      }}
    >
      {/* ── Title (on canvas, no card, no button) ── */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: "1.25rem", color: COLOR.text }}>
          GIS Layers Mapping
        </div>
        <div style={{ ...captionStyle, marginTop: "0.25rem" }}>
          View all the shapefiles currently available in the system on the interactive map below.
        </div>
      </div>

      {/* ── Content: layers panel + map ── */}
      <div style={{ display: "flex", gap: "1rem", flex: 1, minHeight: 0 }}>
        {/* Left: Layers panel */}
        <div
          style={{
            ...v2CardStyle(),
            flex: `0 0 ${LEFT_W}`,
            width: LEFT_W,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Header: title + combobox + text filter */}
          <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem", flexShrink: 0 }}>
            <span style={labelStyle}>Layers</span>

            {/* Category combobox */}
            <div ref={filterDropdownRef} style={{ position: "relative" }}>
              <button
                onClick={() => setDropdownOpen(o => !o)}
                style={{
                  ...inputStyle,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span>{activeFilter?.label}</span>
                <LuChevronDown
                  size={13}
                  color={COLOR.gray500}
                  strokeWidth={2}
                  style={{ flexShrink: 0, marginLeft: "0.5rem", transform: dropdownOpen ? "rotate(180deg)" : "none", transformOrigin: "center" }}
                />
              </button>

              {dropdownOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 0.25rem)",
                    left: 0,
                    right: 0,
                    zIndex: 999,
                    background: COLOR.white,
                    border: `1px solid ${COLOR.border}`,
                    borderRadius: RADIUS,
                    boxShadow: "0 0.5rem 1.5rem rgba(0,0,0,0.12)",
                    overflow: "hidden",
                  }}
                  onMouseLeave={() => { setHoveredFilter(null); setTooltipPos(null); }}
                >
                  {FILTER_OPTIONS.map(opt => {
                    const active = filterMode === opt.value;
                    return (
                      <div
                        key={opt.value}
                        onMouseEnter={(e) => {
                          setHoveredFilter(opt.value);
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setTooltipPos({ x: rect.right + 10, y: rect.top + rect.height / 2 });
                        }}
                        onClick={() => { setFilterMode(opt.value); setDropdownOpen(false); setHoveredFilter(null); setTooltipPos(null); }}
                        style={{
                          padding: "0.5rem 0.75rem",
                          cursor: "pointer",
                          background: active ? COLOR.gray100 : "transparent",
                          fontFamily: FONT,
                          fontSize: "1rem",
                          fontWeight: active ? 700 : 400,
                          color: COLOR.text,
                        }}
                        onMouseOver={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = COLOR.canvas; }}
                        onMouseOut={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                      >
                        {opt.label}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Description tooltip — position:fixed escapes the panel overflow */}
              {dropdownOpen && hoveredFilter && tooltipPos && (
                <div
                  style={{
                    position: "fixed",
                    top: `${tooltipPos.y}px`,
                    left: `${tooltipPos.x}px`,
                    zIndex: 9999,
                    background: COLOR.text,
                    borderRadius: RADIUS,
                    boxShadow: "0 0.5rem 1.5rem rgba(0,0,0,0.25)",
                    padding: "0.75rem",
                    width: "14.375rem",
                    pointerEvents: "none",
                    transform: "translateY(-50%)",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: "-6px",
                      top: "50%",
                      width: 0,
                      height: 0,
                      transform: "translateY(-50%)",
                      borderTop: "6px solid transparent",
                      borderBottom: "6px solid transparent",
                      borderRight: `6px solid ${COLOR.text}`,
                    }}
                  />
                  <div style={{ fontFamily: FONT, fontSize: "0.75rem", fontWeight: 700, color: COLOR.white, marginBottom: "0.25rem" }}>
                    {FILTER_OPTIONS.find(o => o.value === hoveredFilter)?.label}
                  </div>
                  <div style={{ fontFamily: FONT, fontSize: "0.6875rem", color: COLOR.border, lineHeight: 1.6 }}>
                    {FILTER_OPTIONS.find(o => o.value === hoveredFilter)?.desc}
                  </div>
                </div>
              )}
            </div>

            {/* Text filter */}
            <input
              type="text"
              placeholder="Filter shapefiles…"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Action error banner */}
          {actionError && (
            <div
              style={{
                margin: "0 1rem 0.5rem",
                padding: "0.5rem 0.75rem",
                background: COLOR.dangerBg,
                border: `1px solid ${COLOR.danger}`,
                borderRadius: RADIUS,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.5rem",
              }}
            >
              <span style={{ fontFamily: FONT, fontSize: "0.75rem", color: COLOR.danger }}>{actionError}</span>
              <button
                onClick={onClearActionError}
                style={{ background: "transparent", border: "none", color: COLOR.danger, cursor: "pointer", fontSize: "0.875rem", lineHeight: 1 }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Scrollable layer list — each layer is its own v2 card */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              borderTop: `1px solid ${COLOR.border}`,
              background: COLOR.canvas,
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
              padding: (loading || error || filtered.length === 0) ? 0 : "0.75rem",
            }}
          >
            {loading ? (
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", justifyContent: "center", padding: "2rem", fontFamily: FONT, fontSize: "1rem", color: COLOR.gray500 }}>
                <Spinner size="sm" /> Loading files…
              </div>
            ) : error ? (
              <div style={{ padding: "1rem", fontFamily: FONT, fontSize: "1rem", color: COLOR.danger }}>{error}</div>
            ) : shapefiles.length === 0 ? (
              <div style={{ padding: "1rem", ...captionStyle }}>No shapefiles found.</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: "1rem", ...captionStyle }}>
                No shapefiles match{filterText ? ` "${filterText}"` : ""}.
              </div>
            ) : (
              filtered.map((file) => (
                <LayerItem
                  key={file.path}
                  file={file}
                  selected={selectedLayer?.path === file.path}
                  onSelect={onSelectLayer}
                  onEdit={onEditParams}
                  confirmDelete={confirmDeletePath === file.path}
                  onDeleteClick={onDeleteClick}
                  onCancelDelete={onCancelDelete}
                  onConfirmDelete={onConfirmDelete}
                  confirmRevert={confirmRevertPath === file.path}
                  onRevertClick={onRevertClick}
                  onCancelRevert={onCancelRevert}
                  onConfirmRevert={onConfirmRevert}
                  actionLoading={actionLoading}
                />
              ))
            )}
          </div>

          {/* Anchor: Update GIS Layer (global scope → teal), mirrors "Import Shapefile" */}
          <div style={{ padding: "1rem", borderTop: `1px solid ${COLOR.border}`, flexShrink: 0 }}>
            <button
              onClick={onOpenUpdateModal}
              style={{
                width: "100%",
                height: "2.5rem",
                background: COLOR.teal,
                color: COLOR.white,
                border: "none",
                borderRadius: RADIUS,
                fontFamily: FONT,
                fontWeight: 700,
                fontSize: "1rem",
                cursor: "pointer",
              }}
              onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = COLOR.tealHover; }}
              onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = COLOR.teal; }}
            >
              Update GIS Layer
            </button>
          </div>
        </div>

        {/* Right: Map */}
        <div style={{ ...v2CardStyle(), flex: 1, minWidth: 0, position: "relative", overflow: "hidden" }}>
          <MapOverlay selectedLayer={selectedLayer} loading={mapLoading} error={mapError} features={mapFeatures} />
          <MapContainer
            center={initialCenter}
            zoom={12}
            zoomControl={false}
            style={{ width: "100%", height: "100%" }}
            scrollWheelZoom
          >
            <ThemeAwareTileLayer />
            <MapAutosize />
            {mapFeatures?.bounds && <FitBounds bounds={mapFeatures.bounds} />}

            {mapFeatures?.polygons.map((poly, i) => (
              <LeafletPolygon
                key={`poly-${i}`}
                positions={poly.positions}
                pathOptions={{ color: GIS_VIEWER_GEOMETRY_COLORS.polygon, weight: 2, opacity: 0.8, fillColor: GIS_VIEWER_GEOMETRY_COLORS.polygon, fillOpacity: 0.2 }}
              >
                {renderTooltip(poly.props)}
              </LeafletPolygon>
            ))}
            {mapFeatures?.lines.map((line, i) => (
              <Polyline
                key={`line-${i}`}
                positions={line.positions}
                pathOptions={{ color: GIS_VIEWER_GEOMETRY_COLORS.line, weight: 3, opacity: 0.8 }}
              >
                {renderTooltip(line.props)}
              </Polyline>
            ))}
            {mapFeatures?.points.map((pt, i) => (
              <CircleMarker
                key={`pt-${i}`}
                center={pt.latlng}
                radius={5}
                pathOptions={{ color: GIS_VIEWER_GEOMETRY_COLORS.pointStroke, weight: 1, opacity: 0.9, fillOpacity: 0.7, fillColor: GIS_VIEWER_GEOMETRY_COLORS.pointFill }}
              >
                {renderTooltip(pt.props)}
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      </div>

      <ShapefileModal open={shapefileModalOpen} onClose={onCloseUpdateModal} variant="v2" />
      <EditParametersModal file={editingParamsFile} onClose={onCloseParams} onSaved={onParamsSaved} variant="v2" />
    </div>
  );
}

// ── A single layer card in the list ──
function LayerItem({
  file, selected,
  onSelect, onEdit,
  confirmDelete, onDeleteClick, onCancelDelete, onConfirmDelete,
  confirmRevert, onRevertClick, onCancelRevert, onConfirmRevert,
  actionLoading,
}: {
  file: ShapefileInfo;
  selected: boolean;
  onSelect: (f: ShapefileInfo | null) => void;
  onEdit: (f: ShapefileInfo) => void;
  confirmDelete: boolean;
  onDeleteClick: (f: ShapefileInfo) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (f: ShapefileInfo) => void;
  confirmRevert: boolean;
  onRevertClick: (f: ShapefileInfo) => void;
  onCancelRevert: () => void;
  onConfirmRevert: (f: ShapefileInfo) => void;
  actionLoading: boolean;
}) {
  const meta = getLayerMetadata(file.base_name);

  return (
    <div
      onClick={() => onSelect(selected ? null : file)}
      style={{
        ...v2CardStyle(),
        padding: "0.75rem",
        cursor: "pointer",
        border: `1px solid ${selected ? COLOR.blue : COLOR.border}`,
        boxShadow: selected ? `0 0 0 1px ${COLOR.blue}` : "none",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
    >
      {/* Name row + actions */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
        <span
          title={file.name}
          style={{ fontFamily: FONT, fontWeight: 700, fontSize: "1rem", color: COLOR.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}
        >
          {file.name}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "0.125rem", flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          <RowBtn label="Edit" color={COLOR.blue} onClick={(e) => { e.stopPropagation(); onEdit(file); }} />
          {file.is_renamed && (
            <RowBtn label="Revert" color={COLOR.gray600} onClick={(e) => { e.stopPropagation(); onRevertClick(file); }} />
          )}
          <RowBtn label="Delete" color={COLOR.danger} onClick={(e) => { e.stopPropagation(); onDeleteClick(file); }} />
        </div>
      </div>

      {/* Inline delete confirmation */}
      {confirmDelete && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem", padding: "0.5rem", background: COLOR.dangerBg, border: `1px solid ${COLOR.danger}`, borderRadius: RADIUS }}
        >
          <span style={{ fontFamily: FONT, fontSize: "0.75rem", color: COLOR.danger, flex: 1 }}>
            Delete "{file.name}"? This cannot be undone.
          </span>
          <MiniBtn label="Confirm" kind="danger" onClick={() => onConfirmDelete(file)} disabled={actionLoading} />
          <MiniBtn label="Cancel" kind="ghost" onClick={onCancelDelete} disabled={actionLoading} />
        </div>
      )}

      {/* Inline revert confirmation */}
      {confirmRevert && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem", padding: "0.5rem", background: COLOR.gray100, border: `1px solid ${COLOR.border}`, borderRadius: RADIUS }}
        >
          <span style={{ fontFamily: FONT, fontSize: "0.75rem", color: COLOR.text, flex: 1 }}>
            Revert "{file.name}" back to its original name "{file.original_name}"?
          </span>
          <MiniBtn label="Confirm" kind="primary" onClick={() => onConfirmRevert(file)} disabled={actionLoading} />
          <MiniBtn label="Cancel" kind="ghost" onClick={onCancelRevert} disabled={actionLoading} />
        </div>
      )}

      {/* Chips + size */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", marginTop: "0.5rem" }}>
        <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", minWidth: 0, overflow: "hidden" }}>
          <Chip text={file.category} />
          {file.geom_type && <Chip text={file.geom_type} outline />}
        </div>
        <span style={{ ...captionStyle, flexShrink: 0 }}>{formatBytes(file.size)}</span>
      </div>

      {/* Year / Source — each on its own row so long source names aren't truncated */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem", marginTop: "0.375rem", minWidth: 0 }}>
        <span style={captionStyle}><strong>Year:</strong> {file.year}</span>
        <span style={{ ...captionStyle, wordBreak: "break-word" }}>
          <strong>Source:</strong> {file.source}
        </span>
      </div>

      {/* Required Columns / Affects */}
      <div style={{ marginTop: "0.5rem", padding: "0.5rem", background: COLOR.canvas, border: `1px solid ${COLOR.border}`, borderRadius: RADIUS }}>
        <div style={{ fontFamily: FONT, fontSize: "0.75rem", color: COLOR.text, marginBottom: "0.25rem" }}>
          <strong>Required Columns:</strong> {file.required_columns || meta.reqCols}
        </div>
        <div style={{ fontFamily: FONT, fontSize: "0.75rem", color: COLOR.text, wordBreak: "break-word" }}>
          <strong>Affects:</strong> {file.affects || meta.affects}
          {file.is_custom_metadata && <span style={{ color: COLOR.gray500, fontStyle: "italic" }}> (user-defined)</span>}
        </div>
      </div>
    </div>
  );
}

// ── Small confirm/edit button (Save / Cancel / Confirm) ──
function MiniBtn({
  label, kind, onClick, disabled,
}: {
  label: string;
  kind: "primary" | "ghost" | "danger";
  onClick: () => void;
  disabled?: boolean;
}) {
  const base: CSSProperties = {
    height: "1.75rem",
    padding: "0 0.625rem",
    borderRadius: "0.25rem",
    fontFamily: FONT,
    fontWeight: 700,
    fontSize: "0.75rem",
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  };
  const style: CSSProperties =
    kind === "ghost"
      ? { ...base, background: "transparent", border: `1px solid ${COLOR.borderInput}`, color: COLOR.text }
      : kind === "danger"
        ? { ...base, background: COLOR.danger, border: "none", color: COLOR.white }
        : { ...base, background: COLOR.blue, border: "none", color: COLOR.white };
  return (
    <button style={style} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}

// ── Overlay covering the map for empty / loading / error / no-geometry states ──
function MapOverlay({
  selectedLayer, loading, error, features,
}: {
  selectedLayer: ShapefileInfo | null;
  loading: boolean;
  error: string | null;
  features: { totalCount: number } | null;
}) {
  const cover: CSSProperties = {
    position: "absolute",
    inset: 0,
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    gap: "0.75rem",
    background: "rgba(247,250,252,0.85)",
    fontFamily: FONT,
  };

  if (!selectedLayer) {
    return (
      <div style={cover}>
        <span style={{ fontSize: "1rem", color: COLOR.gray500 }}>Select a layer from the list to view it on the map</span>
      </div>
    );
  }
  if (loading) {
    return (
      <div style={cover}>
        <Spinner size="xl" color={COLOR.blue} />
        <span style={{ fontSize: "1rem", color: COLOR.gray600 }}>Loading layer: {selectedLayer.name}…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div style={cover}>
        <span style={{ fontSize: "1rem", fontWeight: 700, color: COLOR.danger }}>Failed to render layer: {error}</span>
      </div>
    );
  }
  if (features && features.totalCount === 0) {
    return (
      <div style={{ position: "absolute", inset: 0, zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "flex-end", paddingBottom: "2.5rem", pointerEvents: "none", fontFamily: FONT }}>
        <div style={{ background: COLOR.white, border: `1px solid ${COLOR.border}`, padding: "0.5rem 1rem", borderRadius: RADIUS, boxShadow: "0 0.25rem 0.75rem rgba(0,0,0,0.12)" }}>
          <span style={{ fontSize: "1rem", color: "#DD6B20", fontWeight: 700 }}>Layer loaded but contains no renderable geometries.</span>
        </div>
      </div>
    );
  }
  return null;
}
