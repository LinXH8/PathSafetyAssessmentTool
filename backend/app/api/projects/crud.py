"""Project lifecycle CRUD, attributes, scoring and results routes.

List/get/create/delete/patch projects, read/write attributes, custom attribute
options, attribute mappings, score calculation and results retrieval."""
from __future__ import annotations
import logging
logger = logging.getLogger(__name__)
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

from ._helpers import df_to_records, fail, get_ctx, ok, with_project
from .gradient import GRADIENT_STATUS_FIELD, GRADIENT_STATUS_NOT_ASSESSED, GRADIENT_STATUS_NO_LIDAR_RESULT, _GRADIENT_CACHE_STATE_PROFILE_AVAILABLE, _PROJECT_GRADIENT_CACHE_STATE, _get_project_gradient_mapping
from .image_utils import _get_image_date_range, _get_project_source_folders, _migrate_legacy_images, apply_image_namespaces, build_project_geo_data, make_image_namespace
from . import _helpers




@bp.get("")
def list_projects():
    """List projects with metadata including tags, date_created, last_updated, and verification segment counts."""
    try:
        ctx = get_ctx()
    except Exception as exc:
        return jsonify({"error": f"Backend initialisation failed: {exc}"}), 500
    pm = ctx["pm"]
    names = pm.list_names()

    # Build list with metadata
    projects = []
    for name in names:
        try:
            proj = pm.project(name)
            source_folders = _get_project_source_folders(proj, pm)
            # Get total segment count from latest version's attributes
            ver = proj.latest()
            total_segments = 0
            if ver.attributes and hasattr(ver.attributes, 'df'):
                df = ver.attributes.df
                if df is not None and len(df) > 0:
                    total_segments = len(df)

            project_data = {
                "name": name,
                "tags": proj.metadata.tags or [],
                "dataset": getattr(proj.metadata, 'dataset', None),
                "source_folders": source_folders,
                "verified": getattr(proj.metadata, 'verified', False),
                "verified_segment_count": getattr(proj.metadata, 'verified_segment_count', 0),
                "autocoded_segment_count": getattr(proj.metadata, 'autocoded_segment_count', 0),
                "total_segments": total_segments
            }

            # Add date_created if available
            if hasattr(proj.metadata, 'date_created') and proj.metadata.date_created:
                project_data["date_created"] = proj.metadata.date_created.isoformat()

            # Add last_updated if available
            if hasattr(proj.metadata, 'last_updated') and proj.metadata.last_updated:
                project_data["last_updated"] = proj.metadata.last_updated.isoformat()

            projects.append(project_data)
        except Exception as e:
            # If metadata fails to load, return project with empty tags and no dates
            import traceback
            traceback.print_exc()
            projects.append({
                "name": name,
                "tags": [],
                "dataset": None,
                "source_folders": [],
                "verified": False,
                "verified_segment_count": 0,
                "autocoded_segment_count": 0,
                "total_segments": 0
            })

    return jsonify({"projects": projects})

@bp.get("/<project_name>")
@with_project(version=True)
def get_project(project_name: str, pm, proj, ver):
    """Read project metadata and available versions (read-only)."""
    return jsonify({
        "name": proj.metadata.project_name,
        "versions": [v.path.name for v in proj.versions],
        "latest": ver.path.name
    })

@bp.get("/<project_name>/metadata")
@with_project
def get_project_metadata(project_name: str, pm, proj):
    """Get project metadata including verified status and verified segment count."""
    return jsonify({
        "name": proj.metadata.project_name,
        "tags": proj.metadata.tags or [],
        "dataset": getattr(proj.metadata, 'dataset', None),
        "source_folders": _get_project_source_folders(proj, pm),
        "verified": getattr(proj.metadata, 'verified', False),
        "verified_segment_count": getattr(proj.metadata, 'verified_segment_count', 0),
        "autocoded_segment_count": getattr(proj.metadata, 'autocoded_segment_count', 0),
        "path_key": getattr(proj.metadata, 'path_key', None),
        "date_created": proj.metadata.date_created.isoformat() if hasattr(proj.metadata, 'date_created') and proj.metadata.date_created else None,
        "last_updated": proj.metadata.last_updated.isoformat() if hasattr(proj.metadata, 'last_updated') and proj.metadata.last_updated else None,
    })


@bp.get("/<project_name>/image-date-range")
@with_project
def get_image_date_range(project_name: str, pm, proj):
    """Return the earliest and latest image capture dates for a project.

    Reads EXIF DateTimeOriginal from each image; falls back to file mtime when
    EXIF is absent. Covers both images/ folder (legacy) and in/ source folders
    (newer projects referenced via geo_data Image Reference column).
    """
    result = _get_image_date_range(proj, pm)
    if result is None:
        return jsonify({"earliest": None, "latest": None})
    return jsonify(result)


# Retired FO Type finer-attribute labels → current names. Applied at read time so
# existing projects (including those created before the rename, on any device) always
# serve the current labels to every front-end surface without needing a re-save.
_FO_TYPE_RENAMES = {
    "Pillar": "Covered Linkway Pole",
    "Fence": "Railing",
    "Bollards": "Bollard",
    "Billboards": "Billboard",
    "Sign Poles": "Sign Pole",
}

_NFO_TYPE_RENAMES = {
    "Bins": "Bin",
}


def _normalize_fo_type(value):
    """Rewrite legacy FO Type labels. FO Type is a comma-separated multi-select,
    so each token is migrated independently. Non-string/empty values pass through."""
    if not isinstance(value, str) or not value.strip():
        return value
    parts = [p.strip() for p in value.split(",") if p.strip()]
    return ", ".join(_FO_TYPE_RENAMES.get(p, p) for p in parts)


def _normalize_nfo_type(value):
    """Rewrite legacy NFO Type labels. NFO Type is a comma-separated multi-select,
    so each token is migrated independently. Non-string/empty values pass through."""
    if not isinstance(value, str) or not value.strip():
        return value
    parts = [p.strip() for p in value.split(",") if p.strip()]
    return ", ".join(_NFO_TYPE_RENAMES.get(p, p) for p in parts)


@bp.get("/<project_name>/versions/latest/attributes")
@with_project(version=True)
def get_latest_attributes(project_name: str, pm, proj, ver):
    """Return the latest attributes.csv (converted to JSON for front-end table rendering).

    Also includes calculated band values (VB Band, BB Band, SB Band, BP Band) if they exist
    in the results, so filtering can use these calculated values.
    """
    attrs_df = ver.attributes.df
    attrs_copied = False

    # If results exist, merge the band values into attributes for filtering capability
    if ver.results and ver.results.df is not None and len(ver.results.df) > 0:
        results_df = ver.results.df
        band_columns = ["VB Band", "BB Band", "SB Band", "BP Band", "Overall Risk Level Band"]

        # Only include band columns that exist in results
        available_bands = [col for col in band_columns if col in results_df.columns]

        if available_bands and len(attrs_df) == len(results_df):
            attrs_df = attrs_df.copy()
            attrs_copied = True
            for col in available_bands:
                attrs_df[col] = results_df[col].values

    # Normalise gradient status: within a project, "Not assessed yet" and a real
    # gradient value must never coexist.  If the project has a matched gradient
    # profile (mapping non-empty), every segment that still has no grade should
    # display "N/A (no LiDAR result)" — not "Not assessed yet" — regardless of
    # whether it has been through the coding workflow yet.
    mapping = _get_project_gradient_mapping(project_name)
    profile_found = bool(mapping) or (
        _PROJECT_GRADIENT_CACHE_STATE.get(project_name) == _GRADIENT_CACHE_STATE_PROFILE_AVAILABLE
    )
    if profile_found:
        has_grade_col = "Grade" in attrs_df.columns
        has_status_col = GRADIENT_STATUS_FIELD in attrs_df.columns
        if has_grade_col or has_status_col:
            if not attrs_copied:
                attrs_df = attrs_df.copy()
                attrs_copied = True
            no_grade = attrs_df["Grade"].isna() if has_grade_col else pd.Series(True, index=attrs_df.index)
            if has_status_col:
                stale_status = attrs_df[GRADIENT_STATUS_FIELD].isna() | (
                    attrs_df[GRADIENT_STATUS_FIELD] == GRADIENT_STATUS_NOT_ASSESSED
                )
            else:
                attrs_df[GRADIENT_STATUS_FIELD] = None
                stale_status = pd.Series(True, index=attrs_df.index)
            serializer.set_masked(attrs_df, no_grade & stale_status, GRADIENT_STATUS_FIELD, GRADIENT_STATUS_NO_LIDAR_RESULT)

    # Migrate retired FO/NFO Type labels for all consumers.
    if "FO Type" in attrs_df.columns:
        if not attrs_copied:
            attrs_df = attrs_df.copy()
            attrs_copied = True
        attrs_df["FO Type"] = attrs_df["FO Type"].map(_normalize_fo_type)

    if "NFO Type" in attrs_df.columns:
        if not attrs_copied:
            attrs_df = attrs_df.copy()
            attrs_copied = True
        attrs_df["NFO Type"] = attrs_df["NFO Type"].map(_normalize_nfo_type)

    return jsonify({"rows": df_to_records(attrs_df)})


@bp.get("/<project_name>/geodata")
@with_project
def get_geodata(project_name: str, pm, proj):
    """Return the project's GeoData (GeoJSON FeatureCollection)."""
    import json
    _migrate_legacy_images(pm, project_name, proj)
    gdf = proj.geo_data.df  # GeoPandas GeoDataFrame

    # GeoDataFrame -> GeoJSON string, then to dict for jsonify-friendly output
    geojson_obj = json.loads(gdf.to_json())
    return jsonify(geojson_obj)


@bp.get("/attribute-mappings")
def get_attribute_mappings():
    """
    Return field mappings for Attributes (numeric -> text), e.g.:
    {
      "Area type": {"1":"Urban","2":"Suburban","3":"Rural","4":"Industrial"},
      "Facility Type": {"1":"Footpath", "2":"Shared Path", ...},
      ...
    }
    Only fields with enumerations are included; continuous values (e.g., AADT, speed) are excluded.
    """
    mappings = {}
    for field, mapping in (serializer.Attributes.CHOICES or {}).items():
        if not mapping:  # None: indicates the field is not an enumeration
            continue
        # Reverse mapping: number -> label; use str keys for front-end convenience
        reverse = {str(code): label for (label, code) in mapping.items()}
        mappings[field] = reverse
    return jsonify(mappings)

def _get_custom_attr_options_file() -> Path:
    backend_root = Path(__file__).resolve().parents[3]
    return backend_root / "data" / "custom_attribute_options.json"

@bp.get("/custom-attribute-options")
def get_custom_attribute_options():
    try:
        path = _get_custom_attr_options_file()
        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                return jsonify(json.load(f))
    except Exception as e:
        logger.error(f"Error loading custom attribute options: {e}")
    return jsonify({})

@bp.put("/custom-attribute-options")
def update_custom_attribute_options():
    try:
        data = request.json or {}
        field = data.get("field")
        options = data.get("options", [])
        if not field:
            return fail("Field is required", 400)
            
        path = _get_custom_attr_options_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        
        current_options = {}
        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                try:
                    current_options = json.load(f)
                except Exception:
                    pass
                
        # Append and deduplicate
        existing = current_options.get(field, [])
        combined = list(dict.fromkeys(existing + options)) # Preserve order, remove duplicates
        current_options[field] = combined
        
        with open(path, "w", encoding="utf-8") as f:
            json.dump(current_options, f, indent=2)
            
        return ok({"success": True})
    except Exception as e:
        logger.error(f"Error updating custom attribute options: {e}")
        return fail("Failed to update options", 500)


def _convert_attribute_types(df: pd.DataFrame) -> pd.DataFrame:
    """
    Convert attribute values to appropriate types for scoring.

    Frontend sends all values as strings via JSON. This function converts them to:
    - int for lookup-based attributes (most of them)
    - float for numeric attributes (ROAD_AADT, speeds)
    """
    df_copy = df.copy()

    # Attributes that should be integers (lookup table keys)
    # These are used for lookups in the scoring algorithm
    integer_attrs = [
        'Area type',
        'Facility Type',
        'Facility access',
        'Line of Sight',
        'Loose or slippery surface',
        'Tram or Train Rails',
        'Major Surface Deformation or Drain Opening',
        'Fixed Obstacle on Facility',
        'Non-Fixed Obstacle on Facility',
        'Delineation',
        'Light Segregation',
        'Facility Width per Direction',
        'Flow Direction',
        'Width Restriction',
        'Adjacent Road Lane 0-1m',
        'Adjacent Vehicle Parking 0-1m',
        'Adjacent Severe Hazard 0-1m',
        'Adjacent object or level change 0-1m',
        'Adjacent Sidewalk 0-1m',
        'Adjacent Road Lane 1-3m',
        'Adjacent Vehicle Parking 1-3m',
        'Adjacent Severe Hazard 1-3m',
        'Adjacent object or level change 1-3m',
        'Adjacent Sidewalk 1-3m',
        'Grade',
        'Curvature',
        'Street Lighting',
        'Pedestrian Crossing',
        'Intersecting Bicycle Facility',
        'Intersection Approach',
        'Intersection or Road Crossing',
        'Crossing Facility',
        'Number of lanes – adjacent road',
        'Number of lanes – intersecting road',
        'Property Access',
        'Peak pedestrian flow along or across facility',
        'Peak bicycle/LV traffic flow',
        'Observed proportion of cargo bikes and mopeds',
        'Bicycle/LV speed – average',
        'Bicycle/LV speed differential',
        'Heavy vehicle flow',
    ]

    # Attributes that should be floats (numeric values)
    float_attrs = ['Road AADT', 'Road speed limit', 'Road operating speed (mean)']

    for col in df_copy.columns:
        if col in integer_attrs:
            # Convert string to int, handling None/NaN values
            df_copy[col] = pd.to_numeric(df_copy[col], errors='coerce').fillna(1).astype(int)
        elif col in float_attrs:
            # Convert string to float, handling None/NaN values
            if col == 'Road AADT':
                df_copy[col] = pd.to_numeric(df_copy[col], errors='coerce').fillna(6000)
            elif col == 'Road speed limit':
                # Handle "NA" as a valid value; convert numeric strings to float, use "NA" as fallback for empty/null
                df_copy[col] = df_copy[col].apply(
                    lambda x: x if x == 'NA' else (pd.to_numeric(x, errors='coerce') if pd.notna(x) else 'NA')
                ).fillna('NA')
            else:
                df_copy[col] = pd.to_numeric(df_copy[col], errors='coerce').fillna(50)

    return df_copy


@bp.post("/<project_name>/score")
@with_project(version=True)
def calculate_score(project_name: str, pm, proj, ver):
    """
    Calculate cycleRAP scores using native Python implementation (no Excel dependency).

    This endpoint:
    1) Loads the project's latest attributes DataFrame from disk
    2) Optionally accepts modified attributes from the request body
    3) Calculates BB, BP, SB, VB, and composite Overall Risk Levels
    4) Saves the results back to disk
    5) Returns the calculated scores to the frontend

    Request body (optional):
        {
            "attributes": [
                {"field1": value1, "field2": value2, ...},  // Row 1
                {"field1": value1, "field2": value2, ...},  // Row 2
                ...
            ]
        }

    Response:
        {
            "ok": true,
            "result_rows": [
                {
                    "BB": 60.0,
                    "BB Band": 3,
                    "BP": 0.0,
                    "BP Band": 0,
                    "SB": 80.0,
                    "SB Band": 4,
                    "VB": 85.0,
                    "VB Band": 4,
                    "Overall Risk Level": 61.5,
                    "CycleRAP score Band": 3
                },
                ...
            ]
        }

    NOTE: The scoring algorithm in cyclerap_scoring.py is currently a MOCK implementation.
          Replace with actual cycleRAP formulas when available.
    """
    # Get project context and latest version
    ctx = get_ctx()
    proj: Project = ctx["pm"].project(project_name)
    ver = proj.latest()

    # Load attributes from disk (or use provided attributes from request)
    attrs_df = ver.attributes.df
    payload = request.get_json(silent=True) or {}
    is_single_row_calculation = False

    if "attributes" in payload:
        # Frontend sent modified attributes - use those instead
        attrs_df = serializer.pd.DataFrame(payload["attributes"])
        # Convert string values to appropriate types for scoring
        attrs_df = _convert_attribute_types(attrs_df)
        # Check if this is a single row calculation (for real-time score updates)
        is_single_row_calculation = len(payload["attributes"]) == 1



    # ==========================================
    # MAIN CALCULATION: Native Python scoring
    # ==========================================
    # This replaces the old Excel COM automation approach:
    # OLD: results_df = CRI.cycleRAP_interface.calculate_cycleRAP_score(attrs)
    # NEW: Cross-platform native Python implementation
    results_df = calculate_cyclerap_score_native(attrs_df)



    # ==========================================
    # PERSIST RESULTS: Save to disk (only if full calculation)
    # ==========================================
    # Only save to disk if this is a full project calculation, not a single-row real-time update
    if not is_single_row_calculation:
        ver._results = serializer.Results()
        ver.results.df = results_df
        proj.save_all()


        # Update last_updated
        proj.metadata.last_updated = datetime.datetime.now()
        proj.metadata.serialize(proj.project_path)
    # Return results to frontend
    return jsonify({"ok": True, "result_rows": df_to_records(results_df)})

@bp.get("/<project_name>/results")
@with_project(version=True)
def get_results(project_name: str, pm, proj, ver):
    """
    Retrieve the latest Overall Risk Levels for a project.
    Returns the calculated results from the latest version.
    """
    try:

        # Always recompute results on load so the v2.13 scoring formula picks up
        # any stale per-segment scores written under earlier model versions.
        if ver.attributes and ver.attributes.df is not None and len(ver.attributes.df) > 0:
            res_df = calculate_cyclerap_score_native(ver.attributes.df)
            if ver.results is not None:
                stale = ver.results.df is None or not res_df.equals(ver.results.df)
                if stale:
                    ver.results.df = res_df
                    ver.results.df_dirty = True
                    proj.save_all()
            return jsonify({
                "ok": True,
                "result_rows": df_to_records(res_df)
            })
        else:
            # No attributes coded yet → nothing to score
            return jsonify({
                "ok": True,
                "result_rows": []
            })
    except Exception as e:
        return jsonify({
            "ok": False,
            "error": str(e)
        }), 500


@bp.put("/<string:name>/attributes")
@with_project(version=True)
def update_attributes(name: str, pm, proj, ver):
    data = request.get_json(silent=True) or {}
    rows = data.get("rows")
    if not isinstance(rows, list):
        return fail("Invalid payload", 400)

    # Convert incoming rows to DataFrame
    new_attrs_df = pd.DataFrame(rows)

    # --- INJECTED LOGIC: Calculate Scores & Persist Bands ---
    try:
        # 1. Convert types for scoring
        scoring_df = _convert_attribute_types(new_attrs_df)
        
        # 2. Calculate scores (native Python implementation)
        results_df = calculate_cyclerap_score_native(scoring_df)

        # --- FIX: Persist numeric scores to results.csv ---
        # The previous code calculated scores but only used them to update "Bands" in attributes.csv.
        # It failed to save the actual numeric scores to results.csv, causing the frontend to show old data.
        if ver._results is None:
            ver._results = serializer.Results()
        
        ver.results.df = results_df
             
        # --------------------------------------------------

        # 3. Extract Band columns
        # We want to keep "Overall Risk Level Band" and individual bands like "BB Band", "VB Band", etc.
        band_cols = [col for col in results_df.columns if col.endswith(" Band")]
        
        # 4. Merge/Overwrite bands in the main attributes DataFrame
        # We assume strict row alignment index-by-index (0 to N-1)
        if len(results_df) == len(new_attrs_df):
            for col in band_cols:
                new_attrs_df[col] = results_df[col].values
        else:
            pass  # row count mismatch: skip band persistence
            
    except Exception:
        traceback.print_exc()
        # Non-blocking: proceed to save attributes even if scoring fails
    # --------------------------------------------------------

    # Write to the latest version
    ver.attributes.df = new_attrs_df
    ver.attributes.df_dirty = True
    proj.save_all()  # If a day rolls over, a new version may be created

    # Update last_updated
    proj.metadata.last_updated = datetime.datetime.now()
    proj.metadata.serialize(proj.project_path)

    return ok({"ok": True})


@bp.post("/folders")
def create_project_from_folder():
    """
    Create a new project from one or more input directories.
    Body: { "project_name": "My Project", "folder_name": "SomeFolder", "tags": ["tag1", "tag2"] }
    or   { "project_name": "My Project", "folder_names": ["Road A", "Road B"], "tags": ["tag1", "tag2"] }
    """
    data = request.get_json(silent=True) or {}
    project_name = (data.get("project_name") or "").strip()
    folder_name = data.get("folder_name")
    folder_names = data.get("folder_names")
    tags = data.get("tags", [])

    if not project_name:
        return fail("project_name is required", 400)
    if "_" in project_name:
        return fail("Project name cannot contain underscores (_)", 400)

    # Validate tags is a list
    if not isinstance(tags, list):
        return fail("tags must be an array", 400)

    if folder_names is None:
        folder_names = [folder_name] if folder_name else []
    elif not isinstance(folder_names, list):
        return fail("folder_names must be an array", 400)

    normalized_folder_names = []
    seen_folder_names = set()
    for raw_name in folder_names:
        if not isinstance(raw_name, str):
            return fail("folder_names must contain strings", 400)
        clean_name = raw_name.strip()
        if not clean_name or clean_name in seen_folder_names:
            continue
        normalized_folder_names.append(clean_name)
        seen_folder_names.add(clean_name)

    if not normalized_folder_names:
        return fail("folder_name or folder_names is required", 400)

    # Parse optional selection geometry: GeoJSON "selection_geometry" (sent by frontend)
    # or legacy flat "polygon" list-of-coords.  No geometry = no spatial filter.
    selection_polygon = None
    sel = data.get("selection_geometry")
    polygon_coords = data.get("polygon")
    if sel:
        try:
            geom_type = sel.get("type", "")
            coords = sel.get("coordinates", [])
            if geom_type == "Polygon":
                selection_polygon = Polygon(coords[0]).buffer(0)
            elif geom_type == "MultiPolygon":
                from shapely.ops import unary_union as _unary_union
                parts = [Polygon(ring[0]).buffer(0) for ring in coords]
                selection_polygon = _unary_union(parts)
            elif geom_type in ("LineString", "MultiLineString"):
                from shapely.geometry import LineString as _Line
                from shapely.ops import unary_union as _unary_union
                if geom_type == "LineString":
                    selection_polygon = _Line(coords).buffer(0.0005)
                else:
                    lines = [_Line(line) for line in coords]
                    selection_polygon = _unary_union(lines).buffer(0.0005)
            else:
                return fail(f"Unsupported selection_geometry type: {geom_type}", 400)
            if not selection_polygon.is_valid:
                selection_polygon = selection_polygon.buffer(0)
        except Exception as e:
            return fail(f"Invalid selection_geometry: {e}", 400)
    elif polygon_coords is not None:
        if not isinstance(polygon_coords, list) or len(polygon_coords) < 3:
            return fail("polygon must have at least 3 vertices", 400)
        try:
            ring = [(pt[1], pt[0]) for pt in polygon_coords]
            selection_polygon = Polygon(ring)
            if not selection_polygon.is_valid:
                selection_polygon = selection_polygon.buffer(0)
        except Exception as e:
            return fail(f"Invalid polygon: {e}", 400)

    ctx = get_ctx()                 # ← Use your existing get_ctx()
    pm = ctx["pm"]
    in_path: Path = pm.in_path
    out_path: Path = pm.des_path

    project_path = out_path / project_name
    if project_path.exists():
        return fail("Project already exists", 409)

    src_dirs = []
    missing_folders = []
    for selected_folder_name in normalized_folder_names:
        src_dir = in_path / selected_folder_name
        if not src_dir.exists() or not src_dir.is_dir():
            missing_folders.append(selected_folder_name)
        else:
            src_dirs.append((selected_folder_name, src_dir))

    if missing_folders:
        return fail(f"folders not found: {', '.join(missing_folders)}", 404)

    project_path.mkdir(parents=True, exist_ok=True)

    extracted_geo_data_parts = []
    use_image_prefix = len(src_dirs) > 1
    skipped_sources = []

    try:
        for selected_folder_name, src_dir in src_dirs:
            extracted_geo_data = build_project_geo_data(src_dir, selection_polygon)
            if extracted_geo_data.empty:
                skipped_sources.append(selected_folder_name)
                continue
            filename_prefix = make_image_namespace(selected_folder_name) if use_image_prefix else None
            extracted_geo_data = apply_image_namespaces(extracted_geo_data, filename_prefix)
            extracted_geo_data_parts.append(extracted_geo_data)
    except Exception as e:
        shutil.rmtree(project_path, ignore_errors=True)
        return fail(str(e), 400)

    if not extracted_geo_data_parts:
        shutil.rmtree(project_path, ignore_errors=True)
        return fail("No geotagged images found inside the selected polygon for the chosen roads", 400)

    combined_geo_data = gpd.GeoDataFrame(
        pd.concat(extracted_geo_data_parts, ignore_index=True),
        geometry="geometry",
        crs=extracted_geo_data_parts[0].crs,
    )

    dataset_name = normalized_folder_names[0] if len(normalized_folder_names) == 1 else "MULTI_FOLDER_SELECTION"
    try:
        pm.create_project(
            project_name,
            combined_geo_data,
            dataset_name,
            tags=tags,
            source_folders=normalized_folder_names,
        )
    except Exception as e:
        shutil.rmtree(project_path, ignore_errors=True)
        return fail(f"Failed to initialise project: {e}", 500)

    # Auto-prune of raw survey frames after create is DISABLED. Installer-seeded
    # folders keep every photo as a segment (see _folder_is_pruned in image_utils), so
    # pruning would only risk deleting images the user wants to keep. Left as an
    # explicit no-op (rather than removed) so it is easy to re-enable if disk pressure
    # ever makes it necessary.
    pruned_summary: list = []

    return ok({
        "ok": True,
        "name": project_name,
        "source_count": len(normalized_folder_names),
        "skipped_sources": skipped_sources,
        "pruned_sources": pruned_summary,
    })

@bp.delete("/<project_name>")
def delete_project(project_name: str):
    """
    Delete an entire project (in-memory list + on-disk directory):
    DELETE /api/projects/<project_name>
    """
    ctx = get_ctx()
    pm = ctx["pm"]

    try:
        pm.delete_project(project_name)  # Calls Project._delete() to remove the directory and drop from the list
        return ok({"ok": True, "name": project_name})
    except KeyError:
        return fail("Project not found", 404)
    except Exception as e:
        traceback.print_exc()
        return fail(f"Delete failed: {e}", 500)

@bp.patch("/<project_name>")
def update_project_metadata(project_name: str):
    """
    Update project metadata (name, tags, path_key, verified status, and/or counters):
    PATCH /api/projects/<project_name>
    Body: { "new_name": "...", "tags": [...], "path_key": "...", "verified": true/false, "verified_segment_count": 0 }
    """
    ctx = get_ctx()
    pm = ctx["pm"]

    try:
        payload = request.get_json(force=True, silent=True) or {}
        new_name = payload.get("new_name")
        new_tags = payload.get("tags")
        new_path_key = payload.get("path_key")

        # While YOLO inference is running, skip all disk I/O to avoid holding
        # the GIL and slowing down inference (10-20x overhead observed).
        # Name renames are never batched by the frontend during autocode, so
        # it is safe to defer counter/tag updates until inference finishes.
        # The payload is queued and flushed automatically by exit_inference()
        # the moment _INFERENCE_DEPTH returns to 0, so the update is never lost.
        if _helpers._INFERENCE_DEPTH > 0 and new_name is None:
            _helpers._PENDING_METADATA_UPDATES.setdefault(project_name, {}).update(payload)
            return ok({"ok": True, "deferred": True})

        # Get the project
        try:
            proj = pm.project(project_name)
        except KeyError:
            return fail("Project not found", 404)

        if new_tags is not None and not isinstance(new_tags, list):
            return fail("Tags must be an array", 400)
        if new_path_key is not None and not isinstance(new_path_key, str):
            return fail("path_key must be a string", 400)

        metadata_updated = _helpers.apply_metadata_fields(proj, payload)

        # Serialize once after all metadata updates
        if metadata_updated:
            proj.metadata.last_updated = datetime.datetime.now()
            proj.metadata.serialize(proj.project_path)

        # Update name if provided (requires renaming directory)
        if new_name and new_name != project_name:
            if not new_name.strip():
                return fail("New name cannot be empty", 400)

            # Check if new name already exists
            if new_name in pm.list_names():
                return fail(f"Project '{new_name}' already exists", 400)

            # Rename the directory
            old_path = proj.project_path
            new_path = old_path.parent / new_name

            try:
                old_path.rename(new_path)

                # Rename images inside the project folder
                try:
                    import re
                    images_dir = new_path / global_var.PROJECT_IMAGES_FOLDER
                    if images_dir.exists() and images_dir.is_dir():
                        for img_file in images_dir.iterdir():
                            if img_file.is_file():
                                match = re.search(r"(?:^|_)(Cam\d+.*)", img_file.name, re.IGNORECASE)
                                if match:
                                    suffix = match.group(1)
                                    new_filename = f"{new_name}_{suffix}"
                                    
                                    if new_filename != img_file.name:
                                        img_file.rename(images_dir / new_filename)
                except Exception:
                    pass

                # Update metadata
                proj.project_path = new_path
                proj.metadata.project_name = new_name

                # --- Update Internal Paths & Image References ---
                # 1. Update paths for all versions so they point to the new directory
                if proj.versions:
                    for v in proj.versions:
                        # v.path is absolute, so we must rebase it to the new project path
                        # Current v.path: .../OldName/versions/YYYYMMDD
                        # New v.path:     .../NewName/versions/YYYYMMDD
                        v.path = new_path / "versions" / v.path.name

                # 2. Update Image References in DataFrames to match new filenames
                def update_image_ref_in_df(df, col_name):
                    if col_name not in df.columns:
                        return False
                    
                    def _update_ref(ref):
                        if not isinstance(ref, str): return ref
                        # Use same regex as file renaming
                        match = re.search(r"(?:^|_)(Cam\d+.*)", ref, re.IGNORECASE)
                        if match:
                            suffix = match.group(1)
                            new_ref = f"{new_name}_{suffix}"
                            return new_ref
                        return ref
                    
                    # Check if any change is needed to avoid unnecessary writes
                    # But easiest is just to apply
                    df[col_name] = df[col_name].apply(_update_ref)
                    return True

                # Only update Image References when a legacy images/ dir exists.
                # New projects reference in/ directly; their refs carry no project-name
                # prefix and must not be rewritten.
                if (new_path / global_var.PROJECT_IMAGES_FOLDER).is_dir():
                    try:
                        # A. Attributes (Latest Version)
                        latest_ver = proj.latest()
                        if update_image_ref_in_df(latest_ver.attributes.df, "Image reference"):
                             latest_ver.attributes.df_dirty = True

                        # B. Treatment (Latest Version)
                        if update_image_ref_in_df(latest_ver.treatment.df, "Image Reference"):
                            latest_ver.treatment.df_dirty = True

                        # C. Geo Data (Project Level)
                        if update_image_ref_in_df(proj.geo_data.df, "Image Reference"):
                            proj.geo_data.df_dirty = True

                        # Save all changes
                        proj.save_all()

                    except Exception:
                        traceback.print_exc()

                proj.metadata.last_updated = datetime.datetime.now()
                proj.metadata.serialize(new_path)

                # Reload the project list to reflect the changes
                pm.projects = [
                    Project(p) for p in pm.des_path.iterdir() if p.is_dir()
                ]

            except Exception as e:
                return fail(f"Failed to rename project: {e}", 500)

        return ok({
            "ok": True,
            "name": new_name if new_name else project_name,
            "tags": proj.metadata.tags or [],
            "verified": proj.metadata.verified,
            "verified_segment_count": proj.metadata.verified_segment_count,
            "autocoded_segment_count": proj.metadata.autocoded_segment_count
        })

    except Exception as e:
        traceback.print_exc()
        return fail(f"Update failed: {e}", 500)
