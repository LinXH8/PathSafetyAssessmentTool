"""Segment-level mutation routes: delete (single/batch), copy and collision check."""
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

from ._helpers import fail, get_ctx, with_project
from .image_utils import _get_project_source_folders



@bp.post("/<project_name>/segments/delete-batch")
@with_project
def delete_segments_batch(project_name, pm, proj):
    """
    Batch delete segments from a project at user-specified indices.
    POST body: { "indices": [0, 1, 5] }
    """
    data = request.get_json()
    if not data or "indices" not in data:
        abort(400, description="Missing 'indices' in request body")

    indices = data["indices"]
    if not isinstance(indices, list):
        abort(400, description="'indices' must be a list of integers")

    # Sort indices in descending order to avoid index shifting issues if we were doing iterative deletion
    # But for batch drop it doesn't matter as much, still good practice
    # Actuallly, df.drop handles list of indices regardless of order.
    # However, for consistency and logging:
    indices = sorted(indices, reverse=True)

    try:
        proj.delete_segments(indices)
    except Exception as e:
        traceback.print_exc()
        abort(500, description=f"Failed to delete segments: {e}")

    # Return updated metadata
    meta = proj.metadata.to_dict() if proj.metadata else {}
    return jsonify(meta)

@bp.post("/check-collisions")
def check_collisions():
    try:
        data = request.json
        source_name = urllib.parse.unquote(data.get("sourceProject"))
        target_name = data.get("targetProject")
        indices = data.get("indices", [])
        
        ctx = get_ctx()
        pm = ctx["pm"]
        
        source_proj = pm.project(source_name)
        
        # Check if target exists
        exists = any(p.metadata.project_name == target_name for p in pm.projects)
        
        if not exists:
            # New project, no collisions possible
            return jsonify({"ok": True, "collisions": []})
            
        target_proj = pm.project(target_name)
        collisions = source_proj.check_collisions(indices, target_proj)
        
        return jsonify({
            "ok": True,
            "collisions": collisions
        })
    except Exception as e:
        traceback.print_exc()
        return fail(f"Check collisions failed: {str(e)}", 500)


@bp.post("/copy-segments")
def copy_segments():
    """
    Copy segments from a source project to a target project.
    
    POST body:
    {
        "sourceProject": "Project A",
        "targetProject": "Project B",
        "indices": [0, 1, 2],
        "createTarget": boolean  # If true, create Project B if it doesn't exist (using template)
    }
    """
    try:
        data = request.json
        if not data:
            return fail("Missing request body", 400)
            
        source_name = urllib.parse.unquote(data.get("sourceProject"))
        target_name = data.get("targetProject") 
        # targetProject coming from frontend is just the name string (new or existing)
        
        indices = data.get("indices", [])
        create_target = data.get("createTarget", False)
        replace = data.get("replace", False)
        tags = data.get("tags", [])
        
        if not source_name or not target_name:
            return fail("Missing sourceProject or targetProject", 400)
            
        ctx = get_ctx()
        pm = ctx["pm"]
        
        # Get Source Project
        try:
            source_proj = pm.project(source_name)
        except KeyError:
            return fail(f"Source project '{source_name}' not found", 404)
            
        # Get or Create Target Project
        target_proj = None
        try:
            target_proj = pm.project(target_name)
        except KeyError:
            if create_target:
                # Create rudimentary/empty project
                # We can reuse create_project but we need geodataframe... 
                # Actually, copy_segments will populate it.
                # So we can create an empty structure manually or use create_project with empty data
                
                # Let's try to use pm.create_project with dummy data and then clear it?
                # Or better: just instantiate Project at new path and initialize empty
                
                target_path = pm.des_path / target_name
                if target_path.exists():
                     return fail(f"Target path {target_path} already exists but project not loaded? Restart server.", 500)
                
                # Initialize empty structure
                target_path.mkdir(parents=True)
                (target_path / global_var.PROJECT_IMAGES_FOLDER).mkdir()
                
                new_proj = Project(target_path)
                # Manually initialize metadata to avoid trying to read from non-existent file
                new_proj._metadata = serializer.ProjectMetadata()
                
                # Set basic metadata
                new_proj.metadata.project_name = target_name
                new_proj.metadata.date_created = datetime.datetime.now()
                new_proj.metadata.last_updated = datetime.datetime.now()
                new_proj.metadata.created_by = "copy_segments"
                new_proj.metadata.tags = tags
                new_proj.metadata.dataset = source_proj.metadata.dataset # Inherit dataset type?
                new_proj.metadata.source_folders = _get_project_source_folders(source_proj, pm)
                new_proj.metadata.size = 0
                
                # Initialize empty tables
                new_proj.geo_data = serializer.ProjectGeoData(0)
                new_proj.create_new_version() # Creates subfolder and empty tables
                
                # Save just to register it
                new_proj.save_all()
                new_proj.metadata.serialize(new_proj.project_path)
                pm.projects.append(new_proj)
                target_proj = new_proj
            else:
                 return fail(f"Target project '{target_name}' not found", 404)
        
        # Perform Copy
        count = source_proj.copy_segments(indices, target_proj, replace=replace)
        
        return jsonify({
            "ok": True, 
            "message": f"Copied {count} segments to {target_name}",
            "targetProject": target_name,
            "count": count
        })

    except Exception as e:
        traceback.print_exc()
        return fail(f"Copy segments failed: {str(e)}", 500)


@bp.delete("/<project_name>/segments/<int:segment_index>")
@with_project
def delete_segment(project_name: str, segment_index: int, pm, proj):
    """
    Delete a specific segment (point) from the project.
    """
    try:
        # Verify index is within bounds
        # Check latest attributes for size
        current_size = len(proj.latest().attributes.df)
        if segment_index < 0 or segment_index >= current_size:
            return fail(f"Segment index {segment_index} out of bounds (0-{current_size-1})", 400)

        proj.delete_segment(segment_index)
        
        return jsonify({
            "ok": True,
            "message": f"Segment {segment_index} deleted successfully",
            "remaining_segments": current_size - 1
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return fail(f"Error deleting segment: {str(e)}", 500)
