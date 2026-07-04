"""Shapefile export route and its field-shortening / vertex helpers."""
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



def _first_vertex_point(geom):
    """Reduce a (Multi)LineString to a Point at its first vertex.

    Matches the Path Analysis map, which plots each segment as a single marker
    at the LineString's first coordinate. Points pass through unchanged; empty
    or unsupported geometries return None so callers can drop them.
    """
    if geom is None or geom.is_empty:
        return None
    if geom.geom_type == "Point":
        return geom
    if geom.geom_type == "LineString":
        return Point(geom.coords[0])
    if geom.geom_type == "MultiLineString":
        first = geom.geoms[0]
        if first.is_empty:
            return None
        return Point(first.coords[0])
    # Fallback for any other geometry type
    return geom.representative_point()


def _shorten_field_names(columns: list[str]) -> dict[str, str]:
    """Map column names to ≤10-char shapefile-safe names, resolving collisions."""
    used: set[str] = set()
    mapping: dict[str, str] = {}
    for col in columns:
        short = col[:10] if len(col) > 10 else col
        if short in used:
            for i in range(1, 1000):
                candidate = col[:9] + str(i)
                if candidate not in used:
                    short = candidate
                    break
        used.add(short)
        mapping[col] = short
    return mapping


@bp.post("/export-shapefile")
def export_shapefile():
    """
    Export the current filtered view as a single merged shapefile.

    Request body:
        {
            "projects": {
                "ProjectName1": ["img1.jpg", "img2.jpg", ...],
                ...
            }
        }

    The image-reference lists represent the segments currently visible after
    all filters/search have been applied on the frontend. Segments from every
    project are combined into one GeoDataFrame (tagged with a "Project" column)
    and written as a single shapefile set.

    Returns a ZIP holding the shapefile components (.shp, .shx, .dbf, .prj,
    .cpg) plus a _fields.json mapping the truncated ≤10-char field names back
    to their original names.
    """
    import tempfile
    import os as _os

    data = request.get_json() or {}
    projects_images = data.get("projects", {})

    if not projects_images or not isinstance(projects_images, dict):
        return fail("No segments specified", 400)

    ctx = get_ctx()
    pm = ctx["pm"]

    band_columns = ["VB Band", "BB Band", "SB Band", "BP Band", "Overall Risk Level Band"]
    parts: list = []  # per-project filtered GeoDataFrames (all in EPSG:4326)

    for project_name, image_refs in projects_images.items():
        if not image_refs or not isinstance(image_refs, list):
            continue

        try:
            proj: Project = pm.project(project_name)
            ver = proj.latest()

            gpkg_path = proj.project_path / "geo_data.gpkg"
            if not gpkg_path.exists():
                continue

            gdf = gpd.read_file(gpkg_path).reset_index(drop=True)
            if gdf.empty or "Image Reference" not in gdf.columns:
                continue

            # Load attributes (includes any previously calculated bands)
            if ver.attributes is None or ver.attributes.df is None or ver.attributes.df.empty:
                continue
            attrs_df = ver.attributes.df.copy().reset_index(drop=True)

            # Merge score bands when available and row counts match
            if (
                ver.results is not None
                and ver.results.df is not None
                and len(ver.results.df) > 0
                and len(ver.results.df) == len(attrs_df)
            ):
                results_df = ver.results.df
                for col in band_columns:
                    if col in results_df.columns and col not in attrs_df.columns:
                        attrs_df[col] = results_df[col].values

            if len(gdf) != len(attrs_df):
                continue  # Row count mismatch — skip rather than silently misalign

            # Merge attribute columns into geo frame (geometry + Image Reference already there)
            for col in attrs_df.columns:
                if col not in gdf.columns:
                    gdf[col] = attrs_df[col].values

            # Filter to the requested (currently-visible) segments
            image_refs_set = {str(r) for r in image_refs}
            filtered = gdf[gdf["Image Reference"].astype(str).isin(image_refs_set)].copy()
            if filtered.empty:
                continue

            # The map plots each segment as a single point at the LineString's
            # first vertex; mirror that so the export is point geometry, not lines.
            filtered["geometry"] = filtered.geometry.apply(_first_vertex_point)
            filtered = filtered[filtered.geometry.notna()]
            if filtered.empty:
                continue

            # Reproject to WGS-84 for universal compatibility
            if filtered.crs is None:
                filtered = filtered.set_crs("EPSG:3414")
            if filtered.crs.to_epsg() != 4326:
                filtered = filtered.to_crs("EPSG:4326")

            # Tag each segment with its source project so the merged set stays traceable
            filtered.insert(0, "Project", project_name)

            parts.append(filtered)

        except Exception as exc:
            print(f"[export-shapefile] skipping '{project_name}': {exc}")
            continue

    if not parts:
        return fail("No matching segments found to export", 404)

    # Merge every project's segments into one GeoDataFrame.
    # pd.concat unions columns (missing ones become NaN) so differing schemas are tolerated.
    merged = pd.concat(parts, ignore_index=True)
    merged = gpd.GeoDataFrame(merged, geometry="geometry", crs="EPSG:4326")

    # Shorten column names to ≤10 chars (shapefile limit) on the unified column set
    non_geom_cols = [c for c in merged.columns if c != "geometry"]
    col_mapping = _shorten_field_names(non_geom_cols)
    merged = merged.rename(columns=col_mapping)

    memory_file = io.BytesIO()
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            layer_name = "filtered_segments"
            shp_path = _os.path.join(tmpdir, f"{layer_name}.shp")
            merged.to_file(shp_path, driver="ESRI Shapefile")

            with zipfile.ZipFile(memory_file, "w", zipfile.ZIP_DEFLATED) as zf:
                for ext in (".shp", ".shx", ".dbf", ".prj", ".cpg"):
                    fpath = _os.path.join(tmpdir, f"{layer_name}{ext}")
                    if _os.path.exists(fpath):
                        zf.write(fpath, f"{layer_name}{ext}")

                # Companion JSON: truncated name → original name
                inverse_map = {v: k for k, v in col_mapping.items() if v != k}
                if inverse_map:
                    import json as _json
                    zf.writestr(
                        f"{layer_name}_fields.json",
                        _json.dumps({"field_name_map": inverse_map}, indent=2),
                    )
    except Exception as exc:
        return fail(f"Failed to create shapefile export: {exc}", 500)

    memory_file.seek(0)
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    return send_file(
        memory_file,
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"filtered_segments_{timestamp}.zip",
    )
