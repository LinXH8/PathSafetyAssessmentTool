import ConfirmDialogV2 from "../../../components/common/ConfirmDialogV2";

interface ExitConfirmationDialogProps {
  open: boolean;
  onSaveAndExit: () => void;
  onDiscardAndExit: () => void;
  onCancel: () => void;
  isSaving?: boolean;
  /** What is being exited — used in the title, e.g. "Coding Page". */
  context?: string;
}

/**
 * "You have unsaved changes" save/discard/cancel prompt. Now rendered with the
 * shared v2 confirm popup (ConfirmDialogV2) so it matches the rest of the v2 UI
 * and sidesteps the Chakra Dialog pointer-events freeze (see CLAUDE.md).
 */
export default function ExitConfirmationDialog({
  open,
  onSaveAndExit,
  onDiscardAndExit,
  onCancel,
  isSaving = false,
  context = "Coding Page",
}: ExitConfirmationDialogProps) {
  return (
    <ConfirmDialogV2
      open={open}
      title={`Exit ${context}`}
      message={
        <>
          <strong style={{ display: "block", marginBottom: 6, color: "#2D3748" }}>
            Do you want to save your changes before exiting?
          </strong>
          If you exit without saving, any unsaved changes to this project will be lost.
        </>
      }
      confirmLabel="Save"
      busyLabel="Saving…"
      tertiaryLabel="Discard"
      cancelLabel="Cancel"
      loading={isSaving}
      onConfirm={onSaveAndExit}
      onTertiary={onDiscardAndExit}
      onCancel={onCancel}
    />
  );
}
