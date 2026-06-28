import { Spinner } from "@chakra-ui/react";
import { getTagColor } from "../tagColor";
import ProjectsDialogs from "./ProjectsDialogs";
import { FONT, COLOR } from "../../../features/ui/designTokens";
import type { ProjectsViewModel, SortMeta } from "./ProjectsViewModel";

/**
 * v2 Projects layout — Home.dc.html frame "01 — Home" translated to React and
 * driven by the ProjectsViewModel. Fluid (the comp is a fixed 1920×900 mockup).
 * RSB hues / behaviour come from the container; nothing is fetched here.
 */

// Column widths (the name column flexes; metric columns are fixed like the comp).
const W_VERIF = 130;
const W_AUTO = 120;
const W_DATE = 175;

const card: React.CSSProperties = {
  background: COLOR.white,
  border: `1px solid ${COLOR.border}`,
  borderRadius: 6,
};

const labelStyle: React.CSSProperties = { fontFamily: FONT, fontWeight: 700, fontSize: 16, color: COLOR.text };
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
const captionStyle: React.CSSProperties = { fontFamily: FONT, fontSize: 12, color: COLOR.gray500 };

function SortGlyph({ meta, multi }: { meta: SortMeta | null; multi: boolean }) {
  if (!meta) return <span style={{ fontSize: 12, color: COLOR.gray400, cursor: "pointer" }}>↕</span>;
  return (
    <span style={{ fontSize: 12, color: COLOR.gray600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 2 }}>
      {meta.direction === "asc" ? "▲" : "▼"}
      {multi && <span style={{ fontSize: 10, fontWeight: 700 }}>{meta.priority}</span>}
    </span>
  );
}

export default function ProjectsLayoutV2(vm: ProjectsViewModel) {
  const {
    nameQuery,
    setNameQuery,
    tagFilters,
    addTagFilter,
    removeTagFilter,
    tagInputValue,
    setTagInputValue,
    tagSuggestionsOpen,
    setTagSuggestionsOpen,
    filteredTagOptions,
    projects,
    filtered,
    selected,
    loadingProjects,
    error,
    status,
    showCreateProjectPrompt,
    onRowClick,
    toggleSelectAll,
    onCreateProject,
    askDelete,
    loadProject,
    loadPathAnalysis,
    loadTreatment,
    askShare,
    shareTargets,
    sortConfig,
    getSortMeta,
    handleSort,
    setEditingProject,
    setOpenEdit,
    activeProfile,
    legacyProjects,
    migratingLegacyProjects,
    moveLegacyProjects,
  } = vm;

  const noSelection = selected.size === 0;
  const allSelected = filtered.length > 0 && selected.size === filtered.length;

  const onEditSelected = () => {
    const first = projects.find((p) => selected.has(p.name));
    if (!first) return;
    setEditingProject(first);
    setOpenEdit(true);
  };

  // Primary action buttons in the action row.
  const actionBtn = (
    label: string,
    onClick: () => void,
    opts?: { disabled?: boolean; danger?: boolean }
  ) => {
    const disabled = opts?.disabled;
    const base: React.CSSProperties = {
      flex: 1,
      height: 40,
      boxSizing: "border-box",
      padding: "0 16px",
      borderRadius: 6,
      fontFamily: FONT,
      fontWeight: 700,
      fontSize: 16,
      textAlign: "center",
      border: "none",
      cursor: disabled ? "not-allowed" : "pointer",
    };
    const style: React.CSSProperties = disabled
      ? { ...base, background: COLOR.gray100, border: `1px solid ${COLOR.border}`, color: COLOR.gray400 }
      : opts?.danger
        ? { ...base, background: COLOR.danger, color: COLOR.white }
        : { ...base, background: COLOR.gray800, color: COLOR.white };
    return (
      <button style={style} disabled={disabled} onClick={onClick}>
        {label}
      </button>
    );
  };

  const headerCell = (label: string, key: string, width?: number) => {
    const meta = getSortMeta(key);
    return (
      <div
        onClick={(e) => handleSort(key, e)}
        style={{
          width,
          flex: width ? undefined : 1,
          minWidth: 0,
          display: "flex",
          gap: 6,
          alignItems: "center",
          flexShrink: 0,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <span style={labelStyle}>{label}</span>
        <SortGlyph meta={meta} multi={sortConfig.length > 1} />
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 32, boxSizing: "border-box", minHeight: "100vh" }}>
      {activeProfile && legacyProjects.length > 0 && (
        <div style={{ ...card, padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <div>
            <div style={{ ...labelStyle }}>Shared projects are still outside this profile</div>
            <div style={captionStyle}>
              {legacyProjects.length} existing project{legacyProjects.length === 1 ? " is" : "s are"} still in the shared project area.
              Move them into {activeProfile.name} so they appear in this profile's project list.
            </div>
          </div>
          <button
            onClick={() => void moveLegacyProjects()}
            disabled={migratingLegacyProjects}
            style={{
              height: 40,
              padding: "0 16px",
              background: COLOR.teal,
              color: COLOR.white,
              border: "none",
              borderRadius: 6,
              fontFamily: FONT,
              fontWeight: 700,
              fontSize: 16,
              cursor: migratingLegacyProjects ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {migratingLegacyProjects ? "Moving…" : "Move Shared Projects"}
          </button>
        </div>
      )}

      {/* ── Search Area ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "row", gap: 12, width: "100%" }}>
            {/* Search by Tags */}
            <div style={{ flex: 1.8, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <label style={labelStyle}>Search by Tags</label>
              <div style={{ position: "relative" }}>
                <div style={{ ...inputStyle, height: "auto", minHeight: 40, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  {tagFilters.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        background: getTagColor(tag),
                        color: COLOR.white,
                        borderRadius: 999,
                        padding: "2px 10px",
                        fontFamily: FONT,
                        fontWeight: 700,
                        fontSize: 14,
                      }}
                    >
                      {tag}
                      <button
                        type="button"
                        aria-label={`Remove ${tag} filter`}
                        onClick={() => removeTagFilter(tag)}
                        style={{ background: "transparent", border: "none", color: COLOR.white, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={tagInputValue}
                    onChange={(e) => {
                      setTagInputValue(e.target.value);
                      setTagSuggestionsOpen(true);
                    }}
                    onFocus={() => setTagSuggestionsOpen(true)}
                    onBlur={() => window.setTimeout(() => setTagSuggestionsOpen(false), 100)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && filteredTagOptions.length > 0) {
                        e.preventDefault();
                        addTagFilter(filteredTagOptions[0]);
                      }
                    }}
                    placeholder={tagFilters.length === 0 ? "Type or click to select tags…" : "Add more tags…"}
                    style={{ flex: 1, minWidth: 120, border: "none", outline: "none", fontFamily: FONT, fontSize: 16, background: "transparent", color: COLOR.text }}
                  />
                </div>
                {tagSuggestionsOpen && filteredTagOptions.length > 0 && (
                  <div
                    style={{
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
                      zIndex: 20,
                    }}
                  >
                    {filteredTagOptions.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addTagFilter(tag);
                        }}
                        style={{ display: "block", width: "100%", padding: "9px 12px", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", color: COLOR.text, fontFamily: FONT, fontSize: 16 }}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Search by Project Name */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <label style={labelStyle}>Search by Project Name</label>
              <input
                type="text"
                value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)}
                placeholder="Type project name, road, or tag…"
                style={inputStyle}
              />
            </div>
          </div>

          <button
            onClick={onCreateProject}
            style={{
              flexShrink: 0,
              width: 194,
              height: 40,
              padding: 0,
              background: COLOR.blue,
              color: COLOR.white,
              border: "none",
              borderRadius: 6,
              fontFamily: FONT,
              fontWeight: 700,
              fontSize: 16,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Create Project
          </button>
        </div>

        <span style={captionStyle}>
          {loadingProjects
            ? "Loading project list from backend…"
            : error
              ? status === "offline"
                ? "Backend appears offline."
                : error
              : `Showing ${filtered.length} of ${projects.length} Project${projects.length === 1 ? "" : "s"}${selected.size > 0 ? ` | ${selected.size} Selected` : ""}`}
        </span>
      </div>

      {/* ── Action Button Row ── */}
      <div style={{ display: "flex", gap: 32, alignItems: "center", flexShrink: 0 }}>
        <div style={{ flex: 1, display: "flex", gap: 16 }}>
          {actionBtn("Coding", loadProject, { disabled: noSelection })}
          {actionBtn("Path Analysis", loadPathAnalysis, { disabled: noSelection })}
          {actionBtn("Treatment", loadTreatment, { disabled: noSelection })}
        </div>
        <div style={{ flex: 1, display: "flex", gap: 16 }}>
          {actionBtn("Share", askShare, { disabled: noSelection || shareTargets.length === 0 })}
          {actionBtn("Edit", onEditSelected, { disabled: noSelection })}
          {actionBtn("Delete", askDelete, { disabled: noSelection, danger: true })}
        </div>
      </div>

      {/* ── Project Table ── */}
      <div style={{ ...card, flex: 1, display: "flex", flexDirection: "column", gap: 8, padding: 16, boxSizing: "border-box", overflow: "hidden", minHeight: 280 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 32, padding: "0 8px", flexShrink: 0 }}>
          <div style={{ flex: "0 0 33%", minWidth: 180, display: "flex", gap: 8, alignItems: "center" }}>
            <div onClick={toggleSelectAll} style={checkboxBox(allSelected)}>
              {allSelected && checkSvg}
            </div>
            {headerCell("Project Name", "name")}
          </div>
          {headerCell("Verification", "verification_status", W_VERIF)}
          {headerCell("Autocode", "autocode_status", W_AUTO)}
          {headerCell("Date Modified", "last_updated", W_DATE)}
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={labelStyle}>Tags</span>
          </div>
        </div>

        {/* Body */}
        <div style={{ border: `1px solid ${COLOR.border}`, borderRadius: 6, overflow: "auto", flex: 1 }}>
          {loadingProjects ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", padding: 40, fontFamily: FONT, fontSize: 16, color: COLOR.gray500 }}>
              <Spinner size="sm" /> Loading projects…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", fontFamily: FONT, fontSize: 16, color: COLOR.gray500 }}>
              {showCreateProjectPrompt ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
                  <div style={labelStyle}>No projects matched "{nameQuery.trim()}"</div>
                  <div style={captionStyle}>Create a new project if this road or project has not been set up yet.</div>
                  <button
                    onClick={onCreateProject}
                    style={{ height: 40, padding: "0 16px", background: COLOR.blue, color: COLOR.white, border: "none", borderRadius: 6, fontFamily: FONT, fontWeight: 700, fontSize: 16, cursor: "pointer" }}
                  >
                    Create Project
                  </button>
                </div>
              ) : (
                "No projects found"
              )}
            </div>
          ) : (
            filtered.map((p) => {
              const isSelected = selected.has(p.name);
              const verif =
                typeof p.total_segments === "number" && p.total_segments > 0
                  ? `${(((p.verified_segment_count ?? 0) / p.total_segments) * 100).toFixed(1)}%`
                  : typeof p.total_segments === "number"
                    ? "0%"
                    : "—";
              const auto =
                typeof p.total_segments === "number" && p.total_segments > 0
                  ? `${(((p.autocoded_segment_count ?? 0) / p.total_segments) * 100).toFixed(1)}%`
                  : typeof p.total_segments === "number"
                    ? "0%"
                    : "—";
              const date = p.last_updated
                ? new Date(p.last_updated).toLocaleString("en-GB", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
                : "—";
              return (
                <div
                  key={p.name}
                  onClick={() => onRowClick(p.name)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 32,
                    padding: "8px 12px",
                    minHeight: 35,
                    boxSizing: "border-box",
                    borderBottom: `1px solid ${COLOR.rowDivider}`,
                    cursor: "pointer",
                    background: isSelected ? COLOR.gray100 : "transparent",
                  }}
                >
                  <div style={{ flex: "0 0 33%", minWidth: 180, display: "flex", gap: 8, alignItems: "center" }}>
                    <div onClick={(e) => { e.stopPropagation(); onRowClick(p.name); }} style={checkboxBox(isSelected)}>
                      {isSelected && checkSvg}
                    </div>
                    <span style={{ fontFamily: FONT, fontWeight: 400, fontSize: 16, color: COLOR.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.name}>
                      {p.name}
                    </span>
                  </div>
                  <span style={{ width: W_VERIF, flexShrink: 0, fontFamily: FONT, fontSize: 16, color: COLOR.text }}>{verif}</span>
                  <span style={{ width: W_AUTO, flexShrink: 0, fontFamily: FONT, fontSize: 16, color: COLOR.text }}>{auto}</span>
                  <span style={{ width: W_DATE, flexShrink: 0, fontFamily: FONT, fontSize: 16, color: COLOR.gray600 }}>{date}</span>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    {p.tags && p.tags.length > 0 ? (
                      p.tags
                        .slice()
                        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
                        .map((tag) => (
                          <span
                            key={tag}
                            style={{ background: getTagColor(tag), color: COLOR.white, borderRadius: 999, padding: "2px 10px", fontFamily: FONT, fontWeight: 700, fontSize: 14, whiteSpace: "nowrap" }}
                          >
                            {tag}
                          </span>
                        ))
                    ) : (
                      <span style={captionStyle}>—</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <ProjectsDialogs {...vm} />
    </div>
  );
}

// 16×16 checkbox per DESIGN_GUIDE §7.
function checkboxBox(checked: boolean): React.CSSProperties {
  return checked
    ? { width: 16, height: 16, background: COLOR.blue, border: `1px solid ${COLOR.blue}`, borderRadius: 2, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }
    : { width: 16, height: 16, border: `1px solid ${COLOR.borderInput}`, borderRadius: 2, flexShrink: 0, background: COLOR.white, cursor: "pointer" };
}

const checkSvg = (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
    <path d="M2 6l3 3 5-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
