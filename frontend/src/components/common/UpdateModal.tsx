import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { FONT, COLOR } from "../../features/ui/designTokens";
import V2ModalShell, { modalGhostBtn, modalPrimaryBtn } from "./V2ModalShell";
import {
  checkForUpdate,
  discardUpdate,
  formatBytes,
  getUpdateProgress,
  startUpdateDownload,
  type UpdateStatus,
} from "../../api/updates";

/**
 * Update notifier — the whole user-facing surface of remote updating.
 *
 * Mounted once, app-wide. Users have no Git and never visit a release page, so
 * this is how an update reaches them. Consent model: notify, let the user choose
 * to download, and apply on the next start. Nothing is ever applied silently or
 * to a running app.
 *
 * Built on V2ModalShell (portal-based) rather than Chakra's <Dialog>, per the v2
 * modal convention — it sidesteps the Zag pointer-events freeze documented in
 * CLAUDE.md.
 */

// Long enough that a check is never in the user's way, short enough that a
// release published during the day is noticed the same day.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const FIRST_CHECK_DELAY_MS = 20_000; // let the app settle (GIS warmup) first
const PROGRESS_POLL_MS = 1000;
const DISMISSED_KEY = "psat:updateDismissedVersion";

type Phase = "idle" | "offer" | "downloading" | "ready" | "failed";

export default function UpdateModal() {
  const location = useLocation();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0, component: "" });
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  // Never interrupt the landing/profile screen — the user has not started work yet.
  const suppressed = location.pathname === "/";

  const dismissedVersion = () => {
    try {
      return localStorage.getItem(DISMISSED_KEY);
    } catch {
      return null;
    }
  };

  const runCheck = useCallback(async () => {
    try {
      const next = await checkForUpdate();
      setStatus(next);
      if (next.pending) {
        // Already downloaded on a previous run — just needs a restart.
        setPhase("ready");
      } else if (next.updateAvailable && next.availableVersion !== dismissedVersion()) {
        setPhase("offer");
      }
    } catch {
      // Offline or the feed does not exist yet. Stay silent: an update check is
      // never important enough to put an error in front of the user.
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(runCheck, FIRST_CHECK_DELAY_MS);
    const interval = window.setInterval(runCheck, CHECK_INTERVAL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [runCheck]);

  // Poll download progress only while a download is actually running.
  useEffect(() => {
    if (phase !== "downloading") return;
    const tick = async () => {
      try {
        const p = await getUpdateProgress();
        setProgress({ done: p.done, total: p.total, component: p.component ?? "" });
        if (!p.running) {
          if (p.pending) {
            setPhase("ready");
          } else {
            setPhase("failed");
            setError("The update could not be downloaded. Your current version is unaffected.");
          }
        }
      } catch {
        /* transient — keep polling */
      }
    };
    pollRef.current = window.setInterval(tick, PROGRESS_POLL_MS);
    void tick();
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [phase]);

  const onDownload = async () => {
    setError(null);
    setPhase("downloading");
    try {
      await startUpdateDownload();
    } catch (e) {
      setPhase("failed");
      setError(e instanceof Error ? e.message : "Could not start the download.");
    }
  };

  const onLater = () => {
    // Remember the specific version so the same update does not nag every launch,
    // but a NEWER one still surfaces.
    try {
      if (status?.availableVersion) localStorage.setItem(DISMISSED_KEY, status.availableVersion);
    } catch {
      /* private mode — worst case it asks again */
    }
    setPhase("idle");
  };

  const onDiscard = async () => {
    try {
      await discardUpdate();
    } catch {
      /* best effort */
    }
    setPhase("idle");
    setStatus(null);
  };

  if (suppressed || phase === "idle" || !status) return null;

  const text: React.CSSProperties = {
    fontFamily: FONT,
    fontSize: 15,
    lineHeight: 1.55,
    color: COLOR.gray600,
    margin: 0,
  };
  const strong: React.CSSProperties = { ...text, fontWeight: 700, color: COLOR.text };

  // ── Downloaded, waiting for a restart ──────────────────────────────────────
  if (phase === "ready") {
    return (
      <V2ModalShell
        open
        onClose={() => setPhase("idle")}
        title="Update ready to install"
        width={480}
        footer={
          <>
            <button type="button" style={modalGhostBtn()} onClick={onDiscard}>
              Remove update
            </button>
            <button type="button" style={modalPrimaryBtn(false)} onClick={() => setPhase("idle")}>
              OK
            </button>
          </>
        }
      >
        <p style={strong}>
          PSAT {status.availableVersion} has been downloaded.
        </p>
        <p style={text}>
          It installs the next time you start PSAT — close and reopen the app when convenient.
          Your projects and survey data are not affected.
        </p>
      </V2ModalShell>
    );
  }

  // ── Downloading ────────────────────────────────────────────────────────────
  if (phase === "downloading") {
    // progress.done / progress.total are BYTES across the whole download. Cap the bar at
    // 99% while it is still running so it never reads "100% / done" before the download
    // has actually finished — the switch to the "Update ready to install" screen is the
    // only signal that it is safe to restart.
    const rawPct = progress.total > 0 ? (progress.done / progress.total) * 100 : 0;
    const pct = Math.min(99, Math.round(rawPct));
    return (
      <V2ModalShell open onClose={() => {}} title="Downloading update" width={480} busy>
        <p style={text}>
          Downloading PSAT {status.availableVersion}
          {progress.component ? ` — ${progress.component}` : ""}. You can keep working; PSAT
          installs it the next time you start it.
        </p>
        <div
          style={{
            height: 8,
            width: "100%",
            background: COLOR.gray100,
            borderRadius: 999,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: COLOR.blue,
              transition: "width 200ms ease",
            }}
          />
        </div>
        <p style={{ ...text, fontSize: 13, color: COLOR.gray500 }}>
          {progress.total > 0
            ? `${formatBytes(progress.done)} of ${formatBytes(progress.total)} (${pct}%) — please wait until PSAT says the update is ready before restarting`
            : "Starting…"}
        </p>
      </V2ModalShell>
    );
  }

  // ── Download failed ────────────────────────────────────────────────────────
  if (phase === "failed") {
    return (
      <V2ModalShell
        open
        onClose={() => setPhase("idle")}
        title="Update failed"
        width={480}
        footer={
          <>
            <button type="button" style={modalGhostBtn()} onClick={() => setPhase("idle")}>
              Close
            </button>
            <button type="button" style={modalPrimaryBtn(false)} onClick={onDownload}>
              Try again
            </button>
          </>
        }
      >
        <p style={text}>{error ?? "The update could not be downloaded."}</p>
        <p style={{ ...text, fontSize: 13, color: COLOR.gray500 }}>
          Your current version is unaffected and PSAT will keep working normally.
        </p>
      </V2ModalShell>
    );
  }

  // ── Update available ───────────────────────────────────────────────────────
  return (
    <V2ModalShell
      open
      onClose={onLater}
      title="Update available"
      width={480}
      footer={
        <>
          <button type="button" style={modalGhostBtn()} onClick={onLater}>
            Not now
          </button>
          <button type="button" style={modalPrimaryBtn(false)} onClick={onDownload}>
            Download
          </button>
        </>
      }
    >
      <p style={strong}>
        PSAT {status.availableVersion} is available — you have {status.currentVersion}.
      </p>
      {status.notes && <p style={text}>{status.notes}</p>}
      <p style={text}>
        Download size: <strong>{formatBytes(status.downloadBytes)}</strong>. You can keep working
        while it downloads; it installs the next time you start PSAT.
      </p>
    </V2ModalShell>
  );
}
