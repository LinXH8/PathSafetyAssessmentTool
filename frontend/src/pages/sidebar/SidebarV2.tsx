import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { LuCheck, LuChevronDown } from "react-icons/lu";
import { fetchProjectList, type ProjectListItem, type ProfileSummary } from "../../api";
import { openCoding, openPathAnalysis, openTreatment } from "../../features/projectNav";
import { onProjectListChanged } from "../../features/projectListSync";
import { useProjectSelection } from "../../features/projectSelection";
import { FONT, COLOR } from "../../features/ui/designTokens";
import { useAppVersion } from "../../hooks/useAppVersion";
import psatLogo from "./assets/psat-logo.png";
import "./sidebar-v2.css";

interface SidebarV2Props {
  activeProfile: ProfileSummary | null;
  onLogout: () => void;
  isLoggingOut: boolean;
  /**
   * Runs a navigation action, first showing the exit-without-saving dialog if the
   * current page has unsaved changes. ALL sidebar nav routes through this so any
   * button honours the prompt.
   */
  onGuardedAction: (action: () => void) => void;
  /** Route-specific panels (CodingSidebar etc.) for not-yet-migrated pages. */
  children?: ReactNode;
}

const ghostBase: React.CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  height: "2.5rem",
  padding: "0 1rem",
  background: COLOR.white,
  border: `1px solid ${COLOR.borderInput}`,
  borderRadius: "0.375rem",
  fontFamily: FONT,
  fontWeight: 700,
  fontSize: "1rem",
  color: COLOR.text,
  cursor: "pointer",
  textAlign: "center",
  lineHeight: 1.2,
};

const ghostDisabled: React.CSSProperties = {
  ...ghostBase,
  background: COLOR.gray100,
  border: `1px solid ${COLOR.border}`,
  color: COLOR.gray400,
  cursor: "not-allowed",
};

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <div
      style={
        checked
          ? {
              width: 16,
              height: 16,
              background: COLOR.blue,
              border: `1px solid ${COLOR.blue}`,
              borderRadius: 2,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }
          : {
              width: 16,
              height: 16,
              border: `1px solid ${COLOR.borderInput}`,
              borderRadius: 2,
              flexShrink: 0,
              background: COLOR.white,
            }
      }
    >
      {checked && <LuCheck size={10} color="#fff" strokeWidth={3} />}
    </div>
  );
}

export default function SidebarV2({
  activeProfile,
  onLogout,
  isLoggingOut,
  onGuardedAction,
  children,
}: SidebarV2Props) {
  const navigate = useNavigate();
  const appVersion = useAppVersion();
  // Every nav button runs through the unsaved-changes guard.
  const go = (to: string) => onGuardedAction(() => navigate(to));
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  // Shared with the Home page — selecting there checks these, and vice versa.
  const [qsSelected, setQsSelected] = useProjectSelection();
  const [qsOpen, setQsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refreshProjects = () => {
      fetchProjectList()
        .then((data) => {
          if (!cancelled) setProjects(data.projects ?? []);
        })
        .catch(() => {
          if (!cancelled) setProjects([]);
        });
    };
    refreshProjects();
    // AppLayout keeps the sidebar mounted across in-app navigation, so a
    // project created/deleted/imported elsewhere needs an explicit signal
    // to make Quick Select refetch (see projectListSync.ts).
    const unsubscribe = onProjectListChanged(refreshProjects);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const selectedNames = useMemo(() => Array.from(qsSelected), [qsSelected]);
  const hasSelection = selectedNames.length > 0;
  const allChecked = projects.length > 0 && qsSelected.size === projects.length;

  const toggleProject = (name: string) =>
    setQsSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const toggleAll = () =>
    setQsSelected(allChecked ? new Set() : new Set(projects.map((p) => p.name)));

  const navButton = (
    label: string,
    onClick: () => void,
    opts?: { disabled?: boolean }
  ) => (
    <button
      className="psat-v2-ghost"
      style={opts?.disabled ? ghostDisabled : ghostBase}
      disabled={opts?.disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    <aside className="psat-sidebar psat-sidebar--v2" aria-label="PSAT sidebar">
      <div
        style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: "0.875rem", overflowY: "auto" }}
        className="psat-v2-scroll"
      >
        <img
          src={psatLogo}
          alt="PSAT"
          style={{ width: "12.25rem", height: "auto", alignSelf: "center", marginBottom: "0.125rem", objectFit: "contain" }}
        />
        <span
          style={{
            alignSelf: "center",
            marginBottom: "0.375rem",
            fontFamily: FONT,
            fontSize: "0.75rem",
            fontWeight: 600,
            color: COLOR.gray500,
            letterSpacing: "0.02em",
          }}
        >
          v{appVersion.version}
        </span>

        {navButton("Home", () => go("/home"))}

        {/* Quick Select */}
        <div style={{ width: "100%" }}>
          <div
            onClick={() => setQsOpen((o) => !o)}
            style={{
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              height: "2.5rem",
              padding: "0 1rem",
              background: COLOR.white,
              border: `1px solid ${COLOR.borderInput}`,
              borderRadius: qsOpen ? "0.375rem 0.375rem 0 0" : "0.375rem",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: "1rem", color: COLOR.text, lineHeight: 1.2 }}>
              Quick Select
            </span>
            <LuChevronDown
              size={14}
              color={COLOR.gray600}
              strokeWidth={2.5}
              style={{ transition: "transform .2s", transform: qsOpen ? "rotate(180deg)" : "rotate(0deg)", flexShrink: 0 }}
            />
          </div>
          {qsOpen && (
            <div
              style={{
                boxSizing: "border-box",
                border: `1px solid ${COLOR.borderInput}`,
                borderTop: "none",
                borderRadius: "0 0 6px 6px",
                padding: 6,
                background: COLOR.white,
                maxHeight: 240,
                overflowY: "auto",
              }}
              className="psat-v2-scroll"
            >
              <div
                onClick={toggleAll}
                className="psat-v2-qs-item"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.4375rem 0.625rem",
                  fontFamily: FONT,
                  fontSize: "1rem",
                  cursor: "pointer",
                  borderRadius: "0.375rem",
                  color: COLOR.text,
                }}
              >
                <Checkbox checked={allChecked} />
                <span style={{ fontWeight: 700 }}>All Projects</span>
              </div>
              {projects.map((p) => (
                <div
                  key={p.name}
                  onClick={() => toggleProject(p.name)}
                  className="psat-v2-qs-item"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.4375rem 0.625rem",
                    fontFamily: FONT,
                    fontSize: "1rem",
                    cursor: "pointer",
                    borderRadius: "0.375rem",
                    color: COLOR.text,
                  }}
                >
                  <Checkbox checked={qsSelected.has(p.name)} />
                  <span>{p.name}</span>
                </div>
              ))}
              {projects.length === 0 && (
                <div style={{ padding: "0.4375rem 0.625rem", fontFamily: FONT, fontSize: "0.75rem", color: COLOR.gray500 }}>
                  No projects
                </div>
              )}
            </div>
          )}
        </div>

        {navButton("Coding", () => onGuardedAction(() => openCoding(navigate, selectedNames)), { disabled: !hasSelection })}
        {navButton("Path Analysis", () => onGuardedAction(() => openPathAnalysis(navigate, selectedNames)), { disabled: !hasSelection })}
        {navButton("Treatment Application", () => onGuardedAction(() => openTreatment(navigate, selectedNames)), { disabled: !hasSelection })}

        {navButton("Generated Reports", () => go("/generated-reports"))}

        {/* Route-specific panels for pages not yet migrated to v2. */}
        {children}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem", paddingTop: "0.875rem" }}>
        {navButton("GIS Layers", () => go("/gis-layers"))}
        {navButton("User Guide", () => go("/help"))}
        {activeProfile && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
              border: `1px solid ${COLOR.borderInput}`,
              borderRadius: "0.375rem",
              padding: "0.625rem",
            }}
          >
            <div style={{ textAlign: "center", fontFamily: FONT, fontSize: "1rem", fontWeight: 700, color: COLOR.text, lineHeight: 1.4 }}>
              {activeProfile.name}
            </div>
            <button
              className="psat-v2-ghost"
              style={ghostBase}
              onClick={onLogout}
              disabled={isLoggingOut}
            >
              {isLoggingOut ? "Logging out…" : "Logout"}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
