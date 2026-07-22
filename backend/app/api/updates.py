"""Update endpoints backing the in-app "update available" modal.

Consent model (decided 2026-07-21): notify and let the user restart. Nothing is
ever applied silently. Downloading is explicit too, so a 5 GB shapefile refresh
never starts itself on a metered connection.
"""

from __future__ import annotations

import logging
import threading

from flask import Blueprint, jsonify, request

from app.services import updater

logger = logging.getLogger(__name__)

bp = Blueprint("updates", __name__)

# Guards against a second download starting while one is in flight (double-click
# on the modal, or a background check racing a manual one).
_download_lock = threading.Lock()
_download_state: dict = {"running": False, "component": None, "done": 0, "total": 0}


@bp.get("/check")
def check():
    """Is there an update? Never fails hard -- offline is a normal state."""
    status = updater.check_for_update()
    return jsonify(status.as_dict())


@bp.get("/status")
def status():
    """Progress of an in-flight download, plus whether an update is staged."""
    return jsonify({
        "running": _download_state["running"],
        "component": _download_state["component"],
        "done": _download_state["done"],
        "total": _download_state["total"],
        "pending": updater.has_pending_update(),
    })


@bp.post("/download")
def download():
    """Start downloading the staged update in the background."""
    if not _download_lock.acquire(blocking=False):
        return jsonify({"error": "A download is already running"}), 409

    _download_state.update({"running": True, "component": None, "done": 0, "total": 0})

    def progress(component: str, done: int, total: int) -> None:
        _download_state.update({"component": component, "done": done, "total": total})

    def run() -> None:
        try:
            result = updater.download_update(progress=progress)
            if result.error:
                logger.warning("Update download failed: %s", result.error)
            _download_state["error"] = result.error
        except Exception:
            logger.exception("Unexpected error during update download")
            _download_state["error"] = "Unexpected error during download"
        finally:
            _download_state["running"] = False
            _download_lock.release()

    threading.Thread(target=run, daemon=True, name="psat-updater").start()
    return jsonify({"started": True})


@bp.post("/discard")
def discard():
    """Throw away a staged update (e.g. the user does not want to restart into it)."""
    if _download_state["running"]:
        return jsonify({"error": "A download is running"}), 409
    updater.discard_pending()
    return jsonify({"discarded": True})
