import { useEffect, useState } from "react";
import {
  listGeneratedReports,
  deleteGeneratedReport,
  type GeneratedReportInfo,
} from "../../api";
import { useUiVersion } from "../../features/ui/useUiVersion";
import type { GeneratedReportsViewModel } from "./layouts/GeneratedReportsViewModel";
import GeneratedReportsLayoutV1 from "./layouts/GeneratedReportsLayoutV1";
import GeneratedReportsLayoutV2 from "./layouts/GeneratedReportsLayoutV2";

/**
 * Generated Reports page — container only (container/shell architecture, see
 * temp/UI_V2_REDESIGN_GUIDE.md §3). Owns all state/fetching/handlers, assembles
 * a `GeneratedReportsViewModel`, and renders the v1 (verbatim) or v2 (redesigned)
 * shell by `useUiVersion()`.
 */
export default function GeneratedReportsPage() {
  const [reports, setReports] = useState<GeneratedReportInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<GeneratedReportInfo | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editingReport, setEditingReport] = useState<GeneratedReportInfo | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");

  const ui = useUiVersion();

  const loadReports = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await listGeneratedReports();
      setReports(data);
    } catch (err: any) {
      setError(err.message || "Failed to load reports");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, []);

  const handleDeleteClick = (name: string) => {
    setConfirmDelete(name);
    setActionError(null);
  };

  const handleCancelDelete = () => {
    setConfirmDelete(null);
    setActionError(null);
  };

  const handleConfirmDelete = async (name: string) => {
    try {
      setActionLoading(true);
      setActionError(null);
      await deleteGeneratedReport(name);
      if (selected?.name === name) setSelected(null);
      setConfirmDelete(null);
      await loadReports();
    } catch (err: any) {
      setActionError(err.message || "Delete failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDownload = (name: string) => {
    const a = document.createElement("a");
    a.href = `/api/generated-reports/${encodeURIComponent(name)}`;
    a.download = name;
    a.click();
  };

  // After a successful rename: close the modal, keep the (possibly-selected)
  // report pointed at its new name, and reload the list.
  const handleRenamed = (oldName: string, newName: string) => {
    setEditingReport(null);
    setSelected((prev) => (prev && prev.name === oldName ? { ...prev, name: newName } : prev));
    loadReports();
  };

  const filtered = reports.filter((r) =>
    r.name.toLowerCase().includes(filterText.toLowerCase())
  );

  const previewUrl = selected
    ? `/api/generated-reports/${encodeURIComponent(selected.name)}`
    : null;

  const vm: GeneratedReportsViewModel = {
    reports,
    filtered,
    loading,
    error,
    onReload: loadReports,

    filterText,
    setFilterText,

    selected,
    onSelect: setSelected,
    previewUrl,

    onDownload: handleDownload,

    editingReport,
    onEditClick: setEditingReport,
    onCloseEdit: () => setEditingReport(null),
    onRenamed: handleRenamed,

    confirmDelete,
    onDeleteClick: handleDeleteClick,
    onCancelDelete: handleCancelDelete,
    onConfirmDelete: handleConfirmDelete,

    actionLoading,
    actionError,
    onClearActionError: () => setActionError(null),
  };

  return ui === "v2" ? <GeneratedReportsLayoutV2 {...vm} /> : <GeneratedReportsLayoutV1 {...vm} />;
}
