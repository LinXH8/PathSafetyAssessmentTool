import ConfirmDialogV2 from "../../../components/common/ConfirmDialogV2";

interface ResetConfirmationDialogProps {
    open: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    isResetting?: boolean;
}

/**
 * "Reset all treatments" destructive confirm — rendered with the shared v2
 * confirm popup (ConfirmDialogV2, danger tone).
 */
export default function ResetConfirmationDialog({
    open,
    onConfirm,
    onCancel,
    isResetting = false,
}: ResetConfirmationDialogProps) {
    return (
        <ConfirmDialogV2
            open={open}
            title="Reset All Treatments"
            tone="danger"
            message={
                <>
                    <strong style={{ display: "block", marginBottom: 6, color: "#2D3748" }}>
                        Are you sure you want to reset all applied treatments?
                    </strong>
                    This action returns all segments to their original state and cannot be undone.
                </>
            }
            confirmLabel="Yes, Reset All"
            busyLabel="Resetting…"
            cancelLabel="Cancel"
            loading={isResetting}
            onConfirm={onConfirm}
            onCancel={onCancel}
        />
    );
}
