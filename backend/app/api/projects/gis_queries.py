"""GIS query + visualisation routes: roads/planning-area lookups, GIS overlay
layers, viewport/near-segment layers, curvature and width visualisations."""
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

from ._helpers import _get_gis, _get_segment_midpoint, fail, get_ctx, ok
from .roads_util import _available_road_folders, _available_road_names, _folder_quarter_label, _get_planning_areas_gdf, _get_road_sections_gdf, _pretty_folder_label, _QUARTER_SUFFIX_RE, _select_latest_quarter_folders
from .source_folders import _peek_cached_summary




@bp.post("/roads-in-polygon")
def roads_in_polygon():
    """
    Given a polygon (list of [lat, lon] vertices in WGS84), return the road
    folders whose reference GPS points fall inside the polygon, or road sections,
    or planning areas as fallback.

    Body: { "polygon": [[lat1, lon1], [lat2, lon2], ...] }
    Response: { "roads": [ { "name": "AMK AVE 1", "points": 24, "exists": true }, ... ], "fallback": false }
    """
    import csv
    from shapely.geometry import Polygon as ShapelyPolygon, MultiPolygon as ShapelyMultiPolygon, Point
    from shapely.ops import unary_union

    data = request.get_json(silent=True) or {}

    # Build shapely polygon from either legacy "polygon" key or the newer
    # GeoJSON "selection_geometry" (Polygon / MultiPolygon / LineString / MultiLineString).
    try:
        sel = data.get("selection_geometry")
        if sel:
            geom_type = sel.get("type", "")
            coords = sel.get("coordinates", [])
            if geom_type == "Polygon":
                # GeoJSON coords are [lon, lat]; outer ring is coords[0]
                poly = ShapelyPolygon(coords[0]).buffer(0)
            elif geom_type == "MultiPolygon":
                parts = [ShapelyPolygon(ring[0]).buffer(0) for ring in coords]
                poly = unary_union(parts)
            elif geom_type == "LineString":
                from shapely.geometry import LineString as ShapelyLineString
                poly = ShapelyLineString(coords).buffer(0.0005)  # ~55 m buffer in degrees
            elif geom_type == "MultiLineString":
                from shapely.geometry import LineString as ShapelyLineString
                lines = [ShapelyLineString(line) for line in coords]
                poly = unary_union(lines).buffer(0.0005)
            else:
                return fail(f"Unsupported selection_geometry type: {geom_type}", 400)
            if not poly.is_valid:
                poly = poly.buffer(0)
        else:
            polygon_coords = data.get("polygon")
            if not polygon_coords or len(polygon_coords) < 3:
                return fail("polygon must have at least 3 vertices", 400)
            ring = [(pt[1], pt[0]) for pt in polygon_coords]  # swap [lat,lon] → (lon,lat)
            poly = ShapelyPolygon(ring)
            if not poly.is_valid:
                poly = poly.buffer(0)
    except Exception as e:
        return fail(f"Invalid geometry: {e}", 400)

    # Check which folders already exist locally
    ctx = get_ctx()
    pm = ctx["pm"]
    # Resolved (not the raw, possibly ".."-containing pm.in_path) to match the
    # path form other folder routes (e.g. GET /folders/preview) use.
    in_path: Path = pm.in_path.resolve()
    backend_root = Path(__file__).resolve().parents[3]

    # Build once: map each road-name base (uppercased, suffix-stripped) to the
    # actual download folder(s) under in_path. Folder names carry quarter/segment
    # suffixes (e.g. "AMK AVE 1_1Q2026") that are absent from the CSV/shapefile
    # road names, so a direct (in_path / name).is_dir() check always fails for
    # suffixed folders. Resolving to the real folder name lets project creation
    # succeed and surfaces one row per downloaded survey quarter.
    avail_folders = _available_road_folders(in_path)

    # Merged result: roads from shapefile/CSV with their captured-point count.
    all_road_names: dict[str, dict] = {}  # { "ROAD NAME": { "points": count } }

    # Attempt 1: reference CSV — marks which roads have captured images.
    # Uses the same encoding fix (utf-8-sig) as the rest of the codebase so
    # a BOM-prefixed file doesn't silently corrupt column names.
    csv_roads: set[str] = set()
    ref_csv_candidates = [
        backend_root / "shapefiles" / "road_reference.csv",
        backend_root / "app" / "shapefiles" / "road_reference.csv",
    ]
    ref_csv = next((candidate for candidate in ref_csv_candidates if candidate.exists()), None)

    if ref_csv is not None:
        try:
            with open(ref_csv, newline="", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    try:
                        pt = Point(float(row["lon"]), float(row["lat"]))
                        if poly.contains(pt):
                            name = str(row.get("road_name", "")).strip()
                            if not name:
                                continue
                            csv_roads.add(name)
                            if name not in all_road_names:
                                all_road_names[name] = {"points": 0}
                            all_road_names[name]["points"] += 1
                    except (KeyError, ValueError):
                        continue
        except Exception as e:
            logger.warning(f"[roads-in-polygon] CSV lookup failed: {e}")

    # Attempt 2: road sections shapefile — reuse the cached, already-reprojected
    # GeoDataFrame that roads-in-bounds uses so CRS handling is identical.
    try:
        road_gdf = _get_road_sections_gdf()
        road_name_col = next(
            (c for c in ("RD_NAM", "RD_NAME", "ROAD_NAME", "NAME", "RD_CD_DESC") if c in road_gdf.columns),
            None,
        )
        if road_name_col is not None:
            intersecting_roads = road_gdf[road_gdf.geometry.intersects(poly)]
            logger.debug(
                f"[roads-in-polygon] shapefile hit {len(intersecting_roads)} features"
                f" | poly bounds {poly.bounds}",
            )
            road_counts: dict[str, int] = {}
            for raw_name in intersecting_roads[road_name_col].dropna().astype(str):
                name = raw_name.strip()
                if not name or not any(ch.isalnum() for ch in name):
                    continue
                road_counts[name] = road_counts.get(name, 0) + 1

            for name, count in road_counts.items():
                if name not in all_road_names:
                    all_road_names[name] = {"points": count}
                else:
                    all_road_names[name]["points"] += count
    except Exception as e:
        logger.warning(f"[roads-in-polygon] shapefile lookup failed: {type(e).__name__}: {e}")

    # If we have any road data (CSV or shapefile), return it.
    # Roads whose images have been downloaded are emitted as one row per actual
    # folder (e.g. per survey quarter) using the real, createable folder name —
    # so project creation no longer fails on the bare road name. Roads with no
    # downloaded folder keep the clean road name and the "not downloaded" chip.
    if all_road_names:
        roads = []
        for name in sorted(all_road_names):
            points = all_road_names[name]["points"]
            folders = avail_folders.get(name.upper(), [])
            if folders:
                # Collapse multi-quarter downloads to the latest survey only so the
                # "Roads Found" table shows one row per road, not one per quarter.
                for folder in _select_latest_quarter_folders(folders):
                    label = _pretty_folder_label(folder)
                    if _QUARTER_SUFFIX_RE.search(folder):
                        # Quarter is already known from the folder's own name.
                        quarter = _folder_quarter_label(folder)
                        quarter_status = "known"
                    else:
                        # No quarter suffix — check the cached majority-vote
                        # detection (from images' own capture dates) read-only.
                        # Never renames anything on disk. If there's no cache
                        # yet, report "pending" and let the frontend resolve it
                        # via the same GET /folders/preview bounded-concurrency
                        # fetch Folder mode already uses — no server-side job
                        # dispatch here.
                        cached_summary = _peek_cached_summary(in_path / folder)
                        if cached_summary is not None:
                            quarter = cached_summary.get("majority_quarter")
                            quarter_status = "detected" if quarter else "none"
                        else:
                            quarter = None
                            quarter_status = "pending"
                        if quarter:
                            label = f"{folder} ({quarter})"
                    roads.append({
                        "name": folder,
                        "label": label,
                        "points": points,
                        "exists": True,
                        "quarter": quarter,
                        "quarterStatus": quarter_status,
                    })
            else:
                roads.append({
                    "name": name,
                    "label": name,
                    "points": points,
                    "exists": False,
                    "quarter": None,
                    "quarterStatus": "none",
                })
        logger.debug(f"[DEBUG] Returning {len(roads)} merged roads (fallback=False)")
        return ok({"roads": roads, "fallback": False})

    # ── Fallback 2: planning areas shapefile (town names only as last resort) ──
    try:
        import geopandas as gpd
        planning_dir = backend_root / "shapefiles" / "planningareas"

        pa_shp = planning_dir / "G_MP25_PLNG_AREA_NO_SEA_PL.shp"
        if not pa_shp.exists():
            return ok({"roads": [], "fallback": False})

        gdf = gpd.read_file(str(pa_shp))
        # Reproject to WGS84 if needed
        if gdf.crs and gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(epsg=4326)

        intersecting = gdf[gdf.geometry.intersects(poly)]
        # Try common field names for the area name
        name_col = next(
            (c for c in ("PLN_AREA_N", "REGION_N", "NAME", "SUBZONE_N", "PLANNING_A") if c in intersecting.columns),
            intersecting.columns[0],
        )
        pa_roads = [
            {"name": row[name_col].title(), "points": 0, "exists": False}
            for _, row in intersecting.iterrows()
        ]
        pa_roads.sort(key=lambda r: r["name"])
        return ok({"roads": pa_roads, "fallback": True})
    except Exception as e:
        return ok({"roads": [], "fallback": False})


@bp.get("/roads-in-bounds")
def roads_in_bounds():
    """
    Return road line segments for a visible map viewport.
    Query params:
      minLat, minLng, maxLat, maxLng (required)
      limit (optional, default 2000)
    """
    try:
        min_lat = float(request.args.get("minLat"))
        min_lng = float(request.args.get("minLng"))
        max_lat = float(request.args.get("maxLat"))
        max_lng = float(request.args.get("maxLng"))
        limit = int(request.args.get("limit", 2000))
    except (TypeError, ValueError):
        return fail("Invalid or missing bounds query params", 400)

    limit = max(100, min(limit, 5000))

    try:
        gdf = _get_road_sections_gdf()
        bbox_poly = box(min_lng, min_lat, max_lng, max_lat)

        view = gdf[gdf.geometry.intersects(bbox_poly)].head(limit)
        name_col = next(
            (c for c in ("RD_NAM", "RD_NAME", "ROAD_NAME", "NAME", "RD_CD_DESC") if c in view.columns),
            None,
        )

        ctx = get_ctx()
        pm = ctx["pm"]
        in_path: Path = pm.in_path
        avail_names = _available_road_names(in_path)

        roads = []
        for _, row in view.iterrows():
            geom = row.geometry
            if geom is None or geom.is_empty:
                continue

            road_name = "Unknown Road"
            if name_col is not None and row.get(name_col) is not None:
                candidate = str(row.get(name_col)).strip()
                if candidate:
                    road_name = candidate

            exists = road_name.upper() in avail_names

            if geom.geom_type == "LineString":
                coords = [[lat, lng] for lng, lat in list(geom.coords)]
                roads.append({"name": road_name, "exists": exists, "coords": coords})
            elif geom.geom_type == "MultiLineString":
                for line in geom.geoms:
                    coords = [[lat, lng] for lng, lat in list(line.coords)]
                    roads.append({"name": road_name, "exists": exists, "coords": coords})

        return ok({"roads": roads})
    except Exception as e:
        return fail(f"roads-in-bounds failed: {e}", 500)


@bp.get("/roads-by-name")
def roads_by_name():
    """
    Return all road line segments matching the given folder name.
    The folder name may carry a quarter suffix (_1Q2026) and/or a segment
    identifier (_NE1) separated by underscores. Singapore road names never
    contain underscores, so the road name is everything before the first '_'.
    Query params:
      name (required) - folder name (raw, with any suffixes)
    """
    raw = request.args.get("name", "").strip()
    if not raw:
        return fail("Missing 'name' query param", 400)

    # Extract road name: everything before the first underscore, case-normalised
    road_name = raw.split("_")[0].strip().upper()
    if not road_name:
        return fail("Could not extract road name from folder name", 400)

    try:
        gdf = _get_road_sections_gdf()
        road_name_col = next(
            (c for c in ("RD_NAM", "RD_NAME", "ROAD_NAME", "NAME", "RD_CD_DESC") if c in gdf.columns),
            None,
        )
        if road_name_col is None:
            return ok({"roads": []})

        matched = gdf[gdf[road_name_col].astype(str).str.strip().str.upper() == road_name]

        ctx = get_ctx()
        pm = ctx["pm"]
        in_path: Path = pm.in_path
        exists = in_path.exists() and (in_path / raw).is_dir()

        roads = []
        for _, row in matched.iterrows():
            geom = row.geometry
            if geom is None or geom.is_empty:
                continue
            if geom.geom_type == "LineString":
                coords = [[lat, lng] for lng, lat in list(geom.coords)]
                roads.append({"name": road_name, "exists": exists, "coords": coords})
            elif geom.geom_type == "MultiLineString":
                for line in geom.geoms:
                    coords = [[lat, lng] for lng, lat in list(line.coords)]
                    roads.append({"name": road_name, "exists": exists, "coords": coords})

        return ok({"roads": roads})
    except Exception as e:
        return fail(f"roads-by-name failed: {e}", 500)


@bp.get("/planning-areas-in-bounds")
def planning_areas_in_bounds():
    """
    Return planning-area polygon parts for a visible map viewport.
    Query params:
      minLat, minLng, maxLat, maxLng (required)
      limit (optional, default 500)
    """
    try:
        min_lat = float(request.args.get("minLat"))
        min_lng = float(request.args.get("minLng"))
        max_lat = float(request.args.get("maxLat"))
        max_lng = float(request.args.get("maxLng"))
        limit = int(request.args.get("limit", 500))
    except (TypeError, ValueError):
        return fail("Invalid or missing bounds query params", 400)

    limit = max(25, min(limit, 1000))

    try:
        gdf = _get_planning_areas_gdf()
        bbox_poly = box(min_lng, min_lat, max_lng, max_lat)
        view = gdf[gdf.geometry.intersects(bbox_poly)].head(limit)

        name_col = next(
            (c for c in ("PLN_AREA_N", "PLANNING_A", "NAME", "SUBZONE_N") if c in view.columns),
            None,
        )
        region_col = next((c for c in ("REGION_N", "REGION") if c in view.columns), None)

        areas = []
        for _, row in view.iterrows():
            geom = row.geometry
            if geom is None or geom.is_empty:
                continue

            area_name = "Unknown Planning Area"
            if name_col is not None and row.get(name_col) is not None:
                candidate = str(row.get(name_col)).strip()
                if candidate:
                    area_name = candidate.title()

            region_name = None
            if region_col is not None and row.get(region_col) is not None:
                candidate = str(row.get(region_col)).strip()
                if candidate:
                    region_name = candidate.title()

            geoms = [geom] if geom.geom_type == "Polygon" else list(geom.geoms) if geom.geom_type == "MultiPolygon" else []
            for part_index, poly in enumerate(geoms):
                exterior = poly.exterior
                if exterior is None:
                    continue
                coords = [[lat, lng] for lng, lat in list(exterior.coords)]
                if len(coords) < 4:
                    continue
                areas.append({
                    "name": area_name,
                    "region": region_name,
                    "partIndex": part_index,
                    "coords": coords,
                })

        return ok({"areas": areas})
    except Exception as e:
        return fail(f"planning-areas-in-bounds failed: {e}", 500)


@bp.post("/<project_name>/curvature/visualize")
def get_curvature_visualization(project_name: str):
    """
    Generate visualization data for curvature analysis at a specific segment.

    This endpoint returns all the data needed to display an interactive map showing:
    - The analysis point (segment midpoint)
    - The 5-meter analysis window (circular buffer)
    - Path centerlines within the window (color-coded by type)
    - Calculated curvature radius and path width values

    Request body:
        {
            "coords": [[lon, lat], ...],  // Segment LineString coordinates
            "index": 0  // Optional: segment index for reference
        }

    Response:
        {
            "ok": true,
            "point": {
                "lon": 103.8198,
                "lat": 1.3521
            },
            "radius": 8.3,  // Minimum curvature radius in meters (null if not found)
            "width": 2.5,   // Path width in meters (null if not found)
            "curvature": 1, // Curvature category (1=Sharp Turn, 2=No Sharp Turn)
            "circle_geojson": {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[lon, lat], ...]]
                },
                "properties": {
                    "radius_m": 5.0,
                    "style": {"color": "#000000", "weight": 2, "fill": false}
                }
            },
            "paths": [
                {
                    "type": "cycling",
                    "color": [0, 180, 0],
                    "coordinates": [[lon, lat], ...],
                    "is_analysis_layer": true
                },
                ...
            ],
            "layer_used": "cycling",  // Which layer provided the data
            "analysis_window_m": 5.0
        }

    Error Response:
        {
            "error": "coords (LineString) is required"
        }
    """
    try:
        payload = request.get_json(force=True, silent=True) or {}
        coords = payload.get("coords")  # [[lon, lat], ...]

        if not coords or not isinstance(coords, list) or not isinstance(coords[0], list):
            return fail("coords (LineString) is required", 400)

        # Keep the debug overlay aligned with the same segment midpoint used in autocode.
        pt = _get_segment_midpoint(coords)

        _gis = _get_gis()

        # Generate visualization data
        viz_data = _gis.get_curvature_visualization(pt, collect_radius=5.0)
        viz_data["ok"] = True

        return ok(viz_data)

    except ServiceUnavailable as e:
        return fail(str(e), 503)
    except Exception as e:
        traceback.print_exc()
        return fail(f"curvature visualization error: {e}", 500)


@bp.post("/<project_name>/width/visualize")
def get_width_visualization(project_name: str):
    """
    Generate visualization data for facility width analysis at a specific segment.

    This endpoint returns all the data needed to display an interactive map showing:
    - The analysis point (segment starting location)
    - Expanding ring search pattern (1m to 10m radii)
    - Path centerlines within view (color-coded by type)
    - Which radius found the width value
    - Calculated width value and category

    Request body:
        {
            "coords": [[lon, lat], ...],  // Segment LineString coordinates
            "index": 0  // Optional: segment index for reference
        }

    Response:
        {
            "ok": true,
            "point": {"lon": 103.8198, "lat": 1.3521},
            "width": 2.5,  // Width in meters (null if not found)
            "width_category": 2,  // 1=Very Narrow, 2=Narrow, 3=Wide
            "search_info": {
                "found_at_radius": 2.0,  // meters
                "layer_used": "cycling",
                "total_radii_checked": 5
            },
            "search_rings": [
                {
                    "radius": 2.0,
                    "center": [lon, lat],
                    "candidates_by_layer": {"cycling": 1, "shared": 0, "footpath": 0},
                    "width_locked": true
                },
                ...
            ],
            "paths": [
                {
                    "type": "cycling",
                    "color": [0, 180, 0],
                    "coordinates": [[lon, lat], ...],
                    "is_analysis_layer": true,
                    "width_value": 2.5
                },
                ...
            ],
            "width_distribution": {
                "cycling": {"min": 0.5, "max": 9.0, "count": 1437},
                "shared": {"min": 0.4, "max": 11.3, "count": 4531},
                "footpath": {"min": 0.04, "max": 33.3, "count": 179483}
            }
        }
    """
    try:
        payload = request.get_json(force=True, silent=True) or {}
        coords = payload.get("coords")  # [[lon, lat], ...]

        if not coords or not isinstance(coords, list) or not isinstance(coords[0], list):
            return fail("coords (LineString) is required", 400)

        # Segment starting point (WGS84)
        start_lon, start_lat = coords[0]
        pt = Point(start_lon, start_lat)

        _gis = _get_gis()

        # Generate visualization data
        viz_data = _gis.get_width_visualization(pt, start_radius=1.0, max_radius=10.0, step=1.0)

        viz_data["ok"] = True
        return ok(viz_data)

    except ServiceUnavailable as e:
        return fail(str(e), 503)
    except Exception as e:
        traceback.print_exc()
        return fail(f"width visualization error: {e}", 500)


@bp.post("/<project_name>/gis/layers")
def get_gis_layers(project_name: str):
    """
    Fetch GIS layer paths near a point for map visualization on the coding page.

    This endpoint provides cycling paths, footpaths, shared paths, and road crossings within
    a specified radius of a point to show GIS layer context on the coding map.
    NOTE: This endpoint uses GIS only — no CV models are required.

    Request body:
        {
            "point": [lon, lat],  // Center point (WGS84)
            "radius": 100,        // Search radius in meters (default: 100m)
            "layers": ["cycling", "shared", "footpath", "roadcrossing"]  // Optional: which layers to fetch
        }

    Response:
        {
            "ok": true,
            "point": {"lon": 103.8198, "lat": 1.3521},
            "radius": 100,
            "layers": {
                "cycling": [
                    {
                        "coordinates": [[lon, lat], ...],  // LineString in WGS84
                        "properties": {"width": 2.5}  // if available
                    },
                    ...
                ],
                "shared": [...],
                "footpath": [...],
                "roadcrossing": [...]
            }
        }
    """
    try:
        payload = request.get_json(force=True, silent=True) or {}
        point_coords = payload.get("point", [])
        radius = payload.get("radius", 200)  # Default 200m radius
        requested_layers = payload.get("layers", ["cycling", "shared", "footpath"])

        if not point_coords or len(point_coords) != 2:
            return fail("point [lon, lat] is required", 400)

        lon, lat = point_coords
        pt = Point(lon, lat)

        _gis = _get_gis()
        pt_metric = _gis.store.to_metric_point(pt)

        # Create buffer for spatial query
        buffer_geom = pt_metric.buffer(radius)

        # Layer name mapping
        layer_names = {
            "cycling": "cycling_path",
            "shared": "shared_path",
            "footpath": "footpath",
            "roadcrossing": "roadcrossing",
            "mrt_exit": "mrt",
            "bus_stop": ["bus_stop", "bus_shelter"], # Try both
            "bus_lane": "bus_lane",
            "parking_lot": "parking",
            "kerb_line": "kerb_line",
            "bicycle_crossing": "bicycle_crossing",
            "state_land": "land_state_land",
            "stat_board": "land_stat_board",
            "land_private": "land_private",
            "land_ministry": "land_ministry",
        }

        result_layers = {}

        for layer_key in requested_layers:
            if layer_key not in layer_names:
                continue

            layer_targets = layer_names[layer_key]
            if not isinstance(layer_targets, list):
                layer_targets = [layer_targets]

            all_features = []
            for layer_name in layer_targets:
                try:
                    gdf = _gis.store.get(layer_name)
                    if gdf is None or gdf.empty:
                        logger.debug(f"[GIS] Layer '{layer_key}' sub-layer '{layer_name}': empty or None — skipped")
                        continue

                    # Spatial query using the CACHED sindex (fast, read-only)
                    candidate_indices = list(gdf.sindex.intersection(buffer_geom.bounds))

                    if not candidate_indices:
                        logger.debug(f"[GIS] Layer '{layer_key}' sub-layer '{layer_name}': 0 candidates in spatial index (total features: {len(gdf)})")
                        continue

                    candidates = gdf.iloc[candidate_indices]
                    intersecting = candidates[candidates.geometry.notna() & candidates.intersects(buffer_geom)]

                    logger.debug(f"[GIS] Layer '{layer_key}' sub-layer '{layer_name}': {len(intersecting)} intersecting features found (candidates: {len(candidates)})")

                    if intersecting.empty:
                        continue

                    # Copy only the small result set, then convert to WGS84
                    intersecting_wgs84 = intersecting.copy().to_crs("EPSG:4326")

                    for _, feature in intersecting_wgs84.iterrows():
                        geom = feature.geometry
                        if geom is None or geom.is_empty:
                            continue

                        # Strip Z if present (on single geometry, negligible cost)
                        if geom.has_z:
                            try:
                                geom = gis.GIS._remove_z_coordinate(geom)
                            except Exception:
                                pass

                        # Extract properties
                        props = {}
                        if "WIDTH" in feature.index:
                            width_val = feature["WIDTH"]
                            if width_val is not None and not (isinstance(width_val, float) and math.isnan(width_val)):
                                props["width"] = float(width_val)
                        
                        for col in feature.index:
                            if col not in ["geometry", "WIDTH"]:
                                val = feature[col]
                                if val is not None and not (isinstance(val, float) and math.isnan(val)):
                                    props[col] = str(val)

                        # Extract coordinates based on geometry type
                        geom_output_type = None
                        coords = []
                        
                        if geom.geom_type == "LineString":
                            coords = [[float(x), float(y)] for x, y in geom.coords]
                            geom_output_type = "line"
                        elif geom.geom_type == "MultiLineString":
                            for line in geom.geoms:
                                all_features.append({
                                    "coordinates": [[float(x), float(y)] for x, y in line.coords],
                                    "properties": props,
                                    "geometry_type": "line"
                                })
                            continue
                        elif geom.geom_type == "Point":
                            coords = [[float(geom.x), float(geom.y)]]
                            geom_output_type = "point"
                        elif geom.geom_type == "MultiPoint":
                            for pt_geom in geom.geoms:
                                all_features.append({
                                    "coordinates": [[float(pt_geom.x), float(pt_geom.y)]],
                                    "properties": props,
                                    "geometry_type": "point"
                                })
                            continue
                        elif geom.geom_type == "Polygon":
                            coords = [[float(x), float(y)] for x, y in geom.exterior.coords]
                            geom_output_type = "polygon"
                        elif geom.geom_type == "MultiPolygon":
                            for poly in geom.geoms:
                                all_features.append({
                                    "coordinates": [[float(x), float(y)] for x, y in poly.exterior.coords],
                                    "properties": props,
                                    "geometry_type": "polygon"
                                })
                            continue
                        else:
                            continue

                        if geom_output_type and coords:
                            all_features.append({
                                "coordinates": coords,
                                "geometry_type": geom_output_type,
                                "properties": props
                            })

                except Exception as e:
                    import traceback
                    traceback.print_exc()
                    logger.warning(f"Error processing sub-layer '{layer_name}': {e}")

            result_layers[layer_key] = all_features

        # Build response
        layer_summary = {k: len(v) for k, v in result_layers.items()}
        logger.debug(f"[GIS] Response: {layer_summary}")

        response = {
            "ok": True,
            "point": {"lon": lon, "lat": lat},
            "radius": radius,
            "layers": result_layers
        }

        return ok(response)

    except ServiceUnavailable as e:
        return fail(str(e), 503)
    except Exception as e:
        traceback.print_exc()
        return fail(f"GIS layers error: {e}", 500)

# Shared GIS layer-key → store layer name(s) mapping for the map overlay endpoints.
_GIS_OVERLAY_LAYER_NAMES = {
    "cycling": "cycling_path",
    "shared": "shared_path",
    "footpath": "footpath",
    "roadcrossing": "roadcrossing",
    "mrt_exit": "mrt",
    "bus_stop": ["bus_stop", "bus_shelter"],
    "bus_lane": "bus_lane",
    "parking_lot": "parking",
    "kerb_line": "kerb_line",
    "bicycle_crossing": "bicycle_crossing",
    "state_land": "land_state_land",
    "stat_board": "land_stat_board",
    "land_private": "land_private",
    "land_ministry": "land_ministry",
}


def _extract_gis_overlay_layers(_gis, buffer_geom, requested_layers, simplify_tol=0.0, max_features=12000):
    """Collect GIS overlay features intersecting ``buffer_geom`` for the map overlays.

    ``buffer_geom`` must already be in ``_gis.store.metric_crs``. Returns a dict of
    ``{layer_key: [{coordinates, geometry_type, properties}, ...]}`` with coordinates in
    WGS84. Shared by the viewport and near-segments endpoints so they stay in lock-step.
    """
    result_layers = {}
    for layer_key in requested_layers:
        if layer_key not in _GIS_OVERLAY_LAYER_NAMES:
            continue

        layer_targets = _GIS_OVERLAY_LAYER_NAMES[layer_key]
        if not isinstance(layer_targets, list):
            layer_targets = [layer_targets]

        all_features = []
        for layer_name in layer_targets:
            if len(all_features) >= max_features:
                break
            try:
                gdf = _gis.store.get(layer_name)
                if gdf is None or gdf.empty:
                    continue

                candidate_indices = list(gdf.sindex.intersection(buffer_geom.bounds))
                if not candidate_indices:
                    continue

                candidates = gdf.iloc[candidate_indices]
                intersecting = candidates[candidates.geometry.notna() & candidates.intersects(buffer_geom)]
                if intersecting.empty:
                    continue

                remaining = max_features - len(all_features)
                if len(intersecting) > remaining:
                    intersecting = intersecting.iloc[:remaining]

                intersecting = intersecting.copy()
                # Simplify in the metric CRS (tolerance is in metres) before reprojecting,
                # to cut vertex count without a visible change at the requested scale.
                if simplify_tol > 0:
                    intersecting["geometry"] = intersecting.geometry.simplify(simplify_tol, preserve_topology=False)

                intersecting_wgs84 = intersecting.to_crs("EPSG:4326")

                for _, feature in intersecting_wgs84.iterrows():
                    geom = feature.geometry
                    if geom is None or geom.is_empty:
                        continue

                    if geom.has_z:
                        try:
                            geom = gis.GIS._remove_z_coordinate(geom)
                        except Exception:
                            pass

                    props = {}
                    for col in feature.index:
                        if col != "geometry":
                            val = feature[col]
                            if val is not None and not (isinstance(val, float) and math.isnan(val)):
                                props[col] = str(val)

                    if geom.geom_type == "LineString":
                        all_features.append({"coordinates": [[float(x), float(y)] for x, y in geom.coords], "geometry_type": "line", "properties": props})
                    elif geom.geom_type == "MultiLineString":
                        for line in geom.geoms:
                            all_features.append({"coordinates": [[float(x), float(y)] for x, y in line.coords], "geometry_type": "line", "properties": props})
                    elif geom.geom_type == "Point":
                        all_features.append({"coordinates": [[float(geom.x), float(geom.y)]], "geometry_type": "point", "properties": props})
                    elif geom.geom_type == "MultiPoint":
                        for pt_geom in geom.geoms:
                            all_features.append({"coordinates": [[float(pt_geom.x), float(pt_geom.y)]], "geometry_type": "point", "properties": props})
                    elif geom.geom_type == "Polygon":
                        all_features.append({"coordinates": [[float(x), float(y)] for x, y in geom.exterior.coords], "geometry_type": "polygon", "properties": props})
                    elif geom.geom_type == "MultiPolygon":
                        for poly in geom.geoms:
                            all_features.append({"coordinates": [[float(x), float(y)] for x, y in poly.exterior.coords], "geometry_type": "polygon", "properties": props})

            except Exception as e:
                traceback.print_exc()
                logger.warning(f"[GIS Overlay] Error processing layer '{layer_name}': {e}")

        result_layers[layer_key] = all_features

    return result_layers


@bp.route('/gis/viewport', methods=['POST'])
def get_gis_viewport_layers():
    """Fetch GIS layers within a map viewport bounding box (used by Path Analysis page)."""
    try:
        data = request.get_json(force=True) or {}
        bbox = data.get('bbox')           # [minLon, minLat, maxLon, maxLat]
        requested_layers = data.get('layers', [])
        # A footpath/kerb network for a single project at fit-bounds zoom easily runs to
        # several thousand line segments; a low cap silently truncates them in dataframe
        # order, leaving the visible viewport mostly empty. Keep the ceiling high and lean
        # on geometry simplification (below) to keep the payload small instead.
        max_features = min(int(data.get('max_features', 6000)), 12000)
        # Optional Douglas-Peucker tolerance in metres (metric CRS). Scaled by the client
        # to the current zoom so zoomed-out views send fewer vertices per feature.
        simplify_tol = float(data.get('simplify_tol', 0) or 0)

        if not bbox or len(bbox) != 4:
            return fail("bbox must be [minLon, minLat, maxLon, maxLat]", 400)

        min_lon, min_lat, max_lon, max_lat = [float(v) for v in bbox]

        _gis = _get_gis()

        # Reproject the bbox from WGS84 to the metric CRS used for spatial indexing
        bbox_gdf = gpd.GeoDataFrame(geometry=[box(min_lon, min_lat, max_lon, max_lat)], crs="EPSG:4326")
        bbox_gdf = bbox_gdf.to_crs(_gis.store.metric_crs)
        buffer_geom = bbox_gdf.geometry.iloc[0]

        result_layers = _extract_gis_overlay_layers(_gis, buffer_geom, requested_layers, simplify_tol, max_features)

        layer_summary = {k: len(v) for k, v in result_layers.items()}
        logger.debug(f"[GIS Viewport] Response: {layer_summary}")
        return ok({"ok": True, "layers": result_layers})

    except Exception as e:
        traceback.print_exc()
        return fail(f"GIS viewport layers error: {e}", 500)


@bp.route('/gis/near-segments', methods=['POST'])
def get_gis_near_segments():
    """Fetch GIS overlay features within ``radius`` metres of any provided segment point.

    Data-driven alternative to ``/gis/viewport`` used by the Path Analysis map: a single
    request covers every loaded segment, so the overlays are fetched once and never reload
    on pan/zoom (Leaflet's canvas renderer culls off-screen geometry for free).

    Request body:
        {
            "points": [[lon, lat], ...],   # segment coordinates (WGS84)
            "radius": 200,                  # metres around each point (default 200)
            "layers": ["footpath", ...],
            "simplify_tol": 1.0             # optional metric Douglas-Peucker tolerance
        }
    """
    try:
        from shapely.geometry import MultiPoint

        data = request.get_json(force=True) or {}
        points = data.get('points', [])
        radius = float(data.get('radius', 200) or 200)
        requested_layers = data.get('layers', [])
        simplify_tol = float(data.get('simplify_tol', 0) or 0)
        max_features = min(int(data.get('max_features', 20000)), 40000)

        coords = [(float(p[0]), float(p[1])) for p in points if p and len(p) >= 2]
        if not coords:
            return fail("points [[lon, lat], ...] is required", 400)

        _gis = _get_gis()

        # Union of a buffer around every segment, built in the metric CRS. Coarse circles
        # (resolution=4) keep the unioned geometry cheap to intersect against.
        mp_gdf = gpd.GeoDataFrame(geometry=[MultiPoint(coords)], crs="EPSG:4326").to_crs(_gis.store.metric_crs)
        buffer_geom = mp_gdf.geometry.iloc[0].buffer(radius, resolution=4)

        result_layers = _extract_gis_overlay_layers(_gis, buffer_geom, requested_layers, simplify_tol, max_features)

        layer_summary = {k: len(v) for k, v in result_layers.items()}
        logger.debug(f"[GIS NearSegments] {len(coords)} pts r={radius}m → {layer_summary}")
        return ok({"ok": True, "layers": result_layers})

    except Exception as e:
        traceback.print_exc()
        return fail(f"GIS near-segments error: {e}", 500)


@bp.route("/<projectName>/gis/detect", methods=["POST"])
def detect_nearby_gis(projectName):
    """
    Diagnostic endpoint to auto-detect nearby bus stops and bus lanes within 200m.
    """
    try:
        data = request.json
        lon, lat = data.get("point", [0, 0])
        search_radius = 200  # 200m as requested
        
        _gis = _get_gis()
        from shapely.geometry import Point
        import pyproj
        
        # Project to SVY21
        transformer = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:3414", always_xy=True)
        svy21_x, svy21_y = transformer.transform(lon, lat)
        current_pt = Point(svy21_x, svy21_y)
        buffer_geom = current_pt.buffer(search_radius)

        results = {
            "bus_stop": {"found": False, "distance": None},
            "bus_lane": {"found": False, "distance": None}
        }

        # Bus Stops
        for layer_name in ["bus_stop", "bus_shelter"]:
            gdf = _gis.store.get(layer_name)
            if gdf is not None:
                intersecting = gdf[gdf.intersects(buffer_geom)]
                for _, row in intersecting.iterrows():
                    d = current_pt.distance(row.geometry)
                    if results["bus_stop"]["distance"] is None or d < results["bus_stop"]["distance"]:
                        results["bus_stop"] = {"found": True, "distance": round(float(d), 2)}

        # Bus Lanes
        gdf_lane = _gis.store.get("bus_lane")
        if gdf_lane is not None:
            intersecting = gdf_lane[gdf_lane.intersects(buffer_geom)]
            for _, row in intersecting.iterrows():
                d = current_pt.distance(row.geometry)
                if results["bus_lane"]["distance"] is None or d < results["bus_lane"]["distance"]:
                    results["bus_lane"] = {"found": True, "distance": round(float(d), 2)}

        return jsonify({"ok": True, "results": results})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)}), 500
