import { useState } from "react";
import { Spinner } from "@chakra-ui/react";
import ImageUploadModal from "../../sidebar/components/ImageUploadModal";
import SelectRoadsMap from "../SelectRoadsMap";
import { getTagColor } from "../../Projects/tagColor";
import { FONT, COLOR } from "../../../features/ui/designTokens";
import type { CreateProjectViewModel } from "./CreateProjectViewModel";

/**
 * v2 Create Project layout — Home.dc.html FRAME 2 "Project Create" translated to
 * React and driven by the CreateProjectViewModel. Fluid (the comp is a fixed
 * 1920×900 mockup). Behaviour comes entirely from the view-model.
 *
 * Known gaps (intentional, per the redesign brief):
 *   - The folder-table summary columns (Segments / Quarter / Distance / Projects)
 *     have no bulk data source yet — a system-wide summary fetcher is planned for
 *     app launch. Until then they render "—" (the selected folder shows what its
 *     on-demand preview provides).
 *   - Map mode embeds the existing SelectRoadsMap. The comp's split Layer-View /
 *     Roads-Found panel layout is a follow-up that requires decoupling that
 *     monolithic map component.
 */

const card: React.CSSProperties = { background: COLOR.white, border: `1px solid ${COLOR.border}`, borderRadius: 6 };
const labelStyle: React.CSSProperties = { fontFamily: FONT, fontWeight: 700, fontSize: 16, color: COLOR.text };
const captionStyle: React.CSSProperties = { fontFamily: FONT, fontWeight: 400, fontSize: 12, color: COLOR.gray500 };
const inputStyle: React.CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  height: 40,
  padding: "8px 12px",
  border: `1px solid ${COLOR.borderInput}`,
  borderRadius: 6,
  fontFamily: FONT,
  fontSize: 16,
  outline: "none",
  background: COLOR.white,
  color: COLOR.text,
};

// Folder-table column widths (comp: Segments 120, Quarter 120, Distance 140, Projects 110).
const W_SEG = 120;
const W_QTR = 120;
const W_DIST = 140;
const W_PROJ = 110;

function checkboxBox(checked: boolean): React.CSSProperties {
  return checked
    ? { width: 16, height: 16, background: COLOR.blue, border: `1px solid ${COLOR.blue}`, borderRadius: 2, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }
    : { width: 16, height: 16, border: `1px solid ${COLOR.borderInput}`, borderRadius: 2, flexShrink: 0, background: COLOR.white, cursor: "pointer", display: "flex" };
}
const checkSvg = (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
    <path d="M2 6l3 3 5-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Header cell with sort glyph placeholder (§7 / §1a — icon pending).
function headerCell(label: string, width: number) {
  return (
    <div style={{ width, flexShrink: 0, display: "flex", gap: 5, alignItems: "center", justifyContent: "center" }}>
      <span style={labelStyle}>{label}</span>
      <span style={{ fontSize: 12, color: COLOR.gray400, cursor: "pointer" }}>↕</span>
    </div>
  );
}

// Segmented control segment (§5): selected = white/#1A202C/700, unselected = #EDF2F7/#718096/400.
function segStyle(selected: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    padding: "0 16px",
    fontFamily: FONT,
    fontSize: 16,
    cursor: "pointer",
    userSelect: "none",
    ...(selected
      ? { background: COLOR.white, color: COLOR.gray800, fontWeight: 700 }
      : { background: COLOR.gray100, color: COLOR.gray500, fontWeight: 400 }),
  };
}

export default function CreateProjectLayoutV2(vm: CreateProjectViewModel) {
  const {
    name,
    setName,
    tags,
    tagInput,
    setTagInput,
    tagSuggestionsOpen,
    setTagSuggestionsOpen,
    filteredTagSuggestions,
    commitTag,
    removeTag,
    handleTagInputKeyDown,
    folders,
    selectedFolders,
    setSelectedFolders,
    folderSummaries,
    loadingFolderSummaries,
    folderProjectCounts,
    usingRoadSelection,
    selectedRoadFolders,
    unavailableSelectedRoads,
    roadAvailabilityVersion,
    onRoadSelectionChange,
    onSelectionGeometryChange,
    err,
    canCreate,
    creating,
    onCreate,
    onCancel,
    imageUploadModalOpen,
    openImageUploadModal,
    closeImageUploadModal,
    onImageUploadSuccess,
  } = vm;

  // V2-only presentation state: which source mode + the table search query.
  const [createBy, setCreateBy] = useState<"folder" | "map">("folder");
  const [folderSearch, setFolderSearch] = useState("");

  const switchToFolder = () => {
    setCreateBy("folder");
    // Clear any road selection so the create commit resolves to the chosen folders.
    onRoadSelectionChange([]);
    onSelectionGeometryChange(null);
  };
  const switchToMap = () => {
    setCreateBy("map");
    // Clear folder selection so the create commit resolves to the drawn roads.
    setSelectedFolders([]);
  };

  const visibleFolders = folders.filter((f) => f.toLowerCase().includes(folderSearch.trim().toLowerCase()));
  const toggleFolderRow = (f: string) =>
    setSelectedFolders(selectedFolders.includes(f) ? selectedFolders.filter((x) => x !== f) : [...selectedFolders, f]);
  const allVisibleSelected = visibleFolders.length > 0 && visibleFolders.every((f) => selectedFolders.includes(f));
  const toggleSelectAllVisible = () =>
    setSelectedFolders(
      allVisibleSelected
        ? selectedFolders.filter((f) => !visibleFolders.includes(f))
        : Array.from(new Set([...selectedFolders, ...visibleFolders]))
    );
  const createDisabled = !canCreate || creating;

  return (
    <div style={{ display: "flex", flexDirection: "column", padding: 32, boxSizing: "border-box", height: "100vh", gap: 16 }}>
      <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 20, color: COLOR.text, flexShrink: 0 }}>Create Project</span>
      <div style={{ ...card, flex: 1, display: "flex", flexDirection: "column", gap: 16, padding: 16, overflow: "hidden", minHeight: 0 }}>
        {/* ── Name + Tags (two columns) ── */}
        <div style={{ display: "flex", gap: 16, flexShrink: 0, alignItems: "flex-start" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={labelStyle}>Project Name *</label>
            <input
              type="text"
              placeholder="No underscore _"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
            {name.includes("_") && (
              <span style={{ ...captionStyle, color: COLOR.danger }}>Project name cannot contain underscores (_)</span>
            )}
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={labelStyle}>Project Tags</label>
            <div style={{ position: "relative" }}>
              <div style={{ ...inputStyle, height: "auto", minHeight: 40, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {tags.map((tag) => (
                  <span
                    key={tag}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, background: getTagColor(tag), color: COLOR.white, borderRadius: 999, padding: "2px 10px", fontFamily: FONT, fontWeight: 700, fontSize: 14 }}
                  >
                    {tag}
                    <button
                      type="button"
                      aria-label={`Remove ${tag}`}
                      onClick={() => removeTag(tag)}
                      style={{ background: "transparent", border: "none", color: COLOR.white, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => {
                    setTagInput(e.target.value);
                    setTagSuggestionsOpen(true);
                  }}
                  onFocus={() => setTagSuggestionsOpen(true)}
                  onBlur={() => window.setTimeout(() => setTagSuggestionsOpen(false), 100)}
                  onKeyDown={handleTagInputKeyDown}
                  placeholder={tags.length === 0 ? "Type tag and press comma or enter" : "Add more…"}
                  style={{ flex: 1, minWidth: 140, border: "none", outline: "none", fontFamily: FONT, fontSize: 16, background: "transparent", color: COLOR.text }}
                />
              </div>
              {tagSuggestionsOpen && filteredTagSuggestions.length > 0 && (
                <div style={dropdownStyle}>
                  {filteredTagSuggestions.map((tag) => (
                    <button key={tag} type="button" onMouseDown={(e) => { e.preventDefault(); commitTag(tag); }} style={dropdownItemStyle}>
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Create by: segmented control ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={labelStyle}>Create by:</span>
          <div style={{ display: "flex", height: 40, border: `1px solid ${COLOR.border}`, borderRadius: 6, overflow: "hidden" }}>
            <div onClick={switchToFolder} style={segStyle(createBy === "folder")}>Folder</div>
            <div onClick={switchToMap} style={segStyle(createBy === "map")}>Map</div>
          </div>
        </div>

        {/* ── Create by Folder ── */}
        {createBy === "folder" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, overflow: "hidden", minHeight: 0 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexShrink: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={labelStyle}>Search by Folder Name</label>
                <input
                  type="text"
                  value={folderSearch}
                  onChange={(e) => setFolderSearch(e.target.value)}
                  placeholder="Type to filter folders…"
                  style={{ ...inputStyle, width: 460, maxWidth: "100%" }}
                />
              </div>
              <button onClick={openImageUploadModal} style={secondaryInlineBtn}>Import Folder</button>
              {loadingFolderSummaries && (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Spinner size="sm" color={COLOR.blue} />
                  <span style={captionStyle}>Loading folder stats…</span>
                </div>
              )}
            </div>

            {err && <span style={{ ...captionStyle, color: COLOR.danger, flexShrink: 0 }}>{err}</span>}

            {/* Folder table */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, overflow: "hidden", minHeight: 0 }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", padding: "0 12px", flexShrink: 0 }}>
                <div style={{ flex: 1, display: "flex", gap: 8, alignItems: "center" }}>
                  <div onClick={toggleSelectAllVisible} style={checkboxBox(allVisibleSelected)}>{allVisibleSelected && checkSvg}</div>
                  <span style={labelStyle}>Folder Name</span>
                  <span style={{ fontSize: 12, color: COLOR.gray400, cursor: "pointer" }}>↕</span>
                </div>
                {headerCell("Segments", W_SEG)}
                {headerCell("Quarter", W_QTR)}
                {headerCell("Distance (km)", W_DIST)}
                {headerCell("Projects", W_PROJ)}
              </div>
              {/* Body */}
              <div style={{ border: `1px solid ${COLOR.border}`, borderRadius: 6, overflowY: "auto", flex: 1, minHeight: 0 }}>
                {visibleFolders.length === 0 ? (
                  <div style={{ padding: 40, textAlign: "center", ...captionStyle, fontSize: 16, color: COLOR.gray500 }}>
                    {folders.length === 0 ? "No source folders found." : `No folders match "${folderSearch.trim()}".`}
                  </div>
                ) : (
                  visibleFolders.map((f) => {
                    const isSelected = selectedFolders.includes(f);
                    return (
                      <div
                        key={f}
                        onClick={() => toggleFolderRow(f)}
                        style={{ display: "flex", alignItems: "center", padding: "8px 12px", minHeight: 35, boxSizing: "border-box", borderBottom: `1px solid ${COLOR.rowDivider}`, cursor: "pointer", background: isSelected ? COLOR.gray100 : "transparent" }}
                      >
                        <div style={{ flex: 1, display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                          <div onClick={(e) => { e.stopPropagation(); toggleFolderRow(f); }} style={checkboxBox(isSelected)}>{isSelected && checkSvg}</div>
                          <span style={{ fontFamily: FONT, fontWeight: 400, fontSize: 16, color: COLOR.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f}>{f}</span>
                        </div>
                        {/* Summary columns: auto-loaded stats; a pending row shows a
                            quiet spinner until its background preview resolves. */}
                        {(() => {
                          const s = folderSummaries[f];
                          const resolved = !!(s && s.cached);
                          const seg = s?.segment_count;
                          const dist = s?.total_distance_km;
                          const projCount = folderProjectCounts[f] ?? 0;
                          const pendingCell = <Spinner size="xs" color={COLOR.gray400} />;
                          return (
                            <>
                              <span style={cellStyle(W_SEG)}>
                                {resolved ? (typeof seg === "number" ? seg : "—") : pendingCell}
                              </span>
                              <span style={cellStyle(W_QTR)}>
                                {resolved ? (s?.survey_quarter ?? (s?.survey_quarters?.length ? s.survey_quarters.join(", ") : "—")) : pendingCell}
                              </span>
                              <span style={cellStyle(W_DIST)}>
                                {resolved ? (typeof dist === "number" ? dist.toFixed(1) : "—") : pendingCell}
                              </span>
                              {/* Projects count is derived from the project list — always known. */}
                              <span style={cellStyle(W_PROJ)}>{projCount}</span>
                            </>
                          );
                        })()}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Create by Map ── */}
        {createBy === "map" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, overflow: "auto", minHeight: 0 }}>
            <SelectRoadsMap
              variant="v2"
              onSelectionChange={onRoadSelectionChange}
              onSelectionGeometryChange={onSelectionGeometryChange}
              refreshKey={roadAvailabilityVersion}
              focusRoadName=""
            />
            {usingRoadSelection && unavailableSelectedRoads.length > 0 && (
              <span style={{ ...captionStyle, color: COLOR.danger }}>
                Deselect unavailable roads to create the project. {unavailableSelectedRoads.length} selected road{unavailableSelectedRoads.length === 1 ? " is" : "s are"} missing local files.
              </span>
            )}
            {usingRoadSelection && unavailableSelectedRoads.length === 0 && (
              <span style={{ ...captionStyle, color: COLOR.teal }}>
                Project will be created from nodes inside the boundary across {selectedRoadFolders.length} selected road{selectedRoadFolders.length === 1 ? "" : "s"}.
              </span>
            )}
          </div>
        )}

        {/* ── Commit / cancel (194px each) ── */}
        <div style={{ display: "flex", gap: 16, flexShrink: 0 }}>
          <button onClick={onCreate} disabled={createDisabled} style={primaryBtn(createDisabled)}>
            {creating ? "Creating…" : "Create"}
          </button>
          <button onClick={onCancel} style={ghostBtn}>Cancel</button>
        </div>
      </div>

      <ImageUploadModal open={imageUploadModalOpen} onClose={closeImageUploadModal} onSuccess={onImageUploadSuccess} />
    </div>
  );
}

function cellStyle(width: number): React.CSSProperties {
  return { width, flexShrink: 0, textAlign: "center", fontFamily: FONT, fontSize: 16, color: COLOR.text };
}

const dropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  background: COLOR.white,
  border: `1px solid ${COLOR.border}`,
  borderRadius: 6,
  boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
  maxHeight: 220,
  overflowY: "auto",
  zIndex: 1200,
};
const dropdownItemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "9px 12px",
  textAlign: "left",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: COLOR.text,
  fontFamily: FONT,
  fontSize: 16,
};

// Secondary (dark) inline button — guide §4.
const secondaryInlineBtn: React.CSSProperties = {
  flexShrink: 0,
  height: 40,
  padding: "0 16px",
  background: COLOR.gray800,
  color: COLOR.white,
  border: "none",
  borderRadius: 6,
  fontFamily: FONT,
  fontWeight: 700,
  fontSize: 16,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

// Primary commit — blue (Create), fixed 194px. Disabled = grey per guide §4.
function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    width: 194,
    height: 40,
    boxSizing: "border-box",
    padding: "0 16px",
    borderRadius: 6,
    fontFamily: FONT,
    fontWeight: 700,
    fontSize: 16,
    cursor: disabled ? "not-allowed" : "pointer",
    ...(disabled
      ? { background: COLOR.gray100, border: `1px solid ${COLOR.border}`, color: COLOR.gray400 }
      : { background: COLOR.blue, border: "none", color: COLOR.white }),
  };
}

// Ghost cancel — guide §4.
const ghostBtn: React.CSSProperties = {
  width: 194,
  height: 40,
  boxSizing: "border-box",
  padding: "0 16px",
  background: "transparent",
  border: `1px solid ${COLOR.borderInput}`,
  borderRadius: 6,
  fontFamily: FONT,
  fontWeight: 700,
  fontSize: 16,
  color: COLOR.text,
  cursor: "pointer",
};
