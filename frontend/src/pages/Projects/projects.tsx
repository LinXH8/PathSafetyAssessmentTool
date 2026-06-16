import { useEffect, useMemo, useState } from "react";
import { fetchProjectList, ping, deleteProject as apiDeleteProject, shareProjects as apiShareProjects, type ProjectListItem } from "../../api";
import { matchesProjectSearch } from "../../utils/projectSearch";
import {
  Button,
  Dialog,
  Portal,
  CloseButton,
  Spinner,
} from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import { LuPencil, LuArrowUpDown, LuArrowUp, LuArrowDown } from "react-icons/lu";
import EditProjectModal from "./components/EditProjectModal";
import { toaster } from "../../components/ui/toaster";
import { useProfile } from "../../features/profile/ProfileProvider";

import "./projects.css";
import "./components/EditProjectModal.css";

const createProject = (navigate: any) => {
  navigate(`/projects/create`);
};

interface FileListResponse {
  projects: ProjectListItem[];
}

// Generate a consistent, bright, varied color for each unique tag
function getTagColor(tag: string): string {
  // Simple hash function to convert string to number
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Use multiple hash variations to increase color variety
  const hash2 = Math.abs(hash >> 16);
  const hash3 = Math.abs(hash << 3);

  // Create wider hue distribution with warm and cool colors
  // Avoid muddy middle ranges (40-60 yellow-green, 160-180 cyan)
  let hue = Math.abs(hash % 360);
  if (hue >= 40 && hue <= 60) hue = (hue + 30) % 360;  // Skip muddy yellow-green
  if (hue >= 160 && hue <= 180) hue = (hue + 30) % 360; // Skip muddy cyan

  // Higher saturation (75-95%) for more vibrant colors
  const saturation = 75 + (hash2 % 21); // 75-95%

  // Higher lightness (65-80%) for brighter, more visible colors
  const lightness = 65 + (hash3 % 16); // 65-80%

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

export default function Home() {
  const { profiles, activeProfile, legacyProjects, migrateLegacyProjects } = useProfile();

  // Status
  const [status, setStatus] = useState("checking...");
  const [error, setError] = useState<string | null>(null);

  // Project List
  const [Projectlist, setProjectList] = useState<FileListResponse | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);

  // Sorting
  type SortCriterion = { key: string; direction: 'asc' | 'desc' };
  const [sortConfig, setSortConfig] = useState<SortCriterion[]>([
    { key: 'last_updated', direction: 'desc' }, // Default to newest first
  ]);

  // Filter
  const [nameQuery, setNameQuery] = useState("");
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [tagInputValue, setTagInputValue] = useState("");
  const [tagSuggestionsOpen, setTagSuggestionsOpen] = useState(false);

  // Selected Projects (multiple selection)
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Delete dialog state
  const [openDelete, setOpenDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Share dialog state
  const [openShare, setOpenShare] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareTargetId, setShareTargetId] = useState<string>("");

  // Edit dialog state
  const [openEdit, setOpenEdit] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectListItem | null>(null);
  const [migratingLegacyProjects, setMigratingLegacyProjects] = useState(false);

  const navigate = useNavigate();

  const loadProjects = useMemo(() => {
    return () => {
      setLoadingProjects(true);
      setError(null);
      return fetchProjectList()
        .then((data) => setProjectList(data))
        .catch((nextError) => setError(String(nextError)))
        .finally(() => setLoadingProjects(false));
    };
  }, []);


  // Use effect
  useEffect(() => {
    ping()
      .then((r) => setStatus(r.status))
      .catch(() => setStatus("offline"));

    void loadProjects();
  }, [loadProjects]);

  // Listen for project verified status changes from coding page
  useEffect(() => {
    const handleVerificationUpdate = (event: CustomEvent) => {
      const { projectName, verified, verifiedSegmentCount } = event.detail;

      // Update the project list directly
      setProjectList((prev) => {
        if (!prev) return prev;
        return {
          projects: prev.projects.map((p) => {
            if (p.name === projectName) {
              const updates: any = {};
              if (verified !== undefined) updates.verified = verified;
              if (verifiedSegmentCount !== undefined) updates.verified_segment_count = verifiedSegmentCount;
              return { ...p, ...updates };
            }
            return p;
          }),
        };
      });
    };

    window.addEventListener("psat:verified:updated", handleVerificationUpdate as EventListener);
    return () => window.removeEventListener("psat:verified:updated", handleVerificationUpdate as EventListener);
  }, []);

  // Listen for project autocoded status changes from coding page
  useEffect(() => {
    const handleAutocodedUpdate = (event: CustomEvent) => {
      const { projectName, autocodedSegmentCount } = event.detail;

      // Update the project list directly
      setProjectList((prev) => {
        if (!prev) return prev;
        return {
          projects: prev.projects.map((p) => {
            if (p.name === projectName) {
              if (autocodedSegmentCount !== undefined) {
                return { ...p, autocoded_segment_count: autocodedSegmentCount };
              }
            }
            return p;
          }),
        };
      });
    };

    window.addEventListener("psat:autocoded:updated", handleAutocodedUpdate as EventListener);
    return () => window.removeEventListener("psat:autocoded:updated", handleAutocodedUpdate as EventListener);
  }, []);

  // UseMemo projects
  const projects: ProjectListItem[] = useMemo(() => {
    if (!Projectlist?.projects) return [];

    return Projectlist.projects.slice().sort((a, b) => {
      for (const criterion of sortConfig) {
        let result = 0;

        if (criterion.key === 'name') {
          result = a.name.localeCompare(b.name);
        } else if (criterion.key === 'last_updated') {
          const dateA = new Date(a.last_updated || 0).getTime();
          const dateB = new Date(b.last_updated || 0).getTime();
          result = dateA - dateB;
        } else if (criterion.key === 'verification_status') {
          const pctA = (a.total_segments || 0) > 0 ? (a.verified_segment_count || 0) / a.total_segments! : 0;
          const pctB = (b.total_segments || 0) > 0 ? (b.verified_segment_count || 0) / b.total_segments! : 0;
          result = pctA - pctB;
        } else if (criterion.key === 'distance_verified') {
          const distA = (a.verified_segment_count || 0) * 10;
          const distB = (b.verified_segment_count || 0) * 10;
          result = distA - distB;
        } else if (criterion.key === 'autocode_status') {
          const pctA = (a.total_segments || 0) > 0 ? (a.autocoded_segment_count || 0) / a.total_segments! : 0;
          const pctB = (b.total_segments || 0) > 0 ? (b.autocoded_segment_count || 0) / b.total_segments! : 0;
          result = pctA - pctB;
        }

        if (result !== 0) {
          return criterion.direction === 'asc' ? result : -result;
        }
      }
      return 0;
    });
  }, [Projectlist, sortConfig]);

  // Get all unique tags across all projects
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    projects.forEach(p => {
      p.tags?.forEach(tag => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [projects]);

  // for Filters
  const filtered = useMemo(() => {
    let list = projects;

    if (nameQuery.trim()) {
      list = list.filter((p) => matchesProjectSearch(p, nameQuery));
    }

    // Filter by selected tags - project must have ALL selected tags
    if (tagFilters.length > 0) {
      list = list.filter((p) =>
        tagFilters.every(selectedTag => p.tags?.includes(selectedTag))
      );
    }

    return list;
  }, [projects, nameQuery, tagFilters]);
  const filteredTagOptions = useMemo(
    () => allTags.filter(tag =>
      tag.toLowerCase().includes(tagInputValue.toLowerCase()) &&
      !tagFilters.includes(tag)
    ),
    [allTags, tagFilters, tagInputValue]
  );
  const showCreateProjectPrompt = !loadingProjects && filtered.length === 0 && nameQuery.trim().length > 0;
  const hasActiveFilters = nameQuery.trim().length > 0 || tagFilters.length > 0;

  const moveLegacyProjects = async () => {
    try {
      setMigratingLegacyProjects(true);
      const result = await migrateLegacyProjects();
      await loadProjects();
      toaster.create({
        title: "Shared projects moved",
        description: result.moved.length > 0
          ? `${result.moved.length} project${result.moved.length === 1 ? "" : "s"} moved into ${activeProfile?.name ?? "the active profile"}.`
          : "No shared projects were moved.",
        type: "success",
      });
    } catch (nextError) {
      toaster.create({
        title: "Move failed",
        description: nextError instanceof Error ? nextError.message : "Failed to move shared projects.",
        type: "error",
      });
    } finally {
      setMigratingLegacyProjects(false);
    }
  };

  const addTagFilter = (tag: string) => {
    if (!tag || tagFilters.includes(tag)) {
      setTagInputValue("");
      setTagSuggestionsOpen(true);
      return;
    }

    setTagFilters((current) => [...current, tag]);
    setTagInputValue("");
    setTagSuggestionsOpen(true);
  };

  const clearAllFilters = () => {
    setNameQuery("");
    setTagFilters([]);
    setTagInputValue("");
    setTagSuggestionsOpen(false);
  };

  // Toggle project selection
  const onRowClick = (name: string) => {
    setSelected(prev => {
      const newSet = new Set(prev);
      if (newSet.has(name)) {
        newSet.delete(name);
      } else {
        newSet.add(name);
      }
      return newSet;
    });
  };

  // Toggle select all projects
  const toggleSelectAll = () => {
    if (selected.size === filtered.length && filtered.length > 0) {
      // All are selected, deselect all
      setSelected(new Set());
    } else {
      // Select all
      setSelected(new Set(filtered.map(p => p.name)));
    }
  };

  // Load selected projects
  const loadProject = async () => {
    if (selected.size === 0) return;
    // Convert set to array and encode as query params
    const projectNames = Array.from(selected);
    const encodedNames = projectNames.map(name => encodeURIComponent(name));
    navigate(`/coding/${encodedNames.join(',')}`);
  };

  // Load treatment application for selected projects
  const loadTreatment = async () => {
    if (selected.size === 0) return;
    // Pass all selected projects as comma-separated encoded names
    const projectNames = Array.from(selected);
    const encodedNames = projectNames.map(name => encodeURIComponent(name));
    navigate(`/treatment/${encodedNames.join(',')}`);
  };

  // Load path analysis for selected projects
  const loadPathAnalysis = () => {
    if (selected.size === 0) return;
    const projectNames = Array.from(selected);
    sessionStorage.setItem("pathAnalysis_selectedProjects", JSON.stringify(projectNames));
    sessionStorage.setItem("pathAnalysis_loadedProjects", JSON.stringify(projectNames));
    navigate("/analysis/path");
  };

  // Edit success callback
  const handleEditSuccess = (newName: string, newTags: string[]) => {
    if (!editingProject) return;

    const oldName = editingProject.name;

    // Update local list
    setProjectList((prev) => {
      if (!prev) return prev;
      return {
        projects: prev.projects.map((p) =>
          p.name === oldName ? { name: newName, tags: newTags } : p
        ),
      };
    });

    // If edited project is currently selected and name changed, update selection
    if (selected.has(oldName) && newName !== oldName) {
      setSelected(prev => {
        const newSet = new Set(prev);
        newSet.delete(oldName);
        newSet.add(newName);
        return newSet;
      });
    }
  };

  // Open delete confirmation dialog for first selected project
  const askDelete = () => {
    if (selected.size === 0) return;
    setOpenDelete(true);
  };

  // Delete selected projects
  const confirmDelete = async () => {
    if (selected.size === 0) return;
    try {
      setDeleting(true);
      // Delete all selected projects
      await Promise.all(Array.from(selected).map(name => apiDeleteProject(name)));
      // Remove from local list
      setProjectList((prev) =>
        prev
          ? { projects: prev.projects.filter((p) => !selected.has(p.name)) }
          : prev
      );
      setSelected(new Set());
      setOpenDelete(false);
    } catch (e: any) {
    } finally {
      setDeleting(false);
    }
  };

  // Profiles a project can be shared into (everyone except the active profile)
  const shareTargets = useMemo(
    () => profiles.filter((p) => p.id !== activeProfile?.id),
    [profiles, activeProfile],
  );

  // Open share dialog for selected projects
  const askShare = () => {
    if (selected.size === 0) return;
    setShareTargetId(shareTargets[0]?.id ?? "");
    setOpenShare(true);
  };

  // Share selected projects into the chosen profile
  const confirmShare = async () => {
    if (selected.size === 0 || !shareTargetId) return;
    try {
      setSharing(true);
      const result = await apiShareProjects(shareTargetId, Array.from(selected));
      const targetName = shareTargets.find((p) => p.id === shareTargetId)?.name ?? "the selected profile";
      const skippedNote = result.skipped.length > 0
        ? ` ${result.skipped.length} already existed there and ${result.skipped.length === 1 ? "was" : "were"} skipped.`
        : "";
      toaster.create({
        title: result.shared.length > 0 ? "Projects shared" : "Nothing shared",
        description: result.shared.length > 0
          ? `${result.shared.length} project${result.shared.length === 1 ? "" : "s"} shared to ${targetName}.${skippedNote}`
          : `No projects were shared to ${targetName}.${skippedNote}`,
        type: result.shared.length > 0 ? "success" : "info",
      });
      setOpenShare(false);
      setSelected(new Set());
    } catch (nextError) {
      toaster.create({
        title: "Share failed",
        description: nextError instanceof Error ? nextError.message : "Failed to share projects.",
        type: "error",
      });
    } finally {
      setSharing(false);
    }
  };

  // Remove tag from filter
  const removeTagFilter = (tagToRemove: string) => {
    setTagFilters(tagFilters.filter(tag => tag !== tagToRemove));
  };


  // Handle column header click for sorting
  const handleSort = (key: string, event: React.MouseEvent) => {
    setSortConfig(current => {
      const isShift = event.shiftKey;
      const existingIndex = current.findIndex(c => c.key === key);

      // If user holds Shift, we are doing multi-column sort
      if (isShift) {
        // If sorting by this key already exists
        if (existingIndex !== -1) {
          // Toggle direction
          const newConfig = [...current];
          newConfig[existingIndex] = {
            ...newConfig[existingIndex],
            direction: newConfig[existingIndex].direction === 'asc' ? 'desc' : 'asc'
          };
          return newConfig;
        } else {
          // Add new sort criterion to the end
          return [...current, { key, direction: 'desc' }];
        }
      } else {
        // Single column sort (replace everything)
        // If clicking the same column that is currently primary, toggle it
        if (current.length > 0 && current[0].key === key) {
          return [{ key, direction: current[0].direction === 'asc' ? 'desc' : 'asc' }];
        }
        // Otherwise start fresh with this column descending
        return [{ key, direction: 'desc' }];
      }
    });
  };

  // Helper to get sort status for a column
  const getSortMeta = (key: string) => {
    const index = sortConfig.findIndex(c => c.key === key);
    if (index === -1) return null;
    return {
      direction: sortConfig[index].direction,
      priority: index + 1 // 1-based priority
    };
  };

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
      {activeProfile && legacyProjects.length > 0 && (
        <div className="profile-migration-banner">
          <div>
            <div className="profile-migration-title">Shared projects are still outside this profile</div>
            <div className="profile-migration-copy">
              {legacyProjects.length} existing project{legacyProjects.length === 1 ? " is" : "s are"} still in the shared project area.
              Move them into {activeProfile.name} so they appear in this profile's project list.
            </div>
          </div>
          <Button
            colorPalette="teal"
            variant="solid"
            loading={migratingLegacyProjects}
            onClick={() => void moveLegacyProjects()}
          >
            Move Shared Projects
          </Button>
        </div>
      )}

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
            <Button onClick={() => createProject(navigate)} colorPalette="black" variant="solid">
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
              disabled={!selected || selected.size === 0 || shareTargets.length === 0}
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
                          onClick={() => createProject(navigate)}
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

      {/* 编辑 Dialog */}
      {editingProject && (
        <EditProjectModal
          open={openEdit}
          onClose={() => setOpenEdit(false)}
          projectName={editingProject.name}
          projectTags={editingProject.tags}
          onSuccess={handleEditSuccess}
        />
      )}

      {/* Delete confirmation Dialog */}
      <Dialog.Root open={openDelete} onOpenChange={(d) => setOpenDelete(d.open)} unmountOnExit>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content>
              <Dialog.Header>
                <Dialog.Title>Delete {selected.size} project(s)?</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                This will permanently remove the following projects and their files:
                <ul style={{ marginTop: "12px", paddingLeft: "20px" }}>
                  {Array.from(selected).map(name => (
                    <li key={name}><strong>{name}</strong></li>
                  ))}
                </ul>
              </Dialog.Body>
              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" disabled={deleting}>
                    Cancel
                  </Button>
                </Dialog.ActionTrigger>
                <Button
                  colorPalette="red"
                  onClick={confirmDelete}
                  loading={deleting}
                >
                  Delete
                </Button>
              </Dialog.Footer>

              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      {/* Share to profile Dialog */}
      <Dialog.Root open={openShare} onOpenChange={(d) => setOpenShare(d.open)} unmountOnExit>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content>
              <Dialog.Header>
                <Dialog.Title>Share {selected.size} project(s)</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <div>Send a copy of the following projects to another profile:</div>
                <ul style={{ margin: "12px 0", paddingLeft: "20px" }}>
                  {Array.from(selected).map((name) => (
                    <li key={name}><strong>{name}</strong></li>
                  ))}
                </ul>
                <label htmlFor="shareTargetProfile" style={{ display: "block", fontWeight: 600, marginBottom: "6px" }}>
                  Share to profile
                </label>
                <select
                  id="shareTargetProfile"
                  value={shareTargetId}
                  onChange={(e) => setShareTargetId(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "8px",
                    border: "1px solid var(--chakra-colors-border)",
                    background: "var(--chakra-colors-bg)",
                    color: "var(--chakra-colors-fg)",
                  }}
                >
                  {shareTargets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Dialog.Body>
              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" disabled={sharing}>
                    Cancel
                  </Button>
                </Dialog.ActionTrigger>
                <Button
                  colorPalette="teal"
                  onClick={confirmShare}
                  loading={sharing}
                  disabled={!shareTargetId}
                >
                  Share
                </Button>
              </Dialog.Footer>

              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </div>
  );
}