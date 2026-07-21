import { useState } from "react";
import { Spinner } from "@chakra-ui/react";
import { LuCheck, LuChevronsUpDown, LuChevronUp, LuChevronDown } from "react-icons/lu";
import ImageUploadModal from "../../sidebar/components/ImageUploadModal";
import ImportProjectModalV2 from "../components/ImportProjectModalV2";
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

const card: React.CSSProperties = { background: COLOR.white, border: `1px solid ${COLOR.border}`, borderRadius: "0.375rem" };
const labelStyle: React.CSSProperties = { fontFamily: FONT, fontWeight: 700, fontSize: "1rem", color: COLOR.text };
const captionStyle: React.CSSProperties = { fontFamily: FONT, fontWeight: 400, fontSize: "0.75rem", color: COLOR.gray500 };
const inputStyle: React.CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  height: "2.5rem",
  padding: "0.5rem 0.75rem",
  border: `1px solid ${COLOR.borderInput}`,
  borderRadius: "0.375rem",
  fontFamily: FONT,
  fontSize: "1rem",
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
    ? { width: "1rem", height: "1rem", background: COLOR.blue, border: `1px solid ${COLOR.blue}`, borderRadius: "0.125rem", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }
    : { width: "1rem", height: "1rem", border: `1px solid ${COLOR.borderInput}`, borderRadius: "0.125rem", flexShrink: 0, background: COLOR.white, cursor: "pointer", display: "flex" };
}
const checkSvg = <LuCheck size={10} color="#fff" strokeWidth={3} />;

type SortKey = "name" | "segments" | "quarter" | "distance" | "projects";

// Segmented control segment (§5): selected = white/#1A202C/700, unselected = #EDF2F7/#718096/400.
function segStyle(selected: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    padding: "0 1rem",
    fontFamily: FONT,
    fontSize: "1rem",
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
    importProjectModalOpen,
    openImportProjectModal,
    closeImportProjectModal,
    onProjectsImported,
    onViewImportedProjects,
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

  // Column sorting. Click a header to sort asc; click again to flip desc.
  // Rows whose summary hasn't resolved yet (pending spinner) sort to the bottom.
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const onSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };
  const sortValue = (f: string, key: SortKey): string | number | undefined => {
    const s = folderSummaries[f];
    switch (key) {
      case "name": return f.toLowerCase();
      // segment_count / total_distance_km are nullable in the summary; normalise
      // null -> undefined so they match the "no sortable value" case.
      case "segments": return s?.segment_count ?? undefined;
      case "quarter": return s?.survey_quarter ?? (s?.survey_quarters?.length ? s.survey_quarters.join(", ") : undefined);
      case "distance": return s?.total_distance_km ?? undefined;
      case "projects": return folderProjectCounts[f] ?? 0;
    }
  };
  const sortedFolders = (() => {
    if (!sortKey) return visibleFolders;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...visibleFolders].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      const aNil = va === undefined || va === null || va === "";
      const bNil = vb === undefined || vb === null || vb === "";
      if (aNil && bNil) return 0;
      if (aNil) return 1;   // unresolved rows always last
      if (bNil) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  })();

  // Header cell (guide §7 / §1a): label + a clickable sort glyph that reflects state.
  const sortGlyph = (key: SortKey) =>
    sortKey !== key
      ? <LuChevronsUpDown size={13} color={COLOR.gray400} style={{ flexShrink: 0 }} />
      : sortDir === "asc"
        ? <LuChevronUp size={13} color={COLOR.blue} style={{ flexShrink: 0 }} />
        : <LuChevronDown size={13} color={COLOR.blue} style={{ flexShrink: 0 }} />;
  const headerCell = (label: string, width: number, key: SortKey) => (
    <div
      onClick={() => onSort(key)}
      style={{ width, flexShrink: 0, display: "flex", gap: "0.3125rem", alignItems: "center", justifyContent: "center", cursor: "pointer", userSelect: "none" }}
    >
      <span style={labelStyle}>{label}</span>
      {sortGlyph(key)}
    </div>
  );

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
    <div style={{ display: "flex", flexDirection: "column", padding: "2rem", boxSizing: "border-box", height: "100vh", gap: "1rem" }}>
      <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: "1.25rem", color: COLOR.text, flexShrink: 0 }}>Create Project</span>
      <div style={{ ...card, flex: 1, display: "flex", flexDirection: "column", gap: "1rem", padding: "1rem", overflow: "hidden", minHeight: 0 }}>
        {/* ── Name + Tags (two columns) ── */}
        <div style={{ display: "flex", gap: "1rem", flexShrink: 0, alignItems: "flex-start" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
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

          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label style={labelStyle}>Project Tags</label>
            <div style={{ position: "relative" }}>
              <div style={{ ...inputStyle, height: "auto", minHeight: "2.5rem", display: "flex", flexWrap: "wrap", gap: "0.375rem", alignItems: "center" }}>
                {tags.map((tag) => (
                  <span
                    key={tag}
                    style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", background: getTagColor(tag), color: COLOR.white, borderRadius: 999, padding: "0.125rem 0.625rem", fontFamily: FONT, fontWeight: 700, fontSize: "0.875rem" }}
                  >
                    {tag}
                    <button
                      type="button"
                      aria-label={`Remove ${tag}`}
                      onClick={() => removeTag(tag)}
                      style={{ background: "transparent", border: "none", color: COLOR.white, cursor: "pointer", fontSize: "0.875rem", lineHeight: 1, padding: 0 }}
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
                  style={{ flex: 1, minWidth: "8.75rem", border: "none", outline: "none", fontFamily: FONT, fontSize: "1rem", background: "transparent", color: COLOR.text }}
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

          {/* Import an exported .psat.zip bundle instead of creating from source. */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label style={{ ...labelStyle, visibility: "hidden" }} aria-hidden>Import</label>
            <button onClick={openImportProjectModal} style={secondaryInlineBtn}>Import Project</button>
          </div>
        </div>

        {/* ── Create by: segmented control ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexShrink: 0 }}>
          <span style={labelStyle}>Create by:</span>
          <div style={{ display: "flex", height: "2.5rem", border: `1px solid ${COLOR.border}`, borderRadius: "0.375rem", overflow: "hidden" }}>
            <div onClick={switchToFolder} style={segStyle(createBy === "folder")}>Folder</div>
            <div onClick={switchToMap} style={segStyle(createBy === "map")}>Map</div>
          </div>
        </div>

        {/* ── Create by Folder ── */}
        {createBy === "folder" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.75rem", overflow: "hidden", minHeight: 0 }}>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexShrink: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <label style={labelStyle}>Search by Folder Name</label>
                <input
                  type="text"
                  value={folderSearch}
                  onChange={(e) => setFolderSearch(e.target.value)}
                  placeholder="Type to filter folders…"
                  style={{ ...inputStyle, width: "28.75rem", maxWidth: "100%" }}
                />
              </div>
              <button onClick={openImageUploadModal} style={secondaryInlineBtn}>Import Source</button>
              {loadingFolderSummaries && (
                <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.375rem" }}>
                  <Spinner size="sm" color={COLOR.blue} />
                  <span style={captionStyle}>Loading folder stats…</span>
                </div>
              )}
            </div>

            {err && <span style={{ ...captionStyle, color: COLOR.danger, flexShrink: 0 }}>{err}</span>}

            {/* Folder table */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.5rem", overflow: "hidden", minHeight: 0 }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", padding: "0 0.75rem", flexShrink: 0 }}>
                <div style={{ flex: 1, display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <div onClick={toggleSelectAllVisible} style={checkboxBox(allVisibleSelected)}>{allVisibleSelected && checkSvg}</div>
                  <div onClick={() => onSort("name")} style={{ display: "flex", gap: "0.3125rem", alignItems: "center", cursor: "pointer", userSelect: "none" }}>
                    <span style={labelStyle}>Folder Name</span>
                    {sortGlyph("name")}
                  </div>
                </div>
                {headerCell("Segments", W_SEG, "segments")}
                {headerCell("Quarter", W_QTR, "quarter")}
                {headerCell("Distance (km)", W_DIST, "distance")}
                {headerCell("Projects", W_PROJ, "projects")}
              </div>
              {/* Body */}
              <div style={{ border: `1px solid ${COLOR.border}`, borderRadius: "0.375rem", overflowY: "auto", flex: 1, minHeight: 0 }}>
                {visibleFolders.length === 0 ? (
                  <div style={{ padding: "2.5rem", textAlign: "center", ...captionStyle, fontSize: "1rem", color: COLOR.gray500 }}>
                    {folders.length === 0 ? "No source folders found." : `No folders match "${folderSearch.trim()}".`}
                  </div>
                ) : (
                  sortedFolders.map((f) => {
                    const isSelected = selectedFolders.includes(f);
                    return (
                      <div
                        key={f}
                        onClick={() => toggleFolderRow(f)}
                        style={{ display: "flex", alignItems: "center", padding: "0.5rem 0.75rem", minHeight: "2.1875rem", boxSizing: "border-box", borderBottom: `1px solid ${COLOR.rowDivider}`, cursor: "pointer", background: isSelected ? COLOR.gray100 : "transparent" }}
                      >
                        <div style={{ flex: 1, display: "flex", gap: "0.5rem", alignItems: "center", minWidth: 0 }}>
                          <div onClick={(e) => { e.stopPropagation(); toggleFolderRow(f); }} style={checkboxBox(isSelected)}>{isSelected && checkSvg}</div>
                          <span style={{ fontFamily: FONT, fontWeight: 400, fontSize: "1rem", color: COLOR.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f}>{f}</span>
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
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.5rem", overflow: "auto", minHeight: 0 }}>
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
            {/* Create failures must surface here too — the folder-mode error line
                above is not rendered in map mode, so a failed create otherwise
                looked like the button did nothing. */}
            {err && <span style={{ ...captionStyle, color: COLOR.danger }}>{err}</span>}
          </div>
        )}

        {/* ── Commit / cancel (12.125rem each) ── */}
        <div style={{ display: "flex", gap: "1rem", flexShrink: 0 }}>
          <button onClick={onCreate} disabled={createDisabled} style={primaryBtn(createDisabled)}>
            {creating ? "Creating…" : "Create"}
          </button>
          <button onClick={onCancel} style={ghostBtn}>Cancel</button>
        </div>
      </div>

      <ImageUploadModal open={imageUploadModalOpen} onClose={closeImageUploadModal} onSuccess={onImageUploadSuccess} />
      <ImportProjectModalV2
        open={importProjectModalOpen}
        onClose={closeImportProjectModal}
        onImported={onProjectsImported}
        onViewProjects={onViewImportedProjects}
      />
    </div>
  );
}

function cellStyle(width: number): React.CSSProperties {
  return { width, flexShrink: 0, textAlign: "center", fontFamily: FONT, fontSize: "1rem", color: COLOR.text };
}

const dropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 0.25rem)",
  left: 0,
  right: 0,
  background: COLOR.white,
  border: `1px solid ${COLOR.border}`,
  borderRadius: "0.375rem",
  boxShadow: "0 0.5rem 1.5rem rgba(0,0,0,0.12)",
  maxHeight: "13.75rem",
  overflowY: "auto",
  zIndex: 1200,
};
const dropdownItemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "0.5625rem 0.75rem",
  textAlign: "left",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: COLOR.text,
  fontFamily: FONT,
  fontSize: "1rem",
};

// Secondary (dark) inline button — guide §4.
const secondaryInlineBtn: React.CSSProperties = {
  flexShrink: 0,
  height: "2.5rem",
  padding: "0 1rem",
  background: COLOR.gray800,
  color: COLOR.white,
  border: "none",
  borderRadius: "0.375rem",
  fontFamily: FONT,
  fontWeight: 700,
  fontSize: "1rem",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

// Primary commit — blue (Create), fixed 12.125rem. Disabled = grey per guide §4.
function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    width: "12.125rem",
    height: "2.5rem",
    boxSizing: "border-box",
    padding: "0 1rem",
    borderRadius: "0.375rem",
    fontFamily: FONT,
    fontWeight: 700,
    fontSize: "1rem",
    cursor: disabled ? "not-allowed" : "pointer",
    ...(disabled
      ? { background: COLOR.gray100, border: `1px solid ${COLOR.border}`, color: COLOR.gray400 }
      : { background: COLOR.blue, border: "none", color: COLOR.white }),
  };
}

// Ghost cancel — guide §4.
const ghostBtn: React.CSSProperties = {
  width: "12.125rem",
  height: "2.5rem",
  boxSizing: "border-box",
  padding: "0 1rem",
  background: "transparent",
  border: `1px solid ${COLOR.borderInput}`,
  borderRadius: "0.375rem",
  fontFamily: FONT,
  fontWeight: 700,
  fontSize: "1rem",
  color: COLOR.text,
  cursor: "pointer",
};
