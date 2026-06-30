import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { fetchProjectList, type ProjectListItem, type ProfileSummary } from "../../api";
import { openCoding, openPathAnalysis, openTreatment } from "../../features/projectNav";
import { FONT, COLOR } from "../../features/ui/designTokens";
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
  pathname: string;
  /** Route-specific panels (CodingSidebar etc.) for not-yet-migrated pages. */
  children?: ReactNode;
}

const ghostBase: React.CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  height: 40,
  padding: "0 16px",
  background: COLOR.white,
  border: `1px solid ${COLOR.borderInput}`,
  borderRadius: 6,
  fontFamily: FONT,
  fontWeight: 700,
  fontSize: 16,
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
      {checked && (
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
          <path d="M2 6l3 3 5-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

export default function SidebarV2({
  activeProfile,
  onLogout,
  isLoggingOut,
  onGuardedAction,
  pathname,
  children,
}: SidebarV2Props) {
  const navigate = useNavigate();
  // Every nav button runs through the unsaved-changes guard.
  const go = (to: string) => onGuardedAction(() => navigate(to));
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [qsSelected, setQsSelected] = useState<Set<string>>(new Set());
  const [qsOpen, setQsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchProjectList()
      .then((data) => {
        if (!cancelled) setProjects(data.projects ?? []);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedNames = useMemo(() => Array.from(qsSelected), [qsSelected]);
  const hasSelection = selectedNames.length > 0;
  const allChecked = projects.length > 0 && qsSelected.size === projects.length;
  const isHome = pathname === "/home";

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
        style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}
        className="psat-v2-scroll"
      >
        <img
          src={psatLogo}
          alt="PSAT"
          style={{ width: 196, height: "auto", alignSelf: "center", marginBottom: 6, objectFit: "contain" }}
        />

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
              gap: 8,
              height: 40,
              padding: "0 16px",
              background: COLOR.white,
              border: `1px solid ${COLOR.borderInput}`,
              borderRadius: qsOpen ? "6px 6px 0 0" : 6,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 16, color: COLOR.text, lineHeight: 1.2 }}>
              Quick Select
            </span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke={COLOR.gray600}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transition: "transform .2s", transform: qsOpen ? "rotate(180deg)" : "rotate(0deg)", flexShrink: 0 }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
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
                  gap: 8,
                  padding: "7px 10px",
                  fontFamily: FONT,
                  fontSize: 16,
                  cursor: "pointer",
                  borderRadius: 6,
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
                    gap: 8,
                    padding: "7px 10px",
                    fontFamily: FONT,
                    fontSize: 16,
                    cursor: "pointer",
                    borderRadius: 6,
                    color: COLOR.text,
                  }}
                >
                  <Checkbox checked={qsSelected.has(p.name)} />
                  <span>{p.name}</span>
                </div>
              ))}
              {projects.length === 0 && (
                <div style={{ padding: "7px 10px", fontFamily: FONT, fontSize: 12, color: COLOR.gray500 }}>
                  No projects
                </div>
              )}
            </div>
          )}
        </div>

        {navButton("Coding", () => onGuardedAction(() => openCoding(navigate, selectedNames)), { disabled: !hasSelection })}
        {navButton("Path Analysis", () => onGuardedAction(() => openPathAnalysis(navigate, selectedNames)), { disabled: !hasSelection })}
        {navButton("Treatment Application", () => onGuardedAction(() => openTreatment(navigate, selectedNames)), { disabled: !hasSelection })}

        {isHome && navButton("Generated Reports", () => go("/generated-reports"))}

        {/* Route-specific panels for pages not yet migrated to v2. */}
        {children}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 14 }}>
        {isHome && navButton("GIS Layers", () => go("/gis-layers"))}
        {navButton("User Guide", () => go("/help"))}
        {activeProfile && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              border: `1px solid ${COLOR.borderInput}`,
              borderRadius: 6,
              padding: 10,
            }}
          >
            <div style={{ textAlign: "center", fontFamily: FONT, fontSize: 16, fontWeight: 700, color: COLOR.text, lineHeight: 1.4 }}>
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
