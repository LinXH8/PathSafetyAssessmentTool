import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FONT, COLOR, RADIUS } from "../../../features/ui/designTokens";
import { v2TabStyle, v2CardStyle } from "../../PathAnalysisPage/components/paV2Primitives";
import type { HelpPageViewModel, HelpTab } from "./HelpPageViewModel";

type DocItem = { id: string; num: number; title: string; path: string; updatedDate: string };

const DOC_LISTS: Record<HelpTab, DocItem[]> = {
  user: [
    { id: "getting-started",       num: 1, title: "Getting Started",           path: "/docs/user/user-getting-started.md",        updatedDate: "Jun 2026" },
    { id: "coding-page",           num: 2, title: "Coding Page",               path: "/docs/user/user-coding-page.md",            updatedDate: "Jun 2026" },
    { id: "path-analysis",         num: 3, title: "Path Analysis",             path: "/docs/user/user-path-analysis.md",          updatedDate: "Jun 2026" },
    { id: "treatment-application", num: 4, title: "Treatment Application",     path: "/docs/user/user-treatment-application.md",  updatedDate: "Jun 2026" },
    { id: "report-generation",     num: 5, title: "Report Generation",         path: "/docs/user/user-report-generation.md",      updatedDate: "Jun 2026" },
    { id: "gis-management",        num: 6, title: "GIS Layer Management",      path: "/docs/user/user-gis-management.md",         updatedDate: "Jun 2026" },
  ],
  admin: [
    { id: "deployment",   num: 1, title: "Deployment & Infrastructure",  path: "/docs/admin/admin-deployment.md",          updatedDate: "Jun 2026" },
    { id: "ml-models",    num: 2, title: "Managing ML Models",           path: "/docs/admin/admin-ml-models.md",           updatedDate: "Jun 2026" },
    { id: "gis-layers",   num: 3, title: "Managing GIS Data Layers",     path: "/docs/admin/admin-gis-layers.md",          updatedDate: "Jun 2026" },
    { id: "troubleshoot", num: 4, title: "Troubleshooting & Health",     path: "/docs/admin/admin-troubleshooting.md",     updatedDate: "Jun 2026" },
    { id: "cyclerap",     num: 5, title: "Updating CycleRAP Algorithm",  path: "/docs/admin/admin-cyclerap-algorithm.md",  updatedDate: "Jun 2026" },
    { id: "accounts",     num: 6, title: "User Accounts & Sign-In",      path: "/docs/admin/admin-user-accounts.md",       updatedDate: "Jun 2026" },
  ],
  developer: [
    { id: "readme",       num: 1,  title: "Overview (README)", path: "/README.md",                            updatedDate: "Jun 2026" },
    { id: "installation", num: 2,  title: "Installation",      path: "/docs/developer/installation.md",       updatedDate: "Jun 2026" },
    { id: "architecture", num: 3,  title: "Architecture",      path: "/docs/developer/architecture.md",       updatedDate: "Jun 2026" },
    { id: "api",          num: 4,  title: "API Reference",     path: "/docs/developer/api-reference.md",      updatedDate: "Jun 2026" },
    { id: "cv",           num: 5,  title: "CV / ML Pipeline",  path: "/docs/developer/cv-pipeline.md",        updatedDate: "Jun 2026" },
    { id: "scoring",      num: 6,  title: "Scoring Logic",     path: "/docs/developer/scoring.md",            updatedDate: "Jun 2026" },
    { id: "frontend",     num: 7,  title: "Frontend",          path: "/docs/developer/frontend.md",           updatedDate: "Jun 2026" },
    { id: "issues",       num: 8,  title: "Common Issues",     path: "/docs/developer/common-issues.md",      updatedDate: "Jun 2026" },
    { id: "contributing", num: 9,  title: "Contributing",      path: "/docs/developer/contributing.md",       updatedDate: "Jun 2026" },
    { id: "jira",         num: 10, title: "Jira Board",        path: "/docs/developer/dev-jira.md",           updatedDate: "Jun 2026" },
  ],
};

const TAB_ORDER: HelpTab[] = ["user", "admin", "developer"];
const TAB_LABELS: Record<HelpTab, string> = { user: "User", admin: "Admin", developer: "Developer" };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Parse "MMM YYYY" → sortable number (year*12 + month). Unknown → -1. */
function monthYearRank(s: string): number {
  const m = /^([A-Za-z]{3})\s+(\d{4})$/.exec(s.trim());
  if (!m) return -1;
  const mi = MONTHS.indexOf(m[1].toLowerCase());
  if (mi < 0) return -1;
  return Number(m[2]) * 12 + mi;
}

/** The most-recent updatedDate across a tab's docs (single value per tab). */
function latestUpdated(docs: DocItem[]): string {
  return docs.reduce<{ rank: number; label: string }>(
    (best, d) => {
      const r = monthYearRank(d.updatedDate);
      return r > best.rank ? { rank: r, label: d.updatedDate } : best;
    },
    { rank: -1, label: docs[0]?.updatedDate ?? "" }
  ).label;
}

export default function HelpPageLayoutV2({ activeTab, setActiveTab }: HelpPageViewModel) {
  const docs = DOC_LISTS[activeTab];
  const [activeIdx, setActiveIdx] = useState(0);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setActiveIdx(0); }, [activeTab]);

  useEffect(() => {
    const doc = docs[activeIdx];
    if (!doc) return;
    let mounted = true;
    setLoading(true);
    fetch(doc.path)
      .then(r => { if (!r.ok) throw new Error("Not found"); return r.text(); })
      .then(t => { if (mounted) { setContent(t); setLoading(false); } })
      .catch(e => { if (mounted) { setContent(`**Error loading document:** ${e.message}`); setLoading(false); } });
    return () => { mounted = false; };
  }, [docs, activeIdx]);

  useEffect(() => { contentRef.current?.scrollTo(0, 0); }, [activeIdx, activeTab]);

  return (
    <div style={{
      width: "100%",
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      background: COLOR.canvas,
      fontFamily: FONT,
      color: COLOR.text,
      padding: "2rem",
      boxSizing: "border-box",
    }}>
      {/* Page title */}
      <span style={{ fontSize: "1.25rem", fontWeight: 700, lineHeight: 1, marginBottom: "1rem", flexShrink: 0 }}>
        User Guide
      </span>

      {/* Tab pills (join the card below) */}
      <div style={{ display: "flex", gap: "0.25rem", flexShrink: 0, alignItems: "flex-end", position: "relative", zIndex: 2 }}>
        {TAB_ORDER.map(tab => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setActiveIdx(0); }}
            style={{ ...v2TabStyle(tab === activeTab), outline: "none" }}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Content card */}
      <div style={v2CardStyle({
        flex: 1,
        minHeight: 0,
        borderRadius: "0 0.375rem 0.375rem 0.375rem",
        display: "flex",
        overflow: "hidden",
        position: "relative",
        zIndex: 1,
      })}>
        {/* Left nav */}
        <div style={{
          width: "14.375rem",
          flexShrink: 0,
          overflowY: "auto",
          padding: "1.25rem",
          borderRight: `1px solid ${COLOR.rowDivider}`,
          display: "flex",
          flexDirection: "column",
          gap: "0.25rem",
          boxSizing: "border-box",
        }}>
          {/* Single "last updated" for this tab */}
          <span style={{ fontSize: "0.75rem", color: COLOR.gray500, marginBottom: "0.625rem", display: "block" }}>
            Last updated {latestUpdated(docs)}
          </span>

          {docs.map((doc, i) => {
            const active = i === activeIdx;
            return (
              <button
                key={doc.id}
                onClick={() => setActiveIdx(i)}
                style={{
                  padding: "0.625rem 0.75rem",
                  borderRadius: RADIUS,
                  cursor: "pointer",
                  background: active ? COLOR.blue : "transparent",
                  display: "flex",
                  alignItems: "center",
                  textAlign: "left",
                  border: "none",
                  width: "100%",
                  outline: "none",
                  fontFamily: FONT,
                  fontWeight: 700,
                  fontSize: "1rem",
                  lineHeight: 1.3,
                  color: active ? COLOR.white : COLOR.text,
                }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = COLOR.canvas; }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                {doc.num}. {doc.title}
              </button>
            );
          })}
        </div>

        {/* Content area */}
        <div
          ref={contentRef}
          style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "1.75rem 2.25rem", boxSizing: "border-box" }}
        >
          {loading ? (
            <p style={{ color: COLOR.gray500, fontStyle: "italic" }}>Loading document…</p>
          ) : (
            <V2MarkdownContent content={content} />
          )}
        </div>
      </div>
    </div>
  );
}

function V2MarkdownContent({ content }: { content: string }) {
  const toId = (children: unknown): string => {
    const t = Array.isArray(children) ? children.join("") : String(children);
    return t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  };

  const headingBase: React.CSSProperties = {
    color: COLOR.text,
    paddingBottom: "0.5rem",
    marginTop: "1.5rem",
    marginBottom: "1rem",
    fontWeight: 700,
    borderBottom: `1px solid ${COLOR.rowDivider}`,
  };

  const components = {
    h1: ({ children }: any) => <h1 id={toId(children)} style={{ ...headingBase, fontSize: "1.4rem" }}>{children}</h1>,
    h2: ({ children }: any) => <h2 id={toId(children)} style={{ ...headingBase, fontSize: "1.2rem" }}>{children}</h2>,
    h3: ({ children }: any) => <h3 id={toId(children)} style={{ ...headingBase, fontSize: "1.05rem" }}>{children}</h3>,
    p:  ({ children }: any) => <p style={{ marginBottom: "1rem", color: COLOR.gray600, fontSize: "1rem", lineHeight: 1.65 }}>{children}</p>,
    ul: ({ children }: any) => <ul style={{ paddingLeft: "1.5rem", marginBottom: "1rem", color: COLOR.gray600 }}>{children}</ul>,
    ol: ({ children }: any) => <ol style={{ paddingLeft: "1.5rem", marginBottom: "1rem", color: COLOR.gray600 }}>{children}</ol>,
    li: ({ children }: any) => <li style={{ marginBottom: "0.25rem", fontSize: "1rem", lineHeight: 1.65 }}>{children}</li>,
    strong: ({ children }: any) => <strong style={{ color: COLOR.text, fontWeight: 600 }}>{children}</strong>,
    a: ({ href, children }: any) => {
      if (href?.startsWith("#")) {
        return (
          <a
            href={href}
            style={{ color: COLOR.blue, textDecoration: "underline", cursor: "pointer" }}
            onClick={e => { e.preventDefault(); document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth" }); }}
          >
            {children}
          </a>
        );
      }
      return <a href={href} style={{ color: COLOR.blue, textDecoration: "underline" }}>{children}</a>;
    },
    blockquote: ({ children }: any) => (
      <blockquote style={{ borderLeft: `0.25rem solid ${COLOR.blue}`, paddingLeft: "1rem", fontStyle: "italic", margin: "1rem 0", color: COLOR.gray600 }}>
        {children}
      </blockquote>
    ),
    code: ({ inline, children }: any) =>
      inline
        ? <code style={{ background: COLOR.gray100, padding: "0.1rem 0.3rem", borderRadius: "0.25rem", fontFamily: "monospace", fontSize: "0.875em", color: COLOR.dangerHover }}>{children}</code>
        : <code style={{ fontFamily: "monospace" }}>{children}</code>,
    pre: ({ children }: any) => (
      <pre style={{ background: COLOR.gray800, padding: "1rem", borderRadius: RADIUS, overflowX: "auto", marginBottom: "1rem", color: "#f1f5f9" }}>{children}</pre>
    ),
    table: ({ children }: any) => (
      <div style={{ overflowX: "auto", width: "100%", marginBottom: "1.5rem" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>{children}</table>
      </div>
    ),
    th: ({ children }: any) => <th style={{ border: `1px solid ${COLOR.border}`, padding: "0.75rem", textAlign: "left", background: COLOR.gray100, color: COLOR.text, fontWeight: 600, whiteSpace: "nowrap" }}>{children}</th>,
    td: ({ children }: any) => <td style={{ border: `1px solid ${COLOR.border}`, padding: "0.75rem", color: COLOR.gray600, minWidth: "5rem" }}>{children}</td>,
    hr: () => <hr style={{ border: "none", borderTop: `1px solid ${COLOR.rowDivider}`, margin: "1.5rem 0" }} />,
  };

  return (
    <div style={{ fontSize: "1rem", lineHeight: 1.65 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as any}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
