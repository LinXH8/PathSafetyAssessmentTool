# app/api/health.py
from flask import Blueprint, jsonify

from app.services.version import get_version_info

bp = Blueprint("health", __name__)

@bp.get("/ping")
def ping():
    return jsonify({"status": "ok"})


@bp.get("/health")
def health():
    """Liveness probe.

    Lives on the blueprint (not the ``app.py`` entrypoint) so it exists under
    every entrypoint -- waitress imports ``create_app()`` directly and never
    executes ``app.py``'s module body, which is where this route used to be.
    The packaged launcher polls this after applying an update to decide whether
    to keep the new version or roll back, so it must always be present. It also
    reports the installed version, which is what the launcher records as
    "known-good" and what the updater compares against the remote manifest.
    """
    info = get_version_info()
    return jsonify({
        "status": "ok",
        "version": info["version"],
        "channel": info["channel"],
    })
