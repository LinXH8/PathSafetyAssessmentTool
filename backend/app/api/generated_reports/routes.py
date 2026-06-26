import datetime
import re
from pathlib import Path

from flask import Blueprint, jsonify, request, send_from_directory

bp = Blueprint("generated_reports", __name__)

# <project_root>/Generated Reports/
# __file__ = backend/app/api/generated_reports/routes.py
# parents[4] = PathSafetyAssessmentTool/ (project root)
REPORTS_DIR = (Path(__file__).parents[4] / "Generated Reports").resolve()


def _ensure_dir() -> None:
    REPORTS_DIR.mkdir(exist_ok=True)


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
    for f in REPORTS_DIR.iterdir():
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
    dest = REPORTS_DIR / filename
    file.save(dest)
    return jsonify({"saved": filename})


@bp.route("/<path:filename>", methods=["GET"])
def serve_report(filename: str):
    safe = _safe_name(Path(filename).name)
    target = REPORTS_DIR / safe
    if not target.exists() or not target.is_file():
        return jsonify({"error": "Not found"}), 404
    resp = send_from_directory(
        REPORTS_DIR,
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
    target = REPORTS_DIR / safe
    if not target.exists() or not target.is_file():
        return jsonify({"error": "Not found"}), 404
    target.unlink()
    return jsonify({"deleted": safe})
