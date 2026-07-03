import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  listSourceFolders,
  createProjectFromFolder,
  fetchProjectList,
  fetchSourceFolderPreview,
  fetchSourceFolderSummaries,
  type SourceFolderPreview,
  type SourceFolderSummary,
  type ProjectSelectionGeometry,
} from "../../api";
import { type SelectedRoad } from "./SelectRoadsMap";
import { loadFolderSummaryCache, saveFolderSummaries } from "./folderSummaryCache";
import { useUiVersion } from "../../features/ui/useUiVersion";
import CreateProjectLayoutV1 from "./layouts/CreateProjectLayoutV1";
import CreateProjectLayoutV2 from "./layouts/CreateProjectLayoutV2";
import type { CreateProjectViewModel } from "./layouts/CreateProjectViewModel";

export default function CreateProjectPage() {
  const nav = useNavigate();
  const [folders, setFolders] = useState<string[]>([]);
  const [existingTags, setExistingTags] = useState<string[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  // v2 folder table is multi-select (the v1 combobox uses the single `folder` above).
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [folderComboboxOpen, setFolderComboboxOpen] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tagSuggestionsOpen, setTagSuggestionsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [imageUploadModalOpen, setImageUploadModalOpen] = useState(false);
  const [roadAvailabilityVersion, setRoadAvailabilityVersion] = useState(0);
  const [folderPreview, setFolderPreview] = useState<SourceFolderPreview | null>(null);
  const [loadingFolderPreview, setLoadingFolderPreview] = useState(false);
  const [folderPreviewError, setFolderPreviewError] = useState<string | null>(null);
  const [selectedRoads, setSelectedRoads] = useState<SelectedRoad[]>([]);
  const [selectedSelectionGeometry, setSelectedSelectionGeometry] = useState<ProjectSelectionGeometry | null>(null);
  // Auto-loaded per-folder stats for the v2 folder table (segments/quarter/etc).
  // Seeded from the persistent localStorage cache so previously-resolved rows
  // render instantly on a fresh page load instead of re-fetching every time.
  const [folderSummaries, setFolderSummaries] = useState<Record<string, SourceFolderSummary>>(() => loadFolderSummaryCache());
  const [loadingFolderSummaries, setLoadingFolderSummaries] = useState(false);
  // How many existing projects were created from each source folder.
  const [folderProjectCounts, setFolderProjectCounts] = useState<Record<string, number>>({});

  const selectedRoadFolders = useMemo(
    () => selectedRoads.filter((road) => road.selected),
    [selectedRoads]
  );
  const unavailableSelectedRoads = useMemo(
    () => selectedRoadFolders.filter((road) => !road.exists),
    [selectedRoadFolders]
  );
  const usingRoadSelection = selectedRoadFolders.length > 0;
  const selectedFolderExists = useMemo(
    () => folders.includes(folder.trim()),
    [folder, folders]
  );

  const loadFolders = async (ctrl?: AbortController) => {
    try {
      setLoadingFolders(true);
      setErr(null);
      const [foldersData, projectsData] = await Promise.all([
        listSourceFolders({ signal: ctrl?.signal }),
        fetchProjectList()
      ]);
      setFolders(foldersData);

      // Extract all unique tags from existing projects
      const tagSet = new Set<string>();
      const projectCounts: Record<string, number> = {};
      projectsData.projects.forEach(p => {
        p.tags?.forEach(tag => tagSet.add(tag));
        (p.source_folders ?? []).forEach((sf) => {
          projectCounts[sf] = (projectCounts[sf] ?? 0) + 1;
        });
      });
      setExistingTags(Array.from(tagSet).sort());
      setFolderProjectCounts(projectCounts);
    } catch (e: any) {
      if (e?.name !== "AbortError") setErr(e?.message ?? "Failed to load folders");
    } finally {
      setLoadingFolders(false);
    }
  };

  useEffect(() => {
    const ctrl = new AbortController();
    loadFolders(ctrl);
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    if (!selectedFolderExists) {
      setFolderPreview(null);
      setFolderPreviewError(null);
      setLoadingFolderPreview(false);
      return;
    }

    const ctrl = new AbortController();
    setLoadingFolderPreview(true);
    setFolderPreviewError(null);

    fetchSourceFolderPreview(folder.trim(), { signal: ctrl.signal })
      .then((preview) => {
        setFolderPreview(preview);

        if (preview.folder_name !== folder.trim()) {
          setFolders((currentFolders) => {
            const nextFolders = currentFolders.filter((item) => item !== folder.trim());
            if (!nextFolders.includes(preview.folder_name)) {
              nextFolders.push(preview.folder_name);
            }
            return nextFolders.sort((left, right) => left.localeCompare(right));
          });
          setFolder(preview.folder_name);
          setFolderComboboxOpen(false);
          void loadFolders();
        }
      })
      .catch((error: any) => {
        if (error?.name !== "AbortError") {
          setFolderPreview(null);
          setFolderPreviewError(error?.message ?? "Failed to load folder preview");
        }
      })
      .finally(() => setLoadingFolderPreview(false));

    return () => ctrl.abort();
  }, [folder, roadAvailabilityVersion, selectedFolderExists]);

  // Auto-populate the folder table with per-folder stats. Two-phase for speed:
  //   1. one cheap cache-only bulk request fills every already-computed folder;
  //   2. uncached folders are filled progressively via the single-folder preview
  //      endpoint, capped at a small concurrency so hundreds of new folders never
  //      hammer the backend or block the UI.
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();

    (async () => {
      setLoadingFolderSummaries(true);
      let summaries: SourceFolderSummary[] = [];
      try {
        summaries = await fetchSourceFolderSummaries({ signal: ctrl.signal });
      } catch (e: any) {
        if (cancelled || e?.name === "AbortError") return;
        setLoadingFolderSummaries(false);
        return;
      }
      if (cancelled) return;

      // Merge the bulk result over the persistent cache: keep previously-resolved
      // rows (so they don't flash back to spinners) and overlay any fresher
      // backend-cached stats.
      const persisted = loadFolderSummaryCache();
      setFolderSummaries(() => {
        const next: Record<string, SourceFolderSummary> = { ...persisted };
        summaries.forEach((s) => {
          const prev = next[s.folder_name];
          // Don't let an unresolved bulk stub overwrite a resolved cached row.
          next[s.folder_name] = s.cached || !prev?.cached ? { ...prev, ...s } : prev;
        });
        return next;
      });
      saveFolderSummaries(Object.fromEntries(summaries.filter((s) => s.cached).map((s) => [s.folder_name, s])));

      // Progressively resolve the uncached folders with bounded concurrency,
      // skipping any already resolved in the persistent cache (they won't fetch
      // again on subsequent visits).
      const pending = summaries
        .filter((s) => !s.cached && !persisted[s.folder_name]?.cached)
        .map((s) => s.folder_name);
      if (pending.length === 0) {
        if (!cancelled) setLoadingFolderSummaries(false);
        return;
      }

      const CONCURRENCY = 3;
      let cursor = 0;
      const worker = async () => {
        while (!cancelled) {
          const index = cursor++;
          if (index >= pending.length) break;
          const folderName = pending[index];
          try {
            const preview = await fetchSourceFolderPreview(folderName, { signal: ctrl.signal, skipRename: true });
            if (cancelled) break;
            // The preview may rename the folder (quarter suffix) — key by both.
            const resolved = { ...preview, cached: true } as SourceFolderSummary;
            setFolderSummaries((prev) => ({
              ...prev,
              [folderName]: { ...(prev[folderName] ?? {} as SourceFolderSummary), ...resolved },
              [preview.folder_name]: { ...(prev[preview.folder_name] ?? {} as SourceFolderSummary), ...resolved },
            }));
            // Persist so this folder isn't re-fetched on the next visit.
            saveFolderSummaries({ [folderName]: resolved, [preview.folder_name]: resolved });
          } catch (e: any) {
            if (e?.name === "AbortError") break;
            // Leave the row as an unresolved stub; a manual select can retry.
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
      if (!cancelled) setLoadingFolderSummaries(false);
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [roadAvailabilityVersion]);

  const handleRoadSelectionChange = useCallback((roads: SelectedRoad[]) => {
    setSelectedRoads(roads);
  }, []);

  const handleSelectionGeometryChange = useCallback((selectionGeometry: ProjectSelectionGeometry | null) => {
    setSelectedSelectionGeometry(selectionGeometry);
  }, []);

  const commitTag = useCallback((rawTag: string) => {
    const trimmedTag = rawTag.trim();
    if (trimmedTag) {
      setTags((current) => current.includes(trimmedTag) ? current : [...current, trimmedTag]);
    }
    setTagInput("");
    setTagSuggestionsOpen(true);
  }, []);

  const filteredTagSuggestions = useMemo(() => {
    const query = tagInput.trim().toLowerCase();
    return existingTags.filter((tag) =>
      !tags.includes(tag) && (!query || tag.toLowerCase().includes(query))
    );
  }, [existingTags, tagInput, tags]);

  const canCreate = useMemo(() => {
    if (!name.trim()) return false;
    if (name.includes("_")) return false;
    if (usingRoadSelection) {
      return unavailableSelectedRoads.length === 0;
    }
    if (selectedFolders.length > 0) return true; // v2 multi-folder selection
    if (!folder) return false;
    return true;
  }, [name, folder, selectedFolders.length, unavailableSelectedRoads.length, usingRoadSelection]);

  const handleTagInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "," || e.key === "Enter") {
      e.preventDefault();
      commitTag(tagInput);
    } else if (e.key === "Backspace" && tagInput === "" && tags.length > 0) {
      // Remove last tag on backspace if input is empty
      setTags(tags.slice(0, -1));
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const onCreate = async () => {
    if (!canCreate) return;
    try {
      setCreating(true);
      setErr(null);
      const sourceSelection = usingRoadSelection
        ? selectedRoadFolders.map((road) => road.name)
        : selectedFolders.length > 0
          ? selectedFolders
          : folder;
      const data = await createProjectFromFolder(
        name.trim(),
        sourceSelection,
        tags,
        usingRoadSelection ? (selectedSelectionGeometry ?? undefined) : undefined
      );
      const proj = data?.name ?? name.trim();
      nav(`/coding/${encodeURIComponent(proj)}`);
    } catch (e: any) {
      setErr(e?.message ?? "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const onCancel = () => nav(-1);

  const onImageUploadSuccess = useCallback(({ folderName }: { folderName: string }) => {
    setFolder(folderName);
    setFolderComboboxOpen(false);
    setRoadAvailabilityVersion((version) => version + 1);
    loadFolders();
  }, []);

  // ── Assemble the view-model: the single typed seam both shells consume. ──
  const vm: CreateProjectViewModel = {
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
    folder,
    setFolder,
    selectedFolders,
    setSelectedFolders,
    folderComboboxOpen,
    setFolderComboboxOpen,
    loadingFolders,
    selectedFolderExists,
    folderPreview,
    loadingFolderPreview,
    folderPreviewError,
    folderSummaries,
    loadingFolderSummaries,
    folderProjectCounts,
    usingRoadSelection,
    selectedRoadFolders,
    unavailableSelectedRoads,
    roadAvailabilityVersion,
    onRoadSelectionChange: handleRoadSelectionChange,
    onSelectionGeometryChange: handleSelectionGeometryChange,
    err,
    canCreate,
    creating,
    onCreate,
    onCancel,
    imageUploadModalOpen,
    openImageUploadModal: () => setImageUploadModalOpen(true),
    closeImageUploadModal: () => setImageUploadModalOpen(false),
    onImageUploadSuccess,
  };

  const ui = useUiVersion();

  // Keep the ?ui flag visible in the URL on /projects/create so devs always see
  // (and remember) the v1/v2 toggle. Mirrors the Projects pilot.
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

  return ui === "v2" ? <CreateProjectLayoutV2 {...vm} /> : <CreateProjectLayoutV1 {...vm} />;
}
