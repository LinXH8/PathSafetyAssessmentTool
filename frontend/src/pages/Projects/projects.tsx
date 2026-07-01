import { useEffect, useMemo, useState } from "react";
import { fetchProjectList, ping, deleteProject as apiDeleteProject, shareProjects as apiShareProjects, type ProjectListItem } from "../../api";
import { invalidateAll } from "../../api/projectDataCache";
import { useProjectSelection } from "../../features/projectSelection";
import { matchesProjectSearch } from "../../utils/projectSearch";
import { useNavigate } from "react-router-dom";
import { toaster } from "../../components/ui/toaster";
import { useProfile } from "../../features/profile/ProfileProvider";
import { useUiVersion } from "../../features/ui/useUiVersion";
import ProjectsLayoutV1 from "./layouts/ProjectsLayoutV1";
import ProjectsLayoutV2 from "./layouts/ProjectsLayoutV2";
import type { ProjectsViewModel, SortCriterion } from "./layouts/ProjectsViewModel";

import "./projects.css";
import "./components/EditProjectModal.css";

const createProject = (navigate: any) => {
  navigate(`/projects/create`);
};

interface FileListResponse {
  projects: ProjectListItem[];
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
  const [sortConfig, setSortConfig] = useState<SortCriterion[]>([
    { key: 'last_updated', direction: 'desc' }, // Default to newest first
  ]);

  // Filter
  const [nameQuery, setNameQuery] = useState("");
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [tagInputValue, setTagInputValue] = useState("");
  const [tagSuggestionsOpen, setTagSuggestionsOpen] = useState(false);

  // Selected Projects (multiple selection). Backed by the shared selection
  // store so the v2 sidebar Quick Select mirrors — and persists — the same set.
  const [selected, setSelected] = useProjectSelection();

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
    // Clear any stale Path Analysis filter context so direct loads show
    // normal risk-band colors instead of leftover filter colors.
    navigate(`/coding/${encodedNames.join(',')}`, { state: { filterContext: null } });
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
    // Deliberate "start over" reset point: loading a project set into Path
    // Analysis always fetches fresh data, never the cached session data, and
    // re-fits the map to the new set rather than restoring the old viewport.
    invalidateAll();
    sessionStorage.removeItem("pathAnalysisMap_viewport");
    navigate("/analysis/path");
  };

  // Edit success callback (v1 single-project edit). Spread the existing project
  // so metric/date fields survive the update — losing last_updated used to punt
  // the edited row to the bottom of the default (last_updated desc) sort, which
  // read as the row "disappearing".
  const handleEditSuccess = (newName: string, newTags: string[]) => {
    if (!editingProject) return;
    applyEditUpdates([{ oldName: editingProject.name, newName, tags: newTags }]);
  };

  // Edit success callback (v2 multi-project edit). Applies one or many project
  // updates in a single pass, preserving every other field on each row and
  // remapping the selection for any renamed project.
  const applyEditUpdates = (
    updates: Array<{ oldName: string; newName: string; tags: string[] }>
  ) => {
    if (updates.length === 0) return;
    const byOldName = new Map(updates.map((u) => [u.oldName, u]));

    setProjectList((prev) => {
      if (!prev) return prev;
      return {
        projects: prev.projects.map((p) => {
          const u = byOldName.get(p.name);
          return u ? { ...p, name: u.newName, tags: u.tags } : p;
        }),
      };
    });

    // Remap selection for any renamed project so the edited rows stay selected.
    setSelected((prev) => {
      let changed = false;
      const next = new Set(prev);
      updates.forEach((u) => {
        if (u.newName !== u.oldName && next.has(u.oldName)) {
          next.delete(u.oldName);
          next.add(u.newName);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
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

  // Wrap the module-level create navigation so shells get a zero-arg handler.
  const onCreateProject = () => createProject(navigate);

  // ── Assemble the view-model: the single typed seam both shells consume. ──
  const vm: ProjectsViewModel = {
    activeProfile,
    legacyProjects,
    migratingLegacyProjects,
    moveLegacyProjects,
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
    shareTargets,
    sortConfig,
    getSortMeta,
    handleSort,
    editingProject,
    setEditingProject,
    openEdit,
    setOpenEdit,
    handleEditSuccess,
    applyEditUpdates,
    selectedProjects: projects.filter((p) => selected.has(p.name)),
    openDelete,
    setOpenDelete,
    deleting,
    confirmDelete,
    openShare,
    setOpenShare,
    sharing,
    shareTargetId,
    setShareTargetId,
    confirmShare,
  };

  const ui = useUiVersion();

  // Keep the ?ui flag visible in the URL on /home so devs always see (and
  // remember) the v1/v2 toggle. Appends the *resolved* version when absent, so
  // a fresh visit shows ?ui=v1 while a persisted ?ui=v2 choice is respected.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get("ui")) {
      params.set("ui", ui);
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}?${params.toString()}${window.location.hash}`
      );
    }
  }, [ui]);

  return ui === "v2" ? <ProjectsLayoutV2 {...vm} /> : <ProjectsLayoutV1 {...vm} />;
}
