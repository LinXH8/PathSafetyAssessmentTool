import { useLocation, useNavigate, useMatch } from "react-router-dom";
import { Box, Button, Separator, Text } from "@chakra-ui/react";
import { Tooltip } from "../../components/ui/tooltip";
import { useMemo, useCallback, useState } from "react";
import { toaster } from "../../components/ui/toaster";
import { applyAllTreatments, resetAllTreatments, saveTreatments } from "../../api";
import { useProfile } from "../../features/profile/ProfileProvider";

import CodingSidebar from "./components/CodingSidebar";
import TreatmentSidebar from "./components/TreatmentSidebar";
import ResetConfirmationDialog from "./components/ResetConfirmationDialog";
import ExitConfirmationDialog from "./components/ExitConfirmationDialog";
import psatLogo from "../LandingPage/assets/PSAT Logo (Black).png";
import "./sidebar.css";

const LINKS = [
  { to: "/home", label: "Projects" },
];


export default function Sidebar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { activeProfile, logout } = useProfile();
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [treatmentExitDialogOpen, setTreatmentExitDialogOpen] = useState(false);
  const hasSavedReport = useMemo(() => { try { return !!localStorage.getItem("psat_report_layout"); } catch { return false; } }, []);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Get the project name
  const codingMatch = useMatch("/coding/:projectName");
  const treatmentMatch = useMatch("/treatment/:projectName");
  const rawProjectName = codingMatch?.params.projectName ?? treatmentMatch?.params.projectName ?? null;
  const projectName = useMemo(() => {
    if (!rawProjectName) return null;
    try {
      return decodeURIComponent(rawProjectName);
    } catch {
      return rawProjectName;
    }
  }, [rawProjectName]);

  const inCoding = pathname.startsWith("/coding");
  const onTreatmentDetail = pathname.startsWith("/treatment/") && projectName;

  const completeLogout = useCallback(async () => {
    try {
      setIsLoggingOut(true);
      await logout();
      navigate("/");
    } catch (error) {
      toaster.create({
        title: "Logout failed",
        description: error instanceof Error ? error.message : "Failed to log out.",
        type: "error",
      });
    } finally {
      setIsLoggingOut(false);
    }
  }, [logout, navigate]);

  const consumePendingNavigation = useCallback((defaultPath: string) => {
    const pendingNavigation = (window as any).psat_pendingNavigation;
    (window as any).psat_pendingNavigation = null;
    return pendingNavigation || defaultPath;
  }, []);

  const consumePendingLogout = useCallback(() => {
    const pendingLogout = Boolean((window as any).psat_pendingLogout);
    (window as any).psat_pendingLogout = null;
    return pendingLogout;
  }, []);

  const completeExitAction = useCallback(async (defaultPath: string) => {
    const shouldLogout = consumePendingLogout();
    const nextPath = consumePendingNavigation(defaultPath);
    if (shouldLogout) {
      await completeLogout();
      return;
    }
    navigate(nextPath);
  }, [completeLogout, consumePendingLogout, consumePendingNavigation, navigate]);

  // Navigate with exit prompt for coding page (skip dialog if no real changes)
  const navigateSidebar = useCallback((to: string) => {
    if (inCoding) {
      const hasChanges = (window as any).psat_hasUnsavedChanges ?? true;
      if (hasChanges) {
        (window as any).psat_pendingNavigation = to;
        setExitDialogOpen(true);
      } else {
        toaster.create({ title: "No changes to save.", type: "info" });
        navigate(to);
      }
    } else {
      navigate(to);
    }
  }, [inCoding, navigate]);

  // Bulk treatment operations
  const handleTreatAllSegments = useCallback(async () => {
    if (!projectName) {
      toaster.create({
        description: "No project selected",
        type: "error",
      });
      return;
    }

    const projects = projectName.split(',').map(s => s.trim()).filter(Boolean);
    const allDetails: any[] = [];
    let totalTreated = 0;
    let totalSkipped = 0;
    let errors: string[] = [];

    for (const proj of projects) {
      try {
        const result = await applyAllTreatments(proj);
        if (result.ok) {
          totalTreated += result.segments_treated;
          totalSkipped += result.segments_skipped;
          const enrichedDetails = result.details.map((d: any) => ({ ...d, projectName: proj }));
          allDetails.push(...enrichedDetails);
        }
      } catch (error) {
        errors.push(`${proj}: ${error instanceof Error ? error.message : "Failed"}`);
      }
    }

    if (totalTreated > 0 || totalSkipped > 0) {
      toaster.create({
        title: "Treatments Applied",
        description: `Applied to ${totalTreated} segments across ${projects.length} project(s). ${totalSkipped} skipped.`,
        type: "success",
      });
      // Notify using all details
      window.dispatchEvent(new CustomEvent("psat:treat:all:completed", { detail: allDetails }));
    }

    if (errors.length > 0) {
      toaster.create({
        description: `Some errors occurred: ${errors.join("; ")}`,
        type: "error"
      });
    }
  }, [projectName]);

  const handleResetClick = useCallback(() => {
    if (!projectName) {
      toaster.create({
        description: "No project selected",
        type: "error",
      });
      return;
    }
    setResetDialogOpen(true);
  }, [projectName]);

  const handleConfirmReset = useCallback(async () => {
    if (!projectName) return;

    try {
      setIsResetting(true);
      const projects = projectName.split(',').map(s => s.trim()).filter(Boolean);
      let totalReset = 0;
      let errors: string[] = [];

      for (const proj of projects) {
        try {
          const result = await resetAllTreatments(proj);
          if (result.ok) {
            totalReset += result.segments_reset;
          }
        } catch (e) {
          errors.push(`${proj}: Failed`);
        }
      }

      toaster.create({
        title: "Treatments Reset",
        description: `Reset ${totalReset} segments across ${projects.length} project(s).`,
        type: "success",
      });

      window.dispatchEvent(new CustomEvent("psat:reset:all:completed"));
      setResetDialogOpen(false);

      if (errors.length > 0) {
        toaster.create({ description: `Errors: ${errors.join("; ")}`, type: "error" });
      }

    } catch (error) {
      toaster.create({
        description: error instanceof Error ? error.message : "Failed to reset treatments",
        type: "error",
      });
    } finally {
      setIsResetting(false);
    }
  }, [projectName]);


  const onAutoCodeOne = useCallback(() => {
    window.dispatchEvent(new CustomEvent("psat:autocode:one"));
  }, []);

  const onAutoCodeAll = useCallback(() => {
    window.dispatchEvent(new CustomEvent("psat:autocode:all"));
  }, []);

  const onAutoCodeAllProjects = useCallback(() => {
    window.dispatchEvent(new CustomEvent("psat:autocode:all-projects"));
  }, []);

  const onAutoCodeByAttribute = useCallback((fields: string[]) => {
    window.dispatchEvent(new CustomEvent("psat:autocode:by-field", { detail: { fields } }));
  }, []);

  const onSave = async () => {
    window.dispatchEvent(new CustomEvent("psat:save"));
  };

  const onExit = useCallback(() => {
    const hasChanges = (window as any).psat_hasUnsavedChanges ?? true;
    if (hasChanges) {
      setExitDialogOpen(true);
    } else {
      toaster.create({ title: "No changes to save.", type: "info" });
      void completeExitAction("/home");
    }
  }, [completeExitAction]);

  const onLogout = useCallback(() => {
    if (inCoding) {
      const hasChanges = (window as any).psat_hasUnsavedChanges ?? true;
      if (hasChanges) {
        (window as any).psat_pendingNavigation = "/";
        (window as any).psat_pendingLogout = true;
        setExitDialogOpen(true);
      } else {
        toaster.create({ title: "No changes to save.", type: "info" });
        void completeLogout();
      }
      return;
    }

    if (onTreatmentDetail) {
      (window as any).psat_pendingNavigation = "/";
      (window as any).psat_pendingLogout = true;
      setTreatmentExitDialogOpen(true);
      return;
    }

    void completeLogout();
  }, [completeLogout, inCoding, onTreatmentDetail]);


  const handleSaveAndExit = useCallback(() => {
    setIsSaving(true);
    window.dispatchEvent(new CustomEvent("psat:save"));

    // Give the save event a moment to complete before navigating
    setTimeout(() => {
      setIsSaving(false);
      setExitDialogOpen(false);

      void completeExitAction("/home");
    }, 500);
  }, [completeExitAction]);

  const handleDiscardAndExit = useCallback(() => {
    setExitDialogOpen(false);
    window.dispatchEvent(new CustomEvent("psat:discard"));
    toaster.create({ title: "Changes discarded.", type: "info" });
    void completeExitAction("/home");
  }, [completeExitAction]);

  const handleExitCancel = useCallback(() => {
    setExitDialogOpen(false);
    // Clear pending navigation
    (window as any).psat_pendingNavigation = null;
    (window as any).psat_pendingLogout = null;
  }, []);

  // Treatment save and exit handlers
  const onTreatmentSave = useCallback(async () => {
    if (!projectName) {
      toaster.create({
        description: "No project selected",
        type: "error",
      });
      return;
    }

    try {
      const projects = projectName.split(',').map(s => s.trim()).filter(Boolean);
      let errors: string[] = [];

      for (const proj of projects) {
        try {
          await saveTreatments(proj);
        } catch (e) {
          errors.push(`${proj}: Failed`);
        }
      }

      if (errors.length === 0) {
        toaster.create({
          title: "Treatments Saved",
          description: `Saved all changes for ${projects.length} project(s).`,
          type: "success",
        });
      } else {
        toaster.create({
          description: `Saved with some errors: ${errors.join("; ")}`,
          type: "error"
        });
      }
    } catch (error) {

      toaster.create({
        description: error instanceof Error ? error.message : "Failed to save treatments",
        type: "error",
      });
    }
  }, [projectName]);

  const onTreatmentExit = useCallback(() => {
    setTreatmentExitDialogOpen(true);
  }, []);

  const handleTreatmentSaveAndExit = useCallback(() => {
    setIsSaving(true);
    onTreatmentSave().then(() => {
      setIsSaving(false);
      setTreatmentExitDialogOpen(false);
      void completeExitAction("/home");
    }).catch(() => {
      setIsSaving(false);
      toaster.create({
        title: "Save failed",
        description: "Failed to save treatments. Please try again.",
        type: "error",
      });
    });
  }, [completeExitAction, onTreatmentSave]);

  const handleTreatmentDiscardAndExit = useCallback(() => {
    setTreatmentExitDialogOpen(false);
    void completeExitAction("/home");
  }, [completeExitAction]);

  const handleTreatmentExitCancel = useCallback(() => {
    setTreatmentExitDialogOpen(false);
    (window as any).psat_pendingNavigation = null;
    (window as any).psat_pendingLogout = null;
  }, []);

  return (
    <aside className="psat-sidebar" aria-label="PSAT sidebar">
      {/* Top: PSAT + buttons */}
      <div className="psat-side-top">
        <Tooltip
          content={
            <Box fontSize="xs" lineHeight="1.6" maxW="320px">
              <Text mb="2">As an acronym for the Path Safety Assessment Tool, PSAT places safety at the heart of its mission. The logo reflects this through the elongated "S," which visually suggests a path being carefully reviewed and assessed, while the spectrum of risk-assessment colours inspired by CycleRAP conveys the variety and severity of hazards along the route.</Text>
              <Text>The bold black letters give the logo a strong, authoritative presence, reinforcing trust and clarity in a safety-focused tool. The Josefin Sans Bold typeface was used as a geometric, clean typeface designed for legibility at larger display sizes, making it well-suited to branding and logo use.</Text>
            </Box>
          }
          showArrow
          portalled
          openDelay={0}
          closeOnClick={false}
          contentProps={{ maxW: "340px" }}
        >
          <img src={psatLogo} alt="PSAT" className="psat-brand-logo" style={{ cursor: "default" }} />
        </Tooltip>
        <h1 className="psat-sidebar-title">Path Safety Assessment Tool</h1>

        {activeProfile && (
          <div className="psat-profile-panel">
            <div className="psat-profile-label">Current Profile</div>
            <div className="psat-profile-name">{activeProfile.name}</div>
            <div className="psat-profile-division">{activeProfile.division}</div>
            <Button
              onClick={onLogout}
              colorPalette="red"
              variant="outline"
              size="sm"
              loading={isLoggingOut}
            >
              Log Out
            </Button>
          </div>
        )}

        <div className="psat-actions">
          {LINKS.filter(({ to }) => pathname !== to).map(({ to, label }) => {
            const active = pathname.startsWith(to);
            return (
              <Button
                onClick={() => navigateSidebar(to)}
                key={to}
                colorPalette="gray"
                variant={active ? "solid" : "outline"}
                size="sm"
              >
                {label}
              </Button>
            );
          })}
          {onTreatmentDetail && projectName && (
            <div className="psat-report-section" style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
              <Button
                onClick={() => {
                  const projects = projectName.split(",").map((p: string) => p.trim()).filter(Boolean);
                  sessionStorage.setItem("treatment_loadedProjects", JSON.stringify(projects));
                  sessionStorage.removeItem("pathAnalysis_loadedProjects");
                  navigate("/analysis/report");
                }}
                style={{ backgroundColor: "#a220e3", color: "white" }}
                variant="solid"
                size="sm"
                width="100%"
              >
                {hasSavedReport ? "📄 Continue Report" : "📄 Generate Report"}
              </Button>
              {hasSavedReport && (
                <div style={{ fontSize: 11, color: "#b060e0", textAlign: "center", lineHeight: 1.4 }}>
                  Your saved report layout will be restored
                </div>
              )}
            </div>
          )}
          {pathname === "/analysis/path" && (
            <div className="psat-report-section" style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
              <Button
                onClick={() => {
                  sessionStorage.removeItem("treatment_loadedProjects");
                  navigate("/analysis/report");
                }}
                style={{ backgroundColor: "#a220e3", color: "white" }}
                variant="solid"
                size="sm"
                width="100%"
              >
                {hasSavedReport ? "📄 Continue Report" : "📄 Generate Report"}
              </Button>
            </div>
          )}
        
        </div>
      </div>

      {/* Middle */}
      <Separator />

      <div className="psat-side-middle">
        {inCoding && projectName && (
          <CodingSidebar
            projectName={projectName}
            onSave={onSave}
            onExit={onExit}
            onAutoCodeOne={onAutoCodeOne}
            onAutoCodeAll={onAutoCodeAll}
            onAutoCodeAllProjects={onAutoCodeAllProjects}
            onAutoCodeByAttribute={onAutoCodeByAttribute}
          />
        )}
      </div>

      {/* Bottom: Create Project & Treatment Actions */}
      {/* Treatment Detail Page - Show treatment sidebar */}
      {onTreatmentDetail && projectName && (
        <div className="psat-side-bottom">
          <TreatmentSidebar
            onTreatAll={handleTreatAllSegments}
            onResetAll={handleResetClick}
            onSave={onTreatmentSave}
            onExit={onTreatmentExit}
          />
        </div>
      )}


      {/* Projects Page - Show GIS layer management + Admin buttons */}
      {pathname === "/home" && (
        <div className="psat-side-bottom" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Button onClick={() => navigateSidebar("/gis-layers")} colorPalette="teal" variant="surface" size="sm" width="100%">
            View GIS Layers
          </Button>
        </div>
      )}

      {/* Coding Exit Confirmation Dialog */}
      <ExitConfirmationDialog
        open={exitDialogOpen}
        onSaveAndExit={handleSaveAndExit}
        onDiscardAndExit={handleDiscardAndExit}
        onCancel={handleExitCancel}
        isSaving={isSaving}
      />

      {/* Treatment Exit Confirmation Dialog */}
      <ExitConfirmationDialog
        open={treatmentExitDialogOpen}
        onSaveAndExit={handleTreatmentSaveAndExit}
        onDiscardAndExit={handleTreatmentDiscardAndExit}
        onCancel={handleTreatmentExitCancel}
        isSaving={isSaving}
      />

      <ResetConfirmationDialog
        open={resetDialogOpen}
        onConfirm={handleConfirmReset}
        onCancel={() => setResetDialogOpen(false)}
        isResetting={isResetting}
      />
    </aside>
  );
}
