import datetime
import re
from pathlib import Path

from flask import Blueprint, jsonify, request, send_from_directory

import app.services.paths as paths
from app.services import profile_store

bp = Blueprint("generated_reports", __name__)


def _reports_dir() -> Path:
    """The calling profile's report folder: ``profiles/<slug>/generated_reports``.

    Each profile lists, opens, renames and deletes only its own reports. The
    login gate guarantees a session on these routes; the shared
    ``Generated Reports`` root (see services/paths.py) is only used without one
    (the PSAT_AUTH_DISABLED maintainer pipeline). Reports saved there before
    per-profile folders existed are left on disk, unlisted.
    """
    profile_id = profile_store.get_active_profile_id()
    if profile_id:
        return profile_store.get_profile_reports_root(profile_id).resolve()
    return paths.generated_reports_dir().resolve()


def _ensure_dir() -> None:
    _reports_dir().mkdir(parents=True, exist_ok=True)


def _safe_name(filename: str) -> str:
    """Sanitize filename: keep only safe chars, enforce .pdf extension."""
    name = Path(filename).name  # strip any path components
    name = re.sub(r"[^\w\s\-.]", "", name)  # allow word chars, spaces, hyphens, dots
    name = name.strip()
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    return name or "PSAT_Report.pdf"


@bp.route("/", methods=["GET"])
def list_reports():
    _ensure_dir()
    files = []
    for f in _reports_dir().iterdir():
        if f.is_file() and f.suffix.lower() == ".pdf":
            stat = f.stat()
            files.append({
                "name": f.name,
                "size": stat.st_size,
                "created": datetime.datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
    files.sort(key=lambda x: x["created"], reverse=True)
    return jsonify(files)


@bp.route("/save", methods=["POST"])
def save_report():
    _ensure_dir()
    file = request.files.get("file")
    if not file:
        return jsonify({"error": "No file provided"}), 400
    raw_name = request.form.get("filename", "PSAT_Report.pdf")
    filename = _safe_name(raw_name)
    dest = _reports_dir() / filename
    file.save(dest)
    return jsonify({"saved": filename})


@bp.route("/<path:filename>", methods=["GET"])
def serve_report(filename: str):
    safe = _safe_name(Path(filename).name)
    target = _reports_dir() / safe
    if not target.exists() or not target.is_file():
        return jsonify({"error": "Not found"}), 404
    resp = send_from_directory(
        _reports_dir(),
        safe,
        mimetype="application/pdf",
        conditional=True,
        as_attachment=False,
    )
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["Content-Disposition"] = f'inline; filename="{safe}"'
    return resp


@bp.route("/<path:filename>", methods=["DELETE"])
def delete_report(filename: str):
    safe = _safe_name(Path(filename).name)
    target = _reports_dir() / safe
    if not target.exists() or not target.is_file():
        return jsonify({"error": "Not found"}), 404
    target.unlink()
    return jsonify({"deleted": safe})


@bp.route("/<path:filename>", methods=["PATCH"])
def rename_report(filename: str):
    """Rename a saved report. Body: {"new_name": "..."} — the .pdf extension is
    enforced by _safe_name, collisions are rejected."""
    _ensure_dir()
    safe_old = _safe_name(Path(filename).name)
    src = _reports_dir() / safe_old
    if not src.exists() or not src.is_file():
        return jsonify({"error": "Not found"}), 404

    data = request.get_json(silent=True) or {}
    raw_new = (data.get("new_name") or "").strip()
    if not raw_new:
        return jsonify({"error": "New name required"}), 400

    safe_new = _safe_name(raw_new)
    if safe_new == safe_old:
        return jsonify({"renamed": safe_old, "name": safe_old})

    dest = _reports_dir() / safe_new
    if dest.exists():
        return jsonify({"error": "A report with that name already exists"}), 409

    src.rename(dest)
    return jsonify({"renamed": safe_old, "name": safe_new})
