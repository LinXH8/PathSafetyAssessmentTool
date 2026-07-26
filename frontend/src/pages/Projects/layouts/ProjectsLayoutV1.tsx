import { Button, Spinner } from "@chakra-ui/react";
import { LuPencil, LuArrowUpDown, LuArrowUp, LuArrowDown } from "react-icons/lu";
import { getTagColor } from "../tagColor";
import ProjectsDialogs from "./ProjectsDialogs";
import type { ProjectsViewModel } from "./ProjectsViewModel";

/**
 * v1 Projects layout — the current arrangement, extracted verbatim from
 * projects.tsx and driven entirely by the ProjectsViewModel. No logic lives
 * here; it is a pure function of its props.
 */
export default function ProjectsLayoutV1(vm: ProjectsViewModel) {
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
    hasActiveFilters,
    clearAllFilters,
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
    sortConfig,
    getSortMeta,
    handleSort,
    setEditingProject,
    setOpenEdit,
  } = vm;

  const renderHeader = (label: string, key: string, width?: number) => {
    const meta = getSortMeta(key);
    return (
      <th
        style={{ width, cursor: "pointer", userSelect: "none" }}
        onClick={(e) => handleSort(key, e)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          {label}
          {meta ? (
            <div style={{ display: "flex", alignItems: "center" }}>
              {meta.direction === 'asc' ? <LuArrowUp size={14} /> : <LuArrowDown size={14} />}
              {sortConfig.length > 1 && (
                <span style={{ fontSize: "10px", marginLeft: "2px", fontWeight: "bold" }}>
                  {meta.priority}
                </span>
              )}
            </div>
          ) : (
            <LuArrowUpDown size={14} style={{ opacity: 0.3 }} />
          )}
        </div>
      </th>
    );
  };

  return (
    <div className="projects-root">
      {/* Legacy "shared projects" migration banner removed — projects live in a
          profile now, and pre-seeded road projects are auto-adopted on login. */}

      <div className="search-panel">
        <div className="search-row">
          <div className="search-item">
            <label htmlFor="nameQuery">Search by project, road, or tag</label>
            <input
              id="nameQuery"
              type="text"
              placeholder="Type project name, road, or tag…"
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              className="search-input"
            />
          </div>
          <div className="search-item">
            <label htmlFor="tagFilterInput">Filter by tags</label>
            <div style={{ position: "relative" }}>
              <div className="tag-input-container">
                <div className="tag-input-wrapper">
                  {tagFilters.map((tag) => (
                    <div
                      key={tag}
                      className="tag-chip"
                      style={{ backgroundColor: getTagColor(tag) }}
                    >
                      <span className="tag-chip-text">{tag}</span>
                      <button
                        className="tag-chip-remove"
                        onClick={() => removeTagFilter(tag)}
                        type="button"
                        aria-label={`Remove ${tag} filter`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <input
                    id="tagFilterInput"
                    type="text"
                    value={tagInputValue}
                    onChange={(event) => {
                      setTagInputValue(event.target.value);
                      setTagSuggestionsOpen(true);
                    }}
                    onFocus={() => setTagSuggestionsOpen(true)}
                    onBlur={() => {
                      window.setTimeout(() => setTagSuggestionsOpen(false), 100);
                    }}
                    placeholder={tagFilters.length === 0 ? "Type or click to select tags..." : "Add more tags..."}
                    className="tag-input-field"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && filteredTagOptions.length > 0) {
                        event.preventDefault();
                        addTagFilter(filteredTagOptions[0]);
                      }
                    }}
                  />
                </div>
              </div>
              {tagSuggestionsOpen && filteredTagOptions.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 8px)",
                    left: 0,
                    right: 0,
                    background: "var(--chakra-colors-bg)",
                    border: "1px solid var(--chakra-colors-border)",
                    borderRadius: "8px",
                    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
                    maxHeight: "220px",
                    overflowY: "auto",
                    zIndex: 20,
                  }}
                >
                  {filteredTagOptions.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "10px 12px",
                        textAlign: "left",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--chakra-colors-fg)",
                        fontSize: "14px",
                      }}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        addTagFilter(tag);
                      }}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="search-summary-row">
          <div className="search-summary-text">
            {loadingProjects ? (
              <span className="search-summary-loading">
                <Spinner size="sm" />
                <span>Loading project list from backend...</span>
              </span>
            ) : error ? (
              <span className="search-summary-error">
                {status === "offline" ? "Backend appears offline." : error}
              </span>
            ) : (
              <>
                {`Showing ${filtered.length} of ${projects.length} project${projects.length === 1 ? "" : "s"}`}
                {selected.size > 0 ? ` • ${selected.size} selected` : ""}
              </>
            )}
          </div>
          <div className="search-summary-actions">
            {nameQuery.trim() && (
              <button
                type="button"
                className="active-filter-pill"
                onClick={() => setNameQuery("")}
              >
                Search: {nameQuery.trim()} ×
              </button>
            )}
            {tagFilters.map((tag) => (
              <button
                key={tag}
                type="button"
                className="active-filter-pill"
                onClick={() => removeTagFilter(tag)}
              >
                Tag: {tag} ×
              </button>
            ))}
            {hasActiveFilters && (
              <button
                type="button"
                className="clear-filters-btn"
                onClick={clearAllFilters}
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        <div className="actions-panel" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 600, fontSize: '14px' }}>
            Total Distance Verified: {(filtered.reduce((acc, p) => acc + (p.verified_segment_count || 0), 0) * 10 / 1000).toFixed(2)} km
          </div>
          <div className="buttons">
            <Button onClick={onCreateProject} colorPalette="black" variant="solid">
              Create Project
            </Button>
            <Button onClick={askDelete} colorPalette="red" disabled={!selected || selected.size === 0}>
              Delete Project
            </Button>
            <Button onClick={loadProject} colorPalette="blue" disabled={!selected || selected.size === 0}>
              Coding
            </Button>
            <Button onClick={loadPathAnalysis} style={{ backgroundColor: "#a220e3", color: "white" }} disabled={!selected || selected.size === 0}>
              Analyse Projects
            </Button>
            <Button onClick={loadTreatment} colorPalette="green" disabled={!selected || selected.size === 0}>
              Treatment Application
            </Button>
            <Button
              onClick={askShare}
              colorPalette="teal"
              variant="outline"
              disabled={!selected || selected.size === 0}
            >
              Share
            </Button>
          </div>
        </div>
      </div>

      <div className="table-container">
        <div className="table-wrap">
          <table className="project-table">
            <thead>
              <tr>
                <th style={{ width: 48 }}></th>
                {renderHeader("Project Name", "name")}
                {renderHeader("Verification Status", "verification_status", 140)}
                {renderHeader("Distance Verified", "distance_verified", 140)}
                {renderHeader("Autocode Status", "autocode_status", 140)}
                {renderHeader("Time Modified", "last_updated", 180)}
                <th>Tags</th>
                <th style={{ width: 180 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loadingProjects ? (
                <tr>
                  <td colSpan={8} className="empty">
                    <div className="table-loading-state">
                      <Spinner size="sm" />
                      <span>Loading projects...</span>
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty">
                    {showCreateProjectPrompt ? (
                      <div className="empty-project-search-state">
                        <div className="empty-project-search-title">
                          No projects matched "{nameQuery.trim()}"
                        </div>
                        <div className="empty-project-search-copy">
                          Create a new project if this road or project has not been set up yet.
                        </div>
                        <Button
                          size="sm"
                          colorPalette="black"
                          variant="solid"
                          onClick={onCreateProject}
                        >
                          Create Project
                        </Button>
                      </div>
                    ) : (
                      "No projects found"
                    )}
                  </td>
                </tr>
              ) : (
                <>
                  <tr className="select-all-row" onClick={toggleSelectAll} style={{ cursor: "pointer" }}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={filtered.length > 0 && selected.size === filtered.length}
                        onChange={toggleSelectAll}
                        aria-label="Select all projects"
                      />
                    </td>
                    <td colSpan={6}>
                      <strong>Select All</strong>
                    </td>
                  </tr>
                  {filtered.map((p) => {
                    const isSelected = selected.has(p.name);

                    return (
                      <tr
                        key={p.name}
                        className={isSelected ? "row selected" : "row"}
                        onClick={() => onRowClick(p.name)}
                        style={{ cursor: "pointer" }}
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => onRowClick(p.name)}
                            aria-label={`Select ${p.name}`}
                          />
                        </td>
                        <td title={p.name}>{p.name}</td>
                        <td>
                          <span style={{ fontSize: "14px", fontWeight: "500" }}>
                            {typeof p.total_segments === 'number' && p.total_segments > 0
                              ? `${((p.verified_segment_count ?? 0) / p.total_segments * 100).toFixed(1)}%`
                              : typeof p.total_segments === 'number'
                                ? "0%"
                                : "—"}
                          </span>
                          {/* Debug: Show raw values if needed */}
                          {/* (segments: {p.verified_segment_count}/{p.total_segments}) */}
                        </td>
                        <td>
                          <span style={{ fontSize: "14px", fontWeight: "500" }}>
                            {typeof p.verified_segment_count === 'number'
                              ? `${((p.verified_segment_count * 10) / 1000).toFixed(2)} km`
                              : "0.00 km"}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: "14px", fontWeight: "500" }}>
                            {typeof p.total_segments === 'number' && p.total_segments > 0
                              ? `${((p.autocoded_segment_count ?? 0) / p.total_segments * 100).toFixed(1)}%`
                              : typeof p.total_segments === 'number'
                                ? "0%"
                                : "—"}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: "14px", color: "#666" }}>
                            {p.last_updated ? new Date(p.last_updated).toLocaleString('en-GB', {
                              year: 'numeric',
                              month: 'numeric',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            }) : "—"}
                          </span>
                        </td>
                        <td>
                          <div className="tags-container">
                            {p.tags && p.tags.length > 0 ? (
                              p.tags
                                .slice()
                                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
                                .map((tag) => (
                                  <span
                                    key={tag}
                                    className="tag-badge"
                                    style={{
                                      backgroundColor: getTagColor(tag),
                                      borderWidth: "1px",
                                      borderStyle: "solid",
                                    }}
                                  >
                                    {tag}
                                  </span>
                                ))
                            ) : (
                              <span className="no-tags">—</span>
                            )}
                          </div>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => {
                              setEditingProject(p);
                              setOpenEdit(true);
                            }}
                            className="row-edit-btn"
                            aria-label="Edit project"
                          >
                            <LuPencil className="row-edit-icon" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ProjectsDialogs {...vm} />
    </div>
  );
}
