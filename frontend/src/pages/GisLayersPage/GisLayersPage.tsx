import { useEffect, useState, useMemo, useRef } from "react";
import { listShapefiles, deleteShapefile, renameShapefile, revertShapefile, type ShapefileInfo } from "../../api";
import { useUiVersion } from "../../features/ui/useUiVersion";
import { INITIAL_CENTER, parseMapFeatures, type FilterMode } from "./gisLayersConstants";
import type { GisLayersViewModel } from "./layouts/GisLayersViewModel";
import GisLayersLayoutV1 from "./layouts/GisLayersLayoutV1";
import GisLayersLayoutV2 from "./layouts/GisLayersLayoutV2";

/**
 * GIS Layers page — container only (container/shell architecture, see
 * temp/UI_V2_REDESIGN_GUIDE.md §3). Owns all state/fetching/handlers, assembles
 * a `GisLayersViewModel`, and renders the v1 (verbatim) or v2 (redesigned) shell
 * by `useUiVersion()`.
 */
export default function GisLayersPage() {
  const [shapefiles, setShapefiles] = useState<ShapefileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Map state
  const [selectedLayer, setSelectedLayer] = useState<ShapefileInfo | null>(null);
  const [geojsonData, setGeojsonData] = useState<any | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const [shapefileModalOpen, setShapefileModalOpen] = useState(false);
  const [editingParamsFile, setEditingParamsFile] = useState<ShapefileInfo | null>(null);

  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);
  const [confirmRevertPath, setConfirmRevertPath] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [filterText, setFilterText] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hoveredFilter, setHoveredFilter] = useState<FilterMode | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  const initialCenter = useRef<[number, number]>(INITIAL_CENTER);
  const ui = useUiVersion();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const loadLayers = async () => {
    try {
      setLoading(true);
      const data = await listShapefiles();
      const sortedData = data.sort((a, b) => a.name.localeCompare(b.name));
      setShapefiles(sortedData);
      setError(null);
    } catch (err: any) {
      console.error("Failed to load shapefiles", err);
      setError(err.message || "Failed to load shapefiles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLayers();
  }, []);

  const handleStartEdit = (file: ShapefileInfo) => {
    setEditingPath(file.path);
    setEditName(file.name);
    setConfirmDeletePath(null);
    setConfirmRevertPath(null);
    setActionError(null);
  };

  const handleCancelEdit = () => {
    setEditingPath(null);
    setEditName("");
    setActionError(null);
  };

  const handleSaveEdit = async (file: ShapefileInfo) => {
    if (!editName.trim()) {
      handleCancelEdit();
      return;
    }
    try {
      setActionLoading(true);
      setActionError(null);
      await renameShapefile(file.path, editName.trim());
      setEditingPath(null);
      setEditName("");
      await loadLayers();
    } catch (err: any) {
      setActionError(err.message || "Rename failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteClick = (file: ShapefileInfo) => {
    setConfirmDeletePath(file.path);
    setEditingPath(null);
    setEditName("");
    setConfirmRevertPath(null);
    setActionError(null);
  };

  const handleRevertClick = (file: ShapefileInfo) => {
    setConfirmRevertPath(file.path);
    setEditingPath(null);
    setEditName("");
    setConfirmDeletePath(null);
    setActionError(null);
  };

  const handleCancelRevert = () => {
    setConfirmRevertPath(null);
    setActionError(null);
  };

  const handleConfirmRevert = async (file: ShapefileInfo) => {
    try {
      setActionLoading(true);
      setActionError(null);
      await revertShapefile(file.path);
      setConfirmRevertPath(null);
      if (selectedLayer?.path === file.path) setSelectedLayer(null);
      await loadLayers();
    } catch (err: any) {
      setActionError(err.message || "Revert failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelDelete = () => {
    setConfirmDeletePath(null);
    setActionError(null);
  };

  const handleConfirmDelete = async (file: ShapefileInfo) => {
    try {
      setActionLoading(true);
      setActionError(null);
      await deleteShapefile(file.path);
      setConfirmDeletePath(null);
      if (selectedLayer?.path === file.path) setSelectedLayer(null);
      await loadLayers();
    } catch (err: any) {
      setActionError(err.message || "Delete failed");
    } finally {
      setActionLoading(false);
    }
  };

  // Fetch GeoJSON when a layer is selected
  useEffect(() => {
    if (!selectedLayer) {
      setGeojsonData(null);
      return;
    }

    let aborted = false;
    async function loadGeoJson() {
      try {
        setMapLoading(true);
        setMapError(null);

        const res = await fetch("/api/shapefiles/geojson", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: selectedLayer!.path,
            max_features: 10000,
          }),
        });

        if (!res.ok) {
          throw new Error(await res.text().catch(() => "Failed to load map data"));
        }

        const data = await res.json();
        if (data.error) throw new Error(data.error);

        if (!aborted) {
          setGeojsonData(data);
        }
      } catch (err: any) {
        console.error("Error loading geojson:", err);
        if (!aborted) setMapError(err.message || "Failed to parse shapefile geometry");
      } finally {
        if (!aborted) setMapLoading(false);
      }
    }

    loadGeoJson();
    return () => { aborted = true; };
  }, [selectedLayer]);

  const mapFeatures = useMemo(() => parseMapFeatures(geojsonData), [geojsonData]);

  const vm: GisLayersViewModel = {
    shapefiles,
    loading,
    error,
    onReload: loadLayers,

    filterMode,
    setFilterMode,
    filterText,
    setFilterText,
    dropdownOpen,
    setDropdownOpen,
    hoveredFilter,
    setHoveredFilter,
    tooltipPos,
    setTooltipPos,
    filterDropdownRef,

    selectedLayer,
    onSelectLayer: setSelectedLayer,
    mapLoading,
    mapError,
    mapFeatures,
    initialCenter: initialCenter.current,

    editingPath,
    editName,
    setEditName,
    onStartEdit: handleStartEdit,
    onCancelEdit: handleCancelEdit,
    onSaveEdit: handleSaveEdit,

    confirmDeletePath,
    onDeleteClick: handleDeleteClick,
    onCancelDelete: handleCancelDelete,
    onConfirmDelete: handleConfirmDelete,

    confirmRevertPath,
    onRevertClick: handleRevertClick,
    onCancelRevert: handleCancelRevert,
    onConfirmRevert: handleConfirmRevert,

    actionLoading,
    actionError,
    onClearActionError: () => setActionError(null),

    shapefileModalOpen,
    onOpenUpdateModal: () => setShapefileModalOpen(true),
    onCloseUpdateModal: () => {
      setShapefileModalOpen(false);
      loadLayers();
    },
    editingParamsFile,
    onEditParams: setEditingParamsFile,
    onCloseParams: () => setEditingParamsFile(null),
    onParamsSaved: () => {
      setEditingParamsFile(null);
      loadLayers();
    },
  };

  return ui === "v2" ? <GisLayersLayoutV2 {...vm} /> : <GisLayersLayoutV1 {...vm} />;
}
