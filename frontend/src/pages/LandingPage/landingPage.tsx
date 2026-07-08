import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./landingPage.css";

import psatLogo2 from "./assets/PSAT Logo (Black).png";
import cyclerapLogo from "./assets/CycleRAP-logo.png";
import { APP_META } from "../../appMeta";
import { toaster } from "../../components/ui/toaster";
import { useProfile } from "../../features/profile/ProfileProvider";
import { FONT, COLOR } from "../../features/ui/designTokens";
import LandingModal, {
  modalCopyStyle,
  modalLabelStyle,
  modalInputStyle,
  modalSectionTitleStyle,
  ghostBtnStyle,
  primaryBtnStyle,
  dangerBtnStyle,
  dangerGhostBtnStyle,
} from "./LandingModal";

export default function LandingPage() {
  const navigate = useNavigate();
  const {
    profiles,
    activeProfile,
    loading,
    error,
    createProfile,
    login,
    resetProfilePin,
    recoverProfilePin,
    updateProfile,
    deleteProfile,
  } = useProfile();
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [loginPin, setLoginPin] = useState("");
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [newProfileUsername, setNewProfileUsername] = useState("");
  const [newProfileEmail, setNewProfileEmail] = useState("");
  const [newProfileDivision, setNewProfileDivision] = useState("");
  const [newProfilePin, setNewProfilePin] = useState("");
  const [manageProfileUsername, setManageProfileUsername] = useState("");
  const [manageProfileEmail, setManageProfileEmail] = useState("");
  const [manageProfileDivision, setManageProfileDivision] = useState("");
  const [manageCurrentPin, setManageCurrentPin] = useState("");
  const [manageNewPin, setManageNewPin] = useState("");
  const [busyAction, setBusyAction] = useState<"login" | "create" | "update" | "reset-pin" | "recover" | "delete" | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePin, setDeletePin] = useState("");
  const [recoverDialogOpen, setRecoverDialogOpen] = useState(false);
  const [recoverEmail, setRecoverEmail] = useState("");
  const [recoverNewPin, setRecoverNewPin] = useState("");

  useEffect(() => {
    if (selectedProfileId && profiles.some((profile) => profile.id === selectedProfileId)) {
      return;
    }
    if (activeProfile && profiles.some((profile) => profile.id === activeProfile.id)) {
      setSelectedProfileId(activeProfile.id);
      return;
    }
    if (profiles.length > 0) {
      setSelectedProfileId(profiles[0].id);
      return;
    }
    setSelectedProfileId(null);
  }, [activeProfile, profiles, selectedProfileId]);

  useEffect(() => {
    setLoginPin("");
  }, [selectedProfileId]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  const selectedProfileLabel = selectedProfile?.username || selectedProfile?.name || "";

  const selectedProfileLastActive = useMemo(() => {
    if (!selectedProfile?.last_active_at) {
      return "No activity recorded yet.";
    }
    const parsed = new Date(selectedProfile.last_active_at);
    return Number.isNaN(parsed.getTime()) ? selectedProfile.last_active_at : parsed.toLocaleString();
  }, [selectedProfile]);

  const canOpenFirstProfileSetup = profiles.length === 0 && busyAction === null && !loading;
  const canManageSelectedProfile = Boolean(selectedProfile && busyAction === null && !loading);
  const canUseStartButton = Boolean((selectedProfile || canOpenFirstProfileSetup) && busyAction === null && !loading);
  const startButtonLabel = selectedProfile
    ? `Start as ${selectedProfileLabel}`
    : profiles.length === 0
      ? "Create First Profile"
      : "Select a Profile";

  const openPinDialog = () => {
    setLoginPin("");
    setPinDialogOpen(true);
  };

  const closePinDialog = () => {
    setPinDialogOpen(false);
    setLoginPin("");
  };

  const openCreateDialog = () => {
    setCreateDialogOpen(true);
  };

  const closeCreateDialog = () => {
    if (busyAction === "create") {
      return;
    }
    setCreateDialogOpen(false);
    setNewProfileUsername("");
    setNewProfileEmail("");
    setNewProfileDivision("");
    setNewProfilePin("");
  };

  const resetManageDialog = () => {
    setManageDialogOpen(false);
    setManageProfileUsername("");
    setManageProfileEmail("");
    setManageProfileDivision("");
    setManageCurrentPin("");
    setManageNewPin("");
  };

  const openManageDialog = () => {
    if (!selectedProfile) {
      toaster.create({ description: "Select a profile first.", type: "warning" });
      return;
    }
    setManageProfileUsername(selectedProfile.username || selectedProfile.name);
    // The recovery email is private and never returned by the API; leave the
    // field blank so the user can optionally set a new one.
    setManageProfileEmail("");
    setManageProfileDivision(selectedProfile.division);
    setManageCurrentPin("");
    setManageNewPin("");
    setManageDialogOpen(true);
  };

  const closeManageDialog = () => {
    if (busyAction === "update" || busyAction === "reset-pin" || busyAction === "delete") {
      return;
    }
    resetManageDialog();
  };

  const openDeleteDialog = () => {
    if (!selectedProfile) {
      toaster.create({ description: "Select a profile first.", type: "warning" });
      return;
    }
    setDeletePin("");
    setDeleteDialogOpen(true);
  };

  const closeDeleteDialog = () => {
    if (busyAction === "delete") return;
    setDeleteDialogOpen(false);
    setDeletePin("");
  };

  const openRecoverDialog = () => {
    if (!selectedProfile) {
      toaster.create({ description: "Select a profile first.", type: "warning" });
      return;
    }
    if (!selectedProfile.has_email) {
      toaster.create({
        description: "This profile has no recovery email on file. Reset the PIN from Manage Selected instead.",
        type: "warning",
      });
      return;
    }
    setRecoverEmail("");
    setRecoverNewPin("");
    setPinDialogOpen(false);
    setRecoverDialogOpen(true);
  };

  const closeRecoverDialog = () => {
    if (busyAction === "recover") return;
    setRecoverDialogOpen(false);
    setRecoverEmail("");
    setRecoverNewPin("");
  };

  const handleRecoverPin = async () => {
    if (!selectedProfile) {
      toaster.create({ description: "Select a profile first.", type: "warning" });
      return;
    }
    try {
      setBusyAction("recover");
      await recoverProfilePin(selectedProfile.id, recoverEmail, recoverNewPin);
      closeRecoverDialog();
      toaster.create({
        title: "PIN reset",
        description: `PIN updated for ${selectedProfileLabel}. You can now start with your new PIN.`,
        type: "success",
      });
    } catch (nextError) {
      toaster.create({
        title: "PIN recovery failed",
        description: nextError instanceof Error ? nextError.message : "Failed to verify the recovery email.",
        type: "error",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteProfile = async () => {
    if (!selectedProfile) return;
    try {
      setBusyAction("delete");
      await deleteProfile(selectedProfile.id, deletePin);
      setDeleteDialogOpen(false);
      setDeletePin("");
      resetManageDialog();
      toaster.create({
        title: "Profile deleted",
        description: `${selectedProfileLabel} has been deleted.`,
        type: "success",
      });
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

  const startPSAT = () => {
    if (canOpenFirstProfileSetup) {
      openCreateDialog();
      return;
    }

    if (selectedProfile && busyAction === null) {
      openPinDialog();
    }
  };

  const handleLogin = async () => {
    if (!selectedProfile) {
      toaster.create({ description: "Select a profile first.", type: "warning" });
      return;
    }
    try {
      setBusyAction("login");
      await login(selectedProfile.id, loginPin);
      closePinDialog();
      toaster.create({
        title: "Profile ready",
        description: `Logged in as ${selectedProfileLabel}.`,
        type: "success",
      });
      navigate("/home");
    } catch (nextError) {
      toaster.create({
        title: "Login failed",
        description: nextError instanceof Error ? nextError.message : "Failed to log in.",
        type: "error",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreate = async () => {
    try {
      setBusyAction("create");
      const created = await createProfile(newProfileUsername, newProfileEmail, newProfilePin, newProfileDivision);
      await login(created.profile.id, newProfilePin);
      setSelectedProfileId(created.profile.id);
      setCreateDialogOpen(false);
      setNewProfileUsername("");
      setNewProfileEmail("");
      setNewProfileDivision("");
      setNewProfilePin("");
      toaster.create({
        title: "Profile created",
        description: `${created.profile.username || created.profile.name} is ready to use.`,
        type: "success",
      });
    } catch (nextError) {
      toaster.create({
        title: "Profile setup failed",
        description: nextError instanceof Error ? nextError.message : "Failed to create the profile.",
        type: "error",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleUpdateProfile = async () => {
    if (!selectedProfile) {
      toaster.create({ description: "Select a profile first.", type: "warning" });
      return;
    }
    try {
      setBusyAction("update");
      const trimmedEmail = manageProfileEmail.trim();
      const result = await updateProfile(
        selectedProfile.id,
        manageCurrentPin,
        manageProfileUsername,
        manageProfileDivision,
        // Only send email when the user typed one (otherwise leave it untouched).
        trimmedEmail.length > 0 ? trimmedEmail : undefined,
      );
      setSelectedProfileId(result.profile.id);
      resetManageDialog();
      toaster.create({
        title: "Profile updated",
        description: `${result.profile.username || result.profile.name} has been updated.`,
        type: "success",
      });
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
    if (!selectedProfile) {
      toaster.create({ description: "Select a profile first.", type: "warning" });
      return;
    }
    try {
      setBusyAction("reset-pin");
      const result = await resetProfilePin(selectedProfile.id, manageCurrentPin, manageNewPin);
      setSelectedProfileId(result.profile.id);
      resetManageDialog();
      toaster.create({
        title: "PIN updated",
        description: `PIN updated for ${result.profile.username || result.profile.name}.`,
        type: "success",
      });
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

  return (
    <main className="landing-root" role="main">
      {/* Right rail: brand logo and tagline */}
      <aside className="right-rail" aria-label="PSAT branding">
        <img
          src={psatLogo2}
          alt="PSAT logo"
          className="psat-logo"
          loading="eager"
          decoding="async"
          draggable={false}
        />

        <h1 className="psat-logo name">path safety assessment tool</h1>

        <section className="profile-panel" aria-label="Profile access">
          <div className="profile-panel-header">
            <div className="profile-panel-copy">
              <h2>Profiles</h2>
              <p>Select a local profile on this device, then start the app.</p>
            </div>

            <div className="profile-panel-actions">
              <button
                type="button"
                className="profile-manage-btn"
                onClick={openManageDialog}
                disabled={!canManageSelectedProfile}
              >
                Manage Selected
              </button>
              <button
                type="button"
                className="profile-create-btn"
                onClick={openCreateDialog}
                disabled={busyAction !== null}
                aria-label="Create Profile"
                title="Create Profile"
              >
                +
              </button>
            </div>
          </div>

          {loading ? (
            <div className="profile-status">Loading profiles...</div>
          ) : (
            <>
              {error && <div className="profile-error">{error}</div>}

              <div className="profile-scroll-shell">
                {profiles.length > 0 ? (
                  <div className="profile-list">
                    {profiles.map((profile) => {
                      const isSelected = profile.id === selectedProfileId;
                      const isActive = profile.id === activeProfile?.id;
                      return (
                        <button
                          key={profile.id}
                          type="button"
                          className={`profile-option${isSelected ? " is-selected" : ""}${isActive ? " is-active" : ""}`}
                          onClick={() => setSelectedProfileId(profile.id)}
                        >
                          <span className="profile-option-name">{profile.username || profile.name}</span>
                          <span className="profile-option-meta">
                            {profile.division} • {" "}
                            {profile.project_count} project{profile.project_count === 1 ? "" : "s"}
                            {isActive ? " • current" : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="profile-empty">No profiles yet. Create one to begin.</div>
                )}
              </div>
            </>
          )}
        </section>

        <button
          type="button"
          className="start-btn"
          onClick={startPSAT}
          aria-label="Start PSAT"
          disabled={!canUseStartButton}
        >
          {startButtonLabel}
        </button>
      </aside>

      {/* Enter PIN */}
      <LandingModal
        open={pinDialogOpen}
        title="Enter PIN"
        onClose={closePinDialog}
        busy={busyAction === "login"}
        footer={
          <>
            <button
              type="button"
              onClick={closePinDialog}
              disabled={busyAction === "login"}
              style={ghostBtnStyle(busyAction === "login")}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleLogin()}
              disabled={loginPin.trim().length === 0 || busyAction === "login"}
              style={primaryBtnStyle(loginPin.trim().length === 0 || busyAction === "login")}
            >
              {busyAction === "login" ? "Starting…" : `Start As ${selectedProfileLabel || "Profile"}`}
            </button>
          </>
        }
      >
        <p style={modalCopyStyle}>
          Enter the PIN for <strong style={{ color: COLOR.text }}>{selectedProfileLabel || "the selected profile"}</strong> to continue.
        </p>
        <input
          id="profilePin"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          value={loginPin}
          onChange={(event) => setLoginPin(event.target.value)}
          placeholder="PIN"
          autoFocus
          style={modalInputStyle}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleLogin();
            }
          }}
        />
        {selectedProfile?.has_email && (
          <button
            type="button"
            className="landing-dialog-link"
            onClick={openRecoverDialog}
            disabled={busyAction === "login"}
          >
            Forgot PIN?
          </button>
        )}
      </LandingModal>

      {/* Create Profile */}
      <LandingModal
        open={createDialogOpen}
        title="Create Profile"
        onClose={closeCreateDialog}
        busy={busyAction === "create"}
        footer={
          <>
            <button
              type="button"
              onClick={closeCreateDialog}
              disabled={busyAction === "create"}
              style={ghostBtnStyle(busyAction === "create")}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={
                busyAction === "create"
                || newProfileUsername.trim().length === 0
                || newProfileEmail.trim().length === 0
                || newProfileDivision.trim().length === 0
                || newProfilePin.trim().length === 0
              }
              style={primaryBtnStyle(
                busyAction === "create"
                || newProfileUsername.trim().length === 0
                || newProfileEmail.trim().length === 0
                || newProfileDivision.trim().length === 0
                || newProfilePin.trim().length === 0
              )}
            >
              {busyAction === "create" ? "Creating…" : "Create Profile"}
            </button>
          </>
        }
      >
        <p style={modalCopyStyle}>
          Create a local profile for this device. Your username is the display name shown here, while your
          email stays private and is only used to reset a forgotten PIN. The PIN is stored in obfuscated form.
        </p>
        <input
          id="newProfileUsername"
          type="text"
          value={newProfileUsername}
          onChange={(event) => setNewProfileUsername(event.target.value)}
          placeholder="Username"
          autoFocus
          style={modalInputStyle}
        />
        <input
          id="newProfileEmail"
          type="email"
          value={newProfileEmail}
          onChange={(event) => setNewProfileEmail(event.target.value)}
          placeholder="LTA Employee Email (private, for PIN recovery)"
          style={modalInputStyle}
        />
        <input
          id="newProfileDivision"
          type="text"
          value={newProfileDivision}
          onChange={(event) => setNewProfileDivision(event.target.value)}
          placeholder="Division"
          style={modalInputStyle}
        />
        <input
          id="newProfilePin"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          value={newProfilePin}
          onChange={(event) => setNewProfilePin(event.target.value)}
          placeholder="4 to 12 digit PIN"
          style={modalInputStyle}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleCreate();
            }
          }}
        />
      </LandingModal>

      {/* Manage Profile */}
      <LandingModal
        open={manageDialogOpen}
        title="Manage Profile"
        onClose={closeManageDialog}
        busy={busyAction === "update" || busyAction === "reset-pin" || busyAction === "delete"}
        width={560}
        footer={
          <>
            <button
              type="button"
              onClick={closeManageDialog}
              disabled={busyAction === "update" || busyAction === "reset-pin"}
              style={ghostBtnStyle(busyAction === "update" || busyAction === "reset-pin")}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={openDeleteDialog}
              disabled={busyAction === "update" || busyAction === "reset-pin"}
              style={dangerGhostBtnStyle(busyAction === "update" || busyAction === "reset-pin")}
            >
              Delete Profile
            </button>
            <button
              type="button"
              onClick={() => void handleUpdateProfile()}
              disabled={
                busyAction === "update"
                || busyAction === "reset-pin"
                || manageProfileUsername.trim().length === 0
                || manageProfileDivision.trim().length === 0
                || manageCurrentPin.trim().length === 0
              }
              style={ghostBtnStyle(
                busyAction === "update"
                || busyAction === "reset-pin"
                || manageProfileUsername.trim().length === 0
                || manageProfileDivision.trim().length === 0
                || manageCurrentPin.trim().length === 0
              )}
            >
              {busyAction === "update" ? "Saving…" : "Save Details"}
            </button>
            <button
              type="button"
              onClick={() => void handleResetPin()}
              disabled={
                busyAction === "update"
                || busyAction === "reset-pin"
                || manageCurrentPin.trim().length === 0
                || manageNewPin.trim().length === 0
              }
              style={primaryBtnStyle(
                busyAction === "update"
                || busyAction === "reset-pin"
                || manageCurrentPin.trim().length === 0
                || manageNewPin.trim().length === 0
              )}
            >
              {busyAction === "reset-pin" ? "Updating…" : "Reset PIN"}
            </button>
          </>
        }
      >
        <p style={modalCopyStyle}>
          Update the selected profile details or rotate the PIN. The current PIN is required for both actions.
          Leave the recovery email blank to keep the current one.
        </p>
        <p style={{ fontFamily: FONT, fontSize: 12, lineHeight: 1.45, color: COLOR.gray500, margin: 0 }}>
          Last active: {selectedProfileLastActive}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={modalSectionTitleStyle}>Profile details</div>
          <input
            id="manageProfileUsername"
            type="text"
            value={manageProfileUsername}
            onChange={(event) => setManageProfileUsername(event.target.value)}
            placeholder="Username"
            autoFocus
            style={modalInputStyle}
          />
          <input
            id="manageProfileEmail"
            type="email"
            value={manageProfileEmail}
            onChange={(event) => setManageProfileEmail(event.target.value)}
            placeholder={selectedProfile?.has_email ? "New recovery email (leave blank to keep current)" : "Recovery email (private, for PIN recovery)"}
            style={modalInputStyle}
          />
          <input
            id="manageProfileDivision"
            type="text"
            value={manageProfileDivision}
            onChange={(event) => setManageProfileDivision(event.target.value)}
            placeholder="Division"
            style={modalInputStyle}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={modalSectionTitleStyle}>PIN confirmation</div>
          <input
            id="manageCurrentPin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            value={manageCurrentPin}
            onChange={(event) => setManageCurrentPin(event.target.value)}
            placeholder="Current PIN"
            style={modalInputStyle}
          />
          <input
            id="manageNewPin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            value={manageNewPin}
            onChange={(event) => setManageNewPin(event.target.value)}
            placeholder="New 4 to 12 digit PIN"
            style={modalInputStyle}
            onKeyDown={(event) => {
              if (event.key === "Enter" && manageNewPin.trim().length > 0) {
                event.preventDefault();
                void handleResetPin();
              }
            }}
          />
        </div>
      </LandingModal>

      {/* Delete Profile */}
      <LandingModal
        open={deleteDialogOpen}
        title="Delete Profile"
        onClose={closeDeleteDialog}
        busy={busyAction === "delete"}
        footer={
          <>
            <button
              type="button"
              onClick={closeDeleteDialog}
              disabled={busyAction === "delete"}
              style={ghostBtnStyle(busyAction === "delete")}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleDeleteProfile()}
              disabled={deletePin.trim().length === 0 || busyAction === "delete"}
              style={dangerBtnStyle(deletePin.trim().length === 0 || busyAction === "delete")}
            >
              {busyAction === "delete" ? "Deleting…" : "Delete Profile"}
            </button>
          </>
        }
      >
        <p style={modalCopyStyle}>
          This will permanently delete <strong style={{ color: COLOR.text }}>{selectedProfileLabel || "this profile"}</strong> and all its
          data. This action cannot be undone. Enter the profile PIN to confirm.
        </p>
        <input
          id="deletePin"
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
              void handleDeleteProfile();
            }
          }}
        />
      </LandingModal>

      {/* Reset Forgotten PIN */}
      <LandingModal
        open={recoverDialogOpen}
        title="Reset Forgotten PIN"
        onClose={closeRecoverDialog}
        busy={busyAction === "recover"}
        footer={
          <>
            <button
              type="button"
              onClick={closeRecoverDialog}
              disabled={busyAction === "recover"}
              style={ghostBtnStyle(busyAction === "recover")}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleRecoverPin()}
              disabled={recoverEmail.trim().length === 0 || recoverNewPin.trim().length === 0 || busyAction === "recover"}
              style={primaryBtnStyle(recoverEmail.trim().length === 0 || recoverNewPin.trim().length === 0 || busyAction === "recover")}
            >
              {busyAction === "recover" ? "Resetting…" : "Reset PIN"}
            </button>
          </>
        }
      >
        <p style={modalCopyStyle}>
          Verify your identity for <strong style={{ color: COLOR.text }}>{selectedProfileLabel || "the selected profile"}</strong> by entering
          the private recovery email on file, then choose a new PIN.
        </p>
        <input
          id="recoverEmail"
          type="email"
          value={recoverEmail}
          onChange={(event) => setRecoverEmail(event.target.value)}
          placeholder="Recovery email"
          autoFocus
          style={modalInputStyle}
        />
        <input
          id="recoverNewPin"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          value={recoverNewPin}
          onChange={(event) => setRecoverNewPin(event.target.value)}
          placeholder="New 4 to 12 digit PIN"
          style={modalInputStyle}
          onKeyDown={(event) => {
            if (event.key === "Enter" && recoverEmail.trim().length > 0 && recoverNewPin.trim().length > 0) {
              event.preventDefault();
              void handleRecoverPin();
            }
          }}
        />
      </LandingModal>

      <footer className="landing-footer">
        <span className="version-info">v{APP_META.version} ({APP_META.buildDate})</span>
        <img
          src={cyclerapLogo}
          alt="CycleRAP logo"
          className="cyclerap-logo-bottom"
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      </footer>
    </main>
  );
}
