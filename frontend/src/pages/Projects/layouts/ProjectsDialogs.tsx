import { Button, Dialog, Portal, CloseButton } from "@chakra-ui/react";
import EditProjectModal from "../components/EditProjectModal";
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
    shareTargetId,
    setShareTargetId,
    confirmShare,
    shareTargets,
  } = vm;

  return (
    <>
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
    </>
  );
}
