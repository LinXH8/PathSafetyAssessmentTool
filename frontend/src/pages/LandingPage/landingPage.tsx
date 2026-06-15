import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, CloseButton, Dialog, Portal } from "@chakra-ui/react";
import "./landingPage.css";

import psatLogo2 from "./assets/PSAT Logo (Black).png";
import cyclerapLogo from "./assets/CycleRAP-logo.png";
import { APP_META } from "../../appMeta";
import { toaster } from "../../components/ui/toaster";
import { useProfile } from "../../features/profile/ProfileProvider";

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
    updateProfile,
    deleteProfile,
  } = useProfile();
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [loginPin, setLoginPin] = useState("");
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileDivision, setNewProfileDivision] = useState("");
  const [newProfilePin, setNewProfilePin] = useState("");
  const [manageProfileName, setManageProfileName] = useState("");
  const [manageProfileDivision, setManageProfileDivision] = useState("");
  const [manageCurrentPin, setManageCurrentPin] = useState("");
  const [manageNewPin, setManageNewPin] = useState("");
  const [busyAction, setBusyAction] = useState<"login" | "create" | "update" | "reset-pin" | "delete" | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePin, setDeletePin] = useState("");

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
    ? `START AS ${selectedProfile.name}`
    : profiles.length === 0
      ? "CREATE FIRST PROFILE"
      : "SELECT A PROFILE";

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
    setNewProfileName("");
    setNewProfileDivision("");
    setNewProfilePin("");
  };

  const resetManageDialog = () => {
    setManageDialogOpen(false);
    setManageProfileName("");
    setManageProfileDivision("");
    setManageCurrentPin("");
    setManageNewPin("");
  };

  const openManageDialog = () => {
    if (!selectedProfile) {
      toaster.create({ description: "Select a profile first.", type: "warning" });
      return;
    }
    setManageProfileName(selectedProfile.name);
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
        description: `${selectedProfile.name} has been deleted.`,
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
        description: `Logged in as ${selectedProfile.name}.`,
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
      const created = await createProfile(newProfileName, newProfilePin, newProfileDivision);
      await login(created.profile.id, newProfilePin);
      setSelectedProfileId(created.profile.id);
      setCreateDialogOpen(false);
      setNewProfileName("");
      setNewProfileDivision("");
      setNewProfilePin("");
      toaster.create({
        title: "Profile created",
        description: `${created.profile.name} is ready to use.`,
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
      const result = await updateProfile(
        selectedProfile.id,
        manageCurrentPin,
        manageProfileName,
        manageProfileDivision,
      );
      setSelectedProfileId(result.profile.id);
      resetManageDialog();
      toaster.create({
        title: "Profile updated",
        description: `${result.profile.name} has been updated.`,
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
        description: `PIN updated for ${result.profile.name}.`,
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
      {/* 右侧品牌区：logo + 文字 */}
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

        <p className="psat-logo description">an evidence-based risk evaluation model for active mobility users</p>

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
              >
                Create Profile
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
                          <span className="profile-option-name">{profile.name}</span>
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

      <Dialog.Root open={pinDialogOpen} onOpenChange={(details) => !details.open && closePinDialog()} size="sm" unmountOnExit>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content>
              <Dialog.Header>
                <Dialog.Title>Enter PIN</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <div className="landing-dialog-copy">
                  Enter the PIN for <strong>{selectedProfile?.name ?? "the selected profile"}</strong> to continue.
                </div>
                <div className="landing-dialog-form">
                  <input
                    id="profilePin"
                    className="landing-dialog-input"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={loginPin}
                    onChange={(event) => setLoginPin(event.target.value)}
                    placeholder="PIN"
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleLogin();
                      }
                    }}
                  />
                </div>
              </Dialog.Body>

              <Dialog.Footer>
                <Button variant="outline" onClick={closePinDialog} disabled={busyAction === "login"}>
                  Cancel
                </Button>
                <Button
                  colorPalette="green"
                  onClick={() => void handleLogin()}
                  loading={busyAction === "login"}
                  disabled={loginPin.trim().length === 0 || busyAction === "login"}
                >
                  {busyAction === "login" ? "Starting..." : `Start As ${selectedProfile?.name ?? "Profile"}`}
                </Button>
              </Dialog.Footer>

              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      <Dialog.Root open={createDialogOpen} onOpenChange={(details) => !details.open && closeCreateDialog()} size="sm" unmountOnExit>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content>
              <Dialog.Header>
                <Dialog.Title>Create Profile</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <div className="landing-dialog-copy">
                  Create a local profile for this device. The profile name stays readable, while the PIN is stored in obfuscated form.
                </div>
                <div className="landing-dialog-form">
                  <input
                    id="newProfileName"
                    className="landing-dialog-input"
                    type="text"
                    value={newProfileName}
                    onChange={(event) => setNewProfileName(event.target.value)}
                    placeholder="LTA Employee Email"
                    autoFocus
                  />
                  <input
                    id="newProfileDivision"
                    className="landing-dialog-input"
                    type="text"
                    value={newProfileDivision}
                    onChange={(event) => setNewProfileDivision(event.target.value)}
                    placeholder="Division"
                  />
                  <input
                    id="newProfilePin"
                    className="landing-dialog-input"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={newProfilePin}
                    onChange={(event) => setNewProfilePin(event.target.value)}
                    placeholder="4 to 12 digit PIN"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleCreate();
                      }
                    }}
                  />
                </div>
              </Dialog.Body>

              <Dialog.Footer>
                <Button variant="outline" onClick={closeCreateDialog} disabled={busyAction === "create"}>
                  Cancel
                </Button>
                <Button
                  colorPalette="green"
                  onClick={() => void handleCreate()}
                  loading={busyAction === "create"}
                  disabled={busyAction === "create" || newProfileName.trim().length === 0 || newProfileDivision.trim().length === 0 || newProfilePin.trim().length === 0}
                >
                  {busyAction === "create" ? "Creating..." : "Create Profile"}
                </Button>
              </Dialog.Footer>

              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      <Dialog.Root open={manageDialogOpen} onOpenChange={(details) => !details.open && closeManageDialog()} size="lg" unmountOnExit>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content>
              <Dialog.Header>
                <Dialog.Title>Manage Profile</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <div className="landing-dialog-copy">
                  Update the selected profile details or rotate the PIN. The current PIN is required for both actions.
                </div>
                <div className="landing-dialog-status">Last active: {selectedProfileLastActive}</div>
                <div className="landing-dialog-form">
                  <div className="landing-dialog-section">
                    <div className="landing-dialog-section-title">Profile details</div>
                    <input
                      id="manageProfileName"
                      className="landing-dialog-input"
                      type="text"
                      value={manageProfileName}
                      onChange={(event) => setManageProfileName(event.target.value)}
                      placeholder="LTA Employee Email"
                      autoFocus
                    />
                    <input
                      id="manageProfileDivision"
                      className="landing-dialog-input"
                      type="text"
                      value={manageProfileDivision}
                      onChange={(event) => setManageProfileDivision(event.target.value)}
                      placeholder="Division"
                    />
                  </div>
                  <div className="landing-dialog-section">
                    <div className="landing-dialog-section-title">PIN confirmation</div>
                    <input
                      id="manageCurrentPin"
                      className="landing-dialog-input"
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={manageCurrentPin}
                      onChange={(event) => setManageCurrentPin(event.target.value)}
                      placeholder="Current PIN"
                    />
                    <input
                      id="manageNewPin"
                      className="landing-dialog-input"
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={manageNewPin}
                      onChange={(event) => setManageNewPin(event.target.value)}
                      placeholder="New 4 to 12 digit PIN"
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && manageNewPin.trim().length > 0) {
                          event.preventDefault();
                          void handleResetPin();
                        }
                      }}
                    />
                  </div>
                </div>
              </Dialog.Body>

              <Dialog.Footer className="landing-dialog-actions">
                <Button variant="outline" onClick={closeManageDialog} disabled={busyAction === "update" || busyAction === "reset-pin"}>
                  Cancel
                </Button>
                <Button
                  colorPalette="red"
                  variant="outline"
                  onClick={openDeleteDialog}
                  disabled={busyAction === "update" || busyAction === "reset-pin"}
                >
                  Delete Profile
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void handleUpdateProfile()}
                  loading={busyAction === "update"}
                  disabled={
                    busyAction === "update"
                    || busyAction === "reset-pin"
                    || manageProfileName.trim().length === 0
                    || manageProfileDivision.trim().length === 0
                    || manageCurrentPin.trim().length === 0
                  }
                >
                  {busyAction === "update" ? "Saving..." : "Save Details"}
                </Button>
                <Button
                  colorPalette="green"
                  onClick={() => void handleResetPin()}
                  loading={busyAction === "reset-pin"}
                  disabled={
                    busyAction === "update"
                    || busyAction === "reset-pin"
                    || manageCurrentPin.trim().length === 0
                    || manageNewPin.trim().length === 0
                  }
                >
                  {busyAction === "reset-pin" ? "Updating..." : "Reset PIN"}
                </Button>
              </Dialog.Footer>

              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>


      <Dialog.Root open={deleteDialogOpen} onOpenChange={(details) => !details.open && closeDeleteDialog()} size="sm" unmountOnExit>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content>
              <Dialog.Header>
                <Dialog.Title>Delete Profile</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <div className="landing-dialog-copy">
                  This will permanently delete <strong>{selectedProfile?.name ?? "this profile"}</strong> and all its
                  data. This action cannot be undone. Enter the profile PIN to confirm.
                </div>
                <div className="landing-dialog-form">
                  <input
                    id="deletePin"
                    className="landing-dialog-input"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={deletePin}
                    onChange={(event) => setDeletePin(event.target.value)}
                    placeholder="PIN"
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && deletePin.trim().length > 0) {
                        event.preventDefault();
                        void handleDeleteProfile();
                      }
                    }}
                  />
                </div>
              </Dialog.Body>

              <Dialog.Footer>
                <Button variant="outline" onClick={closeDeleteDialog} disabled={busyAction === "delete"}>
                  Cancel
                </Button>
                <Button
                  colorPalette="red"
                  onClick={() => void handleDeleteProfile()}
                  loading={busyAction === "delete"}
                  disabled={deletePin.trim().length === 0 || busyAction === "delete"}
                >
                  {busyAction === "delete" ? "Deleting..." : "Delete Profile"}
                </Button>
              </Dialog.Footer>

              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

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
