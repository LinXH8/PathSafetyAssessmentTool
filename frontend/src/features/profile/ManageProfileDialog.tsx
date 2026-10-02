import { useEffect, useState } from "react";

import { toaster } from "../../components/ui/toaster";
import LandingModal, {
  modalCopyStyle,
  modalInputStyle,
  modalSectionTitleStyle,
  ghostBtnStyle,
  primaryBtnStyle,
  dangerBtnStyle,
  dangerGhostBtnStyle,
} from "../../pages/LandingPage/LandingModal";
import { COLOR } from "../ui/designTokens";
import { useProfile } from "./ProfileProvider";

/**
 * "My Account": edit, re-PIN or delete the profile that is logged in, from
 * inside the app (opened from the sidebar).
 *
 * On a shared server the landing page lists no personal profiles, so its
 * "Manage Selected" has nothing to select -- this is the only way to manage an
 * account there. The backend only ever lets a session change the profile it is
 * logged in as, and still asks for the current PIN as confirmation.
 */
interface ManageProfileDialogProps {
  open: boolean;
  onClose: () => void;
}

type BusyAction = "update" | "reset-pin" | "delete" | null;

export default function ManageProfileDialog({ open, onClose }: ManageProfileDialogProps) {
  const { activeProfile, updateProfile, resetProfilePin, deleteProfile } = useProfile();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [division, setDivision] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePin, setDeletePin] = useState("");
  const [busyAction, setBusyAction] = useState<BusyAction>(null);

  // Re-seed from the logged-in profile whenever the dialog (re)opens.
  useEffect(() => {
    if (!open || !activeProfile) return;
    setUsername(activeProfile.username || activeProfile.name);
    // The recovery email is private and never returned by the API; leave the
    // field blank so the user can optionally set a new one.
    setEmail("");
    setDivision(activeProfile.division);
    setCurrentPin("");
    setNewPin("");
    setDeleteOpen(false);
    setDeletePin("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!activeProfile) return null;

  const busy = busyAction !== null;
  const label = activeProfile.username || activeProfile.name;
  const canSaveDetails = !busy && username.trim().length > 0 && division.trim().length > 0 && currentPin.trim().length > 0;
  const canResetPin = !busy && currentPin.trim().length > 0 && newPin.trim().length > 0;

  const close = () => {
    if (!busy) onClose();
  };

  const handleUpdate = async () => {
    try {
      setBusyAction("update");
      const trimmedEmail = email.trim();
      const result = await updateProfile(
        activeProfile.id,
        currentPin,
        username,
        division,
        // Only send email when the user typed one (otherwise leave it untouched).
        trimmedEmail.length > 0 ? trimmedEmail : undefined,
      );
      toaster.create({
        title: "Profile updated",
        description: `${result.profile.username || result.profile.name} has been updated.`,
        type: "success",
      });
      onClose();
    } catch (nextError) {
      toaster.create({
        title: "Profile update failed",
        description: nextError instanceof Error ? nextError.message : "Failed to update the profile.",
        type: "error",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleResetPin = async () => {
    try {
      setBusyAction("reset-pin");
      await resetProfilePin(activeProfile.id, currentPin, newPin);
      toaster.create({ title: "PIN updated", description: `PIN updated for ${label}.`, type: "success" });
      onClose();
    } catch (nextError) {
      toaster.create({
        title: "PIN reset failed",
        description: nextError instanceof Error ? nextError.message : "Failed to update the PIN.",
        type: "error",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDelete = async () => {
    try {
      setBusyAction("delete");
      // Deleting the logged-in profile ends the session; RequireProfile then
      // sends the browser back to the landing page.
      await deleteProfile(activeProfile.id, deletePin);
      toaster.create({ title: "Profile deleted", description: `${label} has been deleted.`, type: "success" });
      onClose();
    } catch (nextError) {
      toaster.create({
        title: "Delete failed",
        description: nextError instanceof Error ? nextError.message : "Failed to delete the profile.",
        type: "error",
      });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <>
      <LandingModal
        open={open && !deleteOpen}
        title="My Account"
        onClose={close}
        busy={busy}
        width={560}
        footer={
          <>
            <button type="button" onClick={close} disabled={busy} style={ghostBtnStyle(busy)}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setDeletePin("");
                setDeleteOpen(true);
              }}
              disabled={busy}
              style={dangerGhostBtnStyle(busy)}
            >
              Delete Profile
            </button>
            <button type="button" onClick={() => void handleUpdate()} disabled={!canSaveDetails} style={ghostBtnStyle(!canSaveDetails)}>
              {busyAction === "update" ? "Saving…" : "Save Details"}
            </button>
            <button type="button" onClick={() => void handleResetPin()} disabled={!canResetPin} style={primaryBtnStyle(!canResetPin)}>
              {busyAction === "reset-pin" ? "Updating…" : "Reset PIN"}
            </button>
          </>
        }
      >
        <p style={modalCopyStyle}>
          Update your profile details or change your PIN. The current PIN is required for both actions.
          Leave the recovery email blank to keep the current one.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={modalSectionTitleStyle}>Profile details</div>
          <input
            id="myAccountUsername"
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Username"
            autoFocus
            style={modalInputStyle}
          />
          <input
            id="myAccountEmail"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={activeProfile.has_email ? "New email (leave blank to keep current)" : "Email (used to log in and to recover the PIN)"}
            style={modalInputStyle}
          />
          <input
            id="myAccountDivision"
            type="text"
            value={division}
            onChange={(event) => setDivision(event.target.value)}
            placeholder="Division"
            style={modalInputStyle}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={modalSectionTitleStyle}>PIN confirmation</div>
          <input
            id="myAccountCurrentPin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            value={currentPin}
            onChange={(event) => setCurrentPin(event.target.value)}
            placeholder="Current PIN"
            style={modalInputStyle}
          />
          <input
            id="myAccountNewPin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            value={newPin}
            onChange={(event) => setNewPin(event.target.value)}
            placeholder="New 4 to 12 digit PIN"
            style={modalInputStyle}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canResetPin) {
                event.preventDefault();
                void handleResetPin();
              }
            }}
          />
        </div>
      </LandingModal>

      <LandingModal
        open={open && deleteOpen}
        title="Delete Profile"
        onClose={() => {
          if (!busy) setDeleteOpen(false);
        }}
        busy={busyAction === "delete"}
        footer={
          <>
            <button type="button" onClick={() => setDeleteOpen(false)} disabled={busy} style={ghostBtnStyle(busy)}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deletePin.trim().length === 0 || busy}
              style={dangerBtnStyle(deletePin.trim().length === 0 || busy)}
            >
              {busyAction === "delete" ? "Deleting…" : "Delete Profile"}
            </button>
          </>
        }
      >
        <p style={modalCopyStyle}>
          This will permanently delete <strong style={{ color: COLOR.text }}>{label}</strong> and all its data. This
          action cannot be undone. Enter the profile PIN to confirm.
        </p>
        <input
          id="myAccountDeletePin"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          value={deletePin}
          onChange={(event) => setDeletePin(event.target.value)}
          placeholder="PIN"
          autoFocus
          style={modalInputStyle}
          onKeyDown={(event) => {
            if (event.key === "Enter" && deletePin.trim().length > 0) {
              event.preventDefault();
              void handleDelete();
            }
          }}
        />
      </LandingModal>
    </>
  );
}
