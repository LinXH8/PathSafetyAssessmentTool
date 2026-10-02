import { useEffect, useState, type CSSProperties } from "react";
import { Navigate } from "react-router-dom";
import { fetchAllAccounts, type AccountListItem } from "../../api";
import { useProfile } from "../../features/profile/ProfileProvider";
import { FONT, COLOR, RADIUS } from "../../features/ui/designTokens";
import { v2CardStyle } from "../PathAnalysisPage/components/paV2Primitives";

/**
 * Admin-only, read-only list of every account (username + division), for usage
 * tracking on the shared server where the login page no longer lists accounts.
 *
 * Who is an admin is decided by the backend (PSAT_ADMIN_EMAILS) for the session
 * that is logged in right now; `isAdmin` here only hides the page, the
 * `/api/profiles/accounts` endpoint enforces it.
 */

const captionStyle: CSSProperties = { fontFamily: FONT, fontWeight: 400, fontSize: "0.75rem", color: COLOR.gray500 };
const cellStyle: CSSProperties = {
  padding: "0.625rem 1rem",
  fontFamily: FONT,
  fontSize: "1rem",
  color: COLOR.text,
  textAlign: "left",
  borderBottom: `1px solid ${COLOR.rowDivider}`,
};
const headCellStyle: CSSProperties = {
  ...cellStyle,
  position: "sticky",
  top: 0,
  background: COLOR.white,
  fontWeight: 700,
  borderBottom: `1px solid ${COLOR.border}`,
};

export default function AccountsPage() {
  const { isAdmin } = useProfile();
  const [accounts, setAccounts] = useState<AccountListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setLoading(true);
    fetchAllAccounts()
      .then((rows) => {
        if (cancelled) return;
        setAccounts(rows);
        setError(null);
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : "Failed to load accounts.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/home" replace />;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        padding: "2rem",
        boxSizing: "border-box",
        height: "100vh",
        overflow: "hidden",
        background: COLOR.canvas,
        fontFamily: FONT,
      }}
    >
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: "1.25rem", color: COLOR.text }}>Accounts</div>
        <div style={{ ...captionStyle, marginTop: "0.25rem" }}>
          {loading || error
            ? "Every account on this server."
            : `${accounts.length} account${accounts.length === 1 ? "" : "s"} on this server.`}
        </div>
      </div>

      <div style={{ ...v2CardStyle(), flex: 1, minHeight: 0, maxWidth: "45rem", overflowY: "auto", borderRadius: RADIUS }}>
        {loading ? (
          <div style={{ ...captionStyle, padding: "1rem" }}>Loading accounts…</div>
        ) : error ? (
          <div style={{ ...captionStyle, padding: "1rem", color: COLOR.danger }}>{error}</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={headCellStyle}>Username</th>
                <th style={headCellStyle}>Division</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.username}>
                  <td style={cellStyle}>{account.username}</td>
                  <td style={cellStyle}>{account.division}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
