import EditProjectModal from "../components/EditProjectModal";
import ConfirmDialogV2 from "../../../components/common/ConfirmDialogV2";
import ShareProjectModalV2 from "../components/ShareProjectModalV2";
import type { ProjectsViewModel } from "./ProjectsViewModel";

/**
 * Edit / Delete / Share dialogs for the Projects page. Shared by both layout
 * shells so the dialog markup has a single owner. Pure function of the vm.
 */
export default function ProjectsDialogs(vm: ProjectsViewModel) {
  const {
    editingProject,
    openEdit,
    setOpenEdit,
    handleEditSuccess,
    selected,
    openDelete,
    setOpenDelete,
    deleting,
    confirmDelete,
    openShare,
    setOpenShare,
    sharing,
    exporting,
    confirmShare,
    confirmExport,
    shareTargets,
  } = vm;

  return (
    <>
      {/* Edit project dialog */}
      {editingProject && (
        <EditProjectModal
          open={openEdit}
          onClose={() => setOpenEdit(false)}
          projectName={editingProject.name}
          projectTags={editingProject.tags}
          onSuccess={handleEditSuccess}
        />
      )}

      {/* Delete confirmation — shared v2 confirm popup (danger tone). */}
      <ConfirmDialogV2
        open={openDelete}
        title={`Delete ${selected.size} project${selected.size === 1 ? "" : "s"}?`}
        tone="danger"
        message={
          <>
            This will permanently remove the following project{selected.size === 1 ? "" : "s"} and their files:
            <ul style={{ marginTop: 12, paddingLeft: 20 }}>
              {Array.from(selected).map((name) => (
                <li key={name}><strong style={{ color: "#2D3748" }}>{name}</strong></li>
              ))}
            </ul>
          </>
        }
        confirmLabel="Delete"
        busyLabel="Deleting…"
        cancelLabel="Cancel"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setOpenDelete(false)}
      />

      {/* Share to profile / Export — v2 modal. */}
      <ShareProjectModalV2
        open={openShare}
        onClose={() => setOpenShare(false)}
        projectNames={Array.from(selected)}
        shareTargets={shareTargets}
        busy={sharing || exporting}
        onShare={confirmShare}
        onExport={confirmExport}
      />
    </>
  );
}
