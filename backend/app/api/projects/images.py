"""Image-serving routes: project images, post-treatment photos and bulk download."""
from __future__ import annotations
from flask import (
    Blueprint,
    jsonify,
    request,
    send_from_directory,
    abort,
    send_file,
    make_response,
    current_app,
    Response,
    stream_with_context,
)
import zipfile
import io
import functools
import hashlib
import json
import re
from bisect import bisect_left
from pathlib import Path
import urllib.parse
import traceback
from . import bp
from werkzeug.utils import safe_join
import app.services.global_var as global_var
import pandas as pd
import os
import exifread
from shapely.geometry import Point,LineString,Polygon,box
import geopandas as gpd
import shutil
import datetime
import math
import time
import ipaddress
from app.services.cyclerap_scoring import calculate_cyclerap_score_native
# ---- init guards (thread-safe & error memo) ----
import threading
from werkzeug.exceptions import ServiceUnavailable


# —— Reuse your existing service layer —— #
from app.services.project_manager import project_manager, Project   # If the path is different, change to your real package path
import app.services.serializer as serializer
import app.services.cycleRAP_interface as CRI
import app.services.cycleRAP_VA as cycleRAP_VA

from pathlib import Path
from app.services import prediction as cv_pred
from app.services import gis_mapping as gis
import app.services.global_var as global_var

from ._helpers import fail, get_ctx
from .image_utils import _resolve_image_from_in



@bp.get("/<project_name>/images/<path:filename>")
def get_project_image(project_name: str, filename: str):
    """
    Return an image file for the given project.
    Checks project's local images/ dir first (legacy projects), then falls back
    to resolving the file directly from in/ (new/migrated projects).
    GET /api/projects/<project_name>/images/<filename>
    """
    ctx = get_ctx()
    pm = ctx["pm"]

    # Try legacy project-local images/ directory first
    images_dir: Path = (pm.des_path / project_name / global_var.PROJECT_IMAGES_FOLDER).resolve()
    if images_dir.is_dir():
        safe_path = safe_join(str(images_dir), filename)
        if safe_path is not None:
            file_path = Path(safe_path).resolve()
            if str(file_path).startswith(str(images_dir)) and file_path.is_file():
                resp = send_from_directory(images_dir, file_path.name, conditional=True)
                resp.headers["Cache-Control"] = "public, max-age=86400"
                return resp

    # Fall back to in/ for new or migrated projects
    in_file = _resolve_image_from_in(pm, project_name, filename)
    if in_file is not None:
        resp = send_from_directory(str(in_file.parent), in_file.name, conditional=True)
        resp.headers["Cache-Control"] = "public, max-age=86400"
        return resp

    abort(404, description="Image not found")

@bp.post("/<project_name>/segments/<int:segment_index>/post-treatment-image")
def upload_post_treatment_image(project_name: str, segment_index: int):
    ctx = get_ctx()
    pm = ctx["pm"]
    
    if "image" not in request.files:
        abort(400, description="No image provided")
        
    file = request.files["image"]
    if file.filename == "":
        abort(400, description="No selected file")
        
    post_treatment_dir: Path = (pm.des_path / project_name / "post_treatment_images").resolve()
    post_treatment_dir.mkdir(parents=True, exist_ok=True)
    
    file_path = post_treatment_dir / f"{segment_index}.png"
    file.save(str(file_path))
    
    return jsonify({"message": "Success", "path": f"/api/projects/{urllib.parse.quote(project_name)}/segments/{segment_index}/post-treatment-image"}), 200

@bp.get("/<project_name>/segments/<int:segment_index>/post-treatment-image")
def get_post_treatment_image(project_name: str, segment_index: int):
    ctx = get_ctx()
    pm = ctx["pm"]
    
    post_treatment_dir: Path = (pm.des_path / project_name / "post_treatment_images").resolve()
    file_path = post_treatment_dir / f"{segment_index}.png"
    
    if not file_path.exists() or not file_path.is_file():
        return jsonify({"exists": False, "message": "Image not found"}), 200
        
    resp = send_from_directory(post_treatment_dir, file_path.name, conditional=True)
    resp.headers["Cache-Control"] = "no-store"
    return resp

@bp.delete("/<project_name>/segments/<int:segment_index>/post-treatment-image")
def delete_post_treatment_image(project_name: str, segment_index: int):
    ctx = get_ctx()
    pm = ctx["pm"]
    
    post_treatment_dir: Path = (pm.des_path / project_name / "post_treatment_images").resolve()
    file_path = post_treatment_dir / f"{segment_index}.png"
    
    if file_path.exists() and file_path.is_file():
        file_path.unlink()
        
    return jsonify({"message": "Success"}), 200

@bp.post("/download-images")
def download_images():
    """
    Generate a ZIP file containing filtered images for multiple projects.
    
    Request body:
        {
            "projects": {
                "ProjectName1": ["img1.jpg", "img2.jpg", ...],
                "ProjectName2": ["imgA.jpg", "imgB.jpg", ...],
                ...
            }
        }
    """
    data = request.get_json() or {}
    projects_images = data.get("projects", {})

    if not projects_images:
        return fail("No images specified", 400)
    
    if not isinstance(projects_images, dict):
        return fail("projects must be a dictionary of project_name -> image_list", 400)

    ctx = get_ctx()
    pm = ctx["pm"]
    
    # Create in-memory zip file
    memory_file = io.BytesIO()
    
    try:
        with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
            for project_name, image_files in projects_images.items():
                if not image_files or not isinstance(image_files, list):
                    continue
                
                # Check dir path without calling pm.project() which might be slow or fail if race
                # But safer to just construct path if we trust pm.des_path
                # project_manager usually ensures des_path is valid
                
                try:
                    images_dir = (pm.des_path / project_name / global_var.PROJECT_IMAGES_FOLDER).resolve()

                    for img_filename in image_files:
                        img_filename = str(img_filename)
                        # Basic security check - prevent traversal
                        if ".." in img_filename or "/" in img_filename or "\\" in img_filename:
                            continue

                        # Try legacy images/ dir first, then fall back to in/
                        img_path = images_dir / img_filename
                        if not (img_path.exists() and img_path.is_file()):
                            in_file = _resolve_image_from_in(pm, project_name, img_filename)
                            if in_file is None:
                                continue
                            img_path = in_file

                        zip_path = f"{project_name} images/{img_filename}"
                        zf.write(str(img_path), zip_path)

                except Exception:
                    continue
                    
    except Exception as e:
        return fail(f"Failed to create zip file: {str(e)}", 500)
        
    memory_file.seek(0)
    
    return send_file(
        memory_file,
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"filtered_images_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
    )
