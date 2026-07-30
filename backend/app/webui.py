"""Serve the built React frontend from Flask so PSAT runs on a single port.

Deployment (see ``temp/DEPLOYMENT_PACKAGING_PLAN.md``) ships a portable frozen
bundle with no Node.js at runtime: instead of the Vite dev server on :5173
proxying ``/api`` to :8000, Flask serves the *built* frontend and the API from
the same origin on :8000. The frontend already uses relative ``/api`` paths, so
nothing in the client needs to know about this.

Resolution order for the built bundle:
  1. ``PSAT_WEBUI_DIR`` env var (explicit override)
  2. ``<install root>/webui``      -- the shipped bundle layout
  3. ``<repo>/frontend/dist``      -- the dev repo layout (``npm run build``)

If none of these contain an ``index.html`` the app still starts and the API
works; only the UI is unavailable. That keeps ``npm run dev`` workflows and
API-only/test runs functional.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from flask import abort, send_from_directory

logger = logging.getLogger(__name__)

# Long-lived cache for Vite's content-hashed assets; they are immutable by
# construction (the hash changes when the content does).
_IMMUTABLE_CACHE = "public, max-age=31536000, immutable"


def _candidate_dirs() -> list[Path]:
    backend_root = Path(__file__).resolve().parents[1]  # .../backend/
    install_root = backend_root.parent                  # bundle root / repo root
    candidates: list[Path] = []
    env_dir = os.environ.get("PSAT_WEBUI_DIR")
    if env_dir:
        candidates.append(Path(env_dir))
    candidates.append(install_root / "webui")
    candidates.append(install_root / "frontend" / "dist")
    return candidates


def resolve_webui_dir() -> Path | None:
    """Return the directory holding the built frontend, or None if not built."""
    for candidate in _candidate_dirs():
        try:
            if (candidate / "index.html").is_file():
                return candidate.resolve()
        except OSError:
            continue
    return None


def register_webui(app) -> None:
    """Mount the built frontend at ``/`` with SPA history-fallback routing."""
    webui_dir = resolve_webui_dir()
    if webui_dir is None:
        logger.warning(
            "No built frontend found (looked for index.html in: %s). "
            "API will work but the UI will not be served. Run 'npm run build' "
            "in frontend/, or set PSAT_WEBUI_DIR.",
            ", ".join(str(c) for c in _candidate_dirs()),
        )
        return

    app.config["PSAT_WEBUI_DIR"] = str(webui_dir)
    logger.info("Serving built frontend from %s", webui_dir)

    def _send_index():
        resp = send_from_directory(webui_dir, "index.html")
        # index.html must never be cached: after an update replaces webui/, a
        # stale index would keep pointing at deleted asset hashes.
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.get("/")
    def webui_index():
        return _send_index()

    @app.get("/<path:req_path>")
    def webui_catchall(req_path: str):
        # Defensive: /api/* is owned by the blueprints. Werkzeug already scores
        # those more specific rules above this catch-all, so this should be
        # unreachable -- but never let a client-side route shadow the API.
        if req_path == "api" or req_path.startswith("api/"):
            abort(404)

        # Resolve within webui_dir to reject traversal (``..``) and symlink escapes.
        try:
            candidate = (webui_dir / req_path).resolve()
            candidate.relative_to(webui_dir)
        except (ValueError, OSError):
            abort(404)

        if candidate.is_file():
            resp = send_from_directory(webui_dir, req_path)
            if req_path.startswith("assets/"):
                resp.headers["Cache-Control"] = _IMMUTABLE_CACHE
            return resp

        # Unknown path with no file behind it -> hand it to the SPA router.
        return _send_index()
