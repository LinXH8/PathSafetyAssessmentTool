"""LiDAR gradient-profile subsystem for the projects blueprint.

Loads gradient centreline profiles, maps project images to (grade, gradient%)
via chainage, caches results per project, and injects Grade/Gradient% into
attribute updates (`_inject_grade`). Used by autocode and the attributes read."""
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

from ._helpers import get_ctx




# ───────────────────────── Gradient lookup (module-level) ─────────────────────
# Catalog is rebuilt automatically when new profiles appear on disk.
_GRADIENT_PROFILE_CATALOG: "dict[str, dict] | None" = None
_GRADIENT_CATALOG_LOAD_TIME: float = 0.0
_PROJECT_GRADIENT_CACHE: dict[str, dict[str, tuple[int, float]]] = {}
_PROJECT_GRADIENT_CACHE_STATE: dict[str, str] = {}
# Serialises the cold-cache build below. The build reads a GeoPackage via GDAL
# (not reentrant) and does per-segment Shapely projection (GIL-bound). Without
# this lock, N concurrent `/versions/latest/attributes` requests (one per loaded
# project on the Path Analysis page) all run the heavy build at once on a cold
# cache, crashing a worker thread -> ECONNRESET. Double-checked against the cache
# so warm hits never take the lock.
_GRADIENT_CACHE_LOCK = threading.Lock()

_GRADIENT_CACHE_STATE_PROFILE_MISSING = "profile_missing"
_GRADIENT_CACHE_STATE_PROFILE_AVAILABLE = "profile_available"

GRADIENT_STATUS_FIELD = "Gradient Status"
GRADIENT_STATUS_NOT_ASSESSED = "Not assessed yet"
GRADIENT_STATUS_NO_LIDAR_RESULT = "N/A (no LiDAR result)"


def _normalize_gradient_token(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", str(value or "")).strip("_").lower()


def _strip_survey_suffix(value: str) -> str:
    return re.sub(r"(?:\d*q\d{2,4})$", "", _normalize_gradient_token(value), flags=re.IGNORECASE).rstrip("_")


def _rect_distance(bounds_a, bounds_b) -> float:
    ax1, ay1, ax2, ay2 = bounds_a
    bx1, by1, bx2, by2 = bounds_b
    dx = max(bx1 - ax2, ax1 - bx2, 0.0)
    dy = max(by1 - ay2, ay1 - by2, 0.0)
    return math.hypot(dx, dy)


def _same_xy(a, b, tol: float = 1e-3) -> bool:
    return abs(a[0] - b[0]) <= tol and abs(a[1] - b[1]) <= tol


def _stitch_gradient_centerline(gdf: gpd.GeoDataFrame) -> "LineString | None":
    stitched = []
    for geom in gdf.geometry:
        if geom is None or geom.is_empty:
            continue
        if geom.geom_type == "MultiLineString":
            parts = list(geom.geoms)
            if not parts:
                continue
            geom = max(parts, key=lambda g: g.length)
        if geom.geom_type != "LineString":
            continue

        coords = list(geom.coords)
        if len(coords) < 2:
            continue
        if not stitched:
            stitched.extend(coords)
            continue

        end_pt = stitched[-1]
        start_dist = math.hypot(end_pt[0] - coords[0][0], end_pt[1] - coords[0][1])
        reverse_dist = math.hypot(end_pt[0] - coords[-1][0], end_pt[1] - coords[-1][1])
        if reverse_dist < start_dist:
            coords = list(reversed(coords))

        if _same_xy(stitched[-1], coords[0]):
            stitched.extend(coords[1:])
        else:
            stitched.extend(coords)

    if len(stitched) < 2:
        return None
    return LineString(stitched)


def _load_gradient_profile_catalog() -> dict[str, dict]:
    global _GRADIENT_PROFILE_CATALOG, _GRADIENT_CATALOG_LOAD_TIME

    base_dir = Path(__file__).resolve().parents[3] / "shapefiles" / "gradient_profiles"

    # Detect new profiles: if any planning-area directory is newer than the last load,
    # discard the cached catalog and per-project mappings so they are rebuilt fresh.
    if _GRADIENT_PROFILE_CATALOG is not None and base_dir.exists():
        try:
            stale = any(
                d.stat().st_mtime > _GRADIENT_CATALOG_LOAD_TIME
                for d in base_dir.iterdir()
                if d.is_dir()
            )
            if stale:
                logger.info("[Gradient] new profiles detected — rebuilding catalog")
                _GRADIENT_PROFILE_CATALOG = None
                _PROJECT_GRADIENT_CACHE.clear()
                _PROJECT_GRADIENT_CACHE_STATE.clear()
        except OSError:
            pass

    if _GRADIENT_PROFILE_CATALOG is not None:
        return _GRADIENT_PROFILE_CATALOG

    result: dict[str, dict] = {}
    if not base_dir.exists():
        _GRADIENT_PROFILE_CATALOG = result
        _GRADIENT_CATALOG_LOAD_TIME = time.time()
        return result

    for meta_path in sorted(base_dir.glob("*/*/metadata.json")):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            profile_path = meta_path.parent / "gradient_profile.csv"
            if not profile_path.exists():
                continue
            if int(meta.get("valid_gradient_count") or 0) <= 0:
                logger.debug(f"[Gradient] skipping profile '{meta_path.parent.name}' with no valid gradients")
                continue
            bounds = meta.get("path_bounds_svy21") or {}
            meta["_bounds"] = None
            if {"min_x", "min_y", "max_x", "max_y"} <= set(bounds):
                meta["_bounds"] = (
                    float(bounds["min_x"]),
                    float(bounds["min_y"]),
                    float(bounds["max_x"]),
                    float(bounds["max_y"]),
                )
            aliases = {
                _normalize_gradient_token(meta.get("path_key", "")),
                _normalize_gradient_token(meta.get("display_name", "")),
                _normalize_gradient_token(meta.get("source_project", "")),
                _strip_survey_suffix(meta.get("path_key", "")),
                _strip_survey_suffix(meta.get("display_name", "")),
                _strip_survey_suffix(meta.get("source_project", "")),
            }
            aliases.discard("")
            meta["_aliases"] = aliases
            meta["_profile_path"] = str(profile_path)
            result[str(meta.get("path_key") or meta_path.parent.name)] = meta
        except Exception as exc:
            logger.warning(f"[Gradient] WARNING: failed to read profile metadata {meta_path}: {exc}")

    _GRADIENT_PROFILE_CATALOG = result
    _GRADIENT_CATALOG_LOAD_TIME = time.time()
    return result



def _resolve_gradient_profile_for_project(project_name: str, centerline: LineString) -> "dict | None":
    catalog = _load_gradient_profile_catalog()
    if not catalog or centerline is None:
        return None

    project_path_key = None
    project_dataset = None
    try:
        proj = get_ctx()["pm"].project(project_name)
        project_path_key = getattr(proj.metadata, "path_key", None)
        project_dataset = getattr(proj.metadata, "dataset", None)
    except Exception:
        project_path_key = None
        project_dataset = None

    if project_path_key:
        direct_match = catalog.get(project_path_key)
        if direct_match:
            return direct_match

        normalized_override = _normalize_gradient_token(project_path_key)
        for meta in catalog.values():
            aliases = meta.get("_aliases") or set()
            if normalized_override in aliases:
                return meta

    project_aliases = {_normalize_gradient_token(project_name), _strip_survey_suffix(project_name)}
    if project_dataset:
        project_aliases.add(_normalize_gradient_token(project_dataset))
        project_aliases.add(_strip_survey_suffix(project_dataset))
    project_aliases.discard("")
    project_bounds = centerline.bounds
    project_length = float(centerline.length)

    exact_matches = []
    fallback_matches = []
    for meta in catalog.values():
        aliases = meta.get("_aliases") or set()
        meta_len = float(meta.get("centerline_length_m") or 0.0)
        len_diff = abs(project_length - meta_len) if meta_len else float("inf")

        if aliases & project_aliases:
            exact_matches.append((len_diff, meta))
            continue

        bounds = meta.get("_bounds")
        if bounds is None:
            continue
        dist = _rect_distance(project_bounds, bounds)
        fallback_matches.append((dist, len_diff, meta))

    if exact_matches:
        exact_matches.sort(key=lambda item: item[0])
        return exact_matches[0][1]

    if fallback_matches:
        fallback_matches.sort(key=lambda item: (item[0], item[1]))
        best_dist, best_len_diff, best_meta = fallback_matches[0]
        best_len = float(best_meta.get("centerline_length_m") or project_length)
        if best_dist <= 50.0 and best_len_diff <= max(75.0, 0.35 * best_len):
            return best_meta

    return None


def _nearest_chainage_index(chainages: list[float], target: float) -> "int | None":
    if not chainages:
        return None
    idx = bisect_left(chainages, target)
    if idx <= 0:
        return 0
    if idx >= len(chainages):
        return len(chainages) - 1
    left = chainages[idx - 1]
    right = chainages[idx]
    return idx - 1 if abs(target - left) <= abs(right - target) else idx


def _get_project_gradient_mapping(project_name: str) -> dict[str, tuple[int, float]]:
    cached = _PROJECT_GRADIENT_CACHE.get(project_name)
    if cached is not None:
        return cached

    # Serialise the cold-cache build so concurrent requests don't all run the
    # non-thread-safe GDAL/Shapely work at once. Re-check inside the lock: another
    # thread may have finished building while we waited.
    with _GRADIENT_CACHE_LOCK:
        cached = _PROJECT_GRADIENT_CACHE.get(project_name)
        if cached is not None:
            return cached

        mapping: dict[str, tuple[int, float]] = {}
        _PROJECT_GRADIENT_CACHE[project_name] = mapping
        _PROJECT_GRADIENT_CACHE_STATE[project_name] = _GRADIENT_CACHE_STATE_PROFILE_MISSING

        if not project_name:
            return mapping

        try:
            ctx = get_ctx()
            proj: Project = ctx["pm"].project(project_name)
            gpkg_path = proj.project_path / "geo_data.gpkg"
            if not gpkg_path.exists():
                logger.debug(f"[Gradient] no geo_data.gpkg for project '{project_name}'")
                return mapping

            gdf = gpd.read_file(gpkg_path)
            if gdf.empty or "Image Reference" not in gdf.columns:
                logger.debug(f"[Gradient] project '{project_name}' has no usable Image Reference column in geo_data.gpkg")
                return mapping

            if gdf.crs is None:
                gdf = gdf.set_crs("EPSG:3414")
            elif gdf.crs.to_epsg() != 3414:
                gdf = gdf.to_crs(epsg=3414)

            centerline = _stitch_gradient_centerline(gdf)
            if centerline is None:
                logger.debug(f"[Gradient] project '{project_name}' has no usable centerline for gradient lookup")
                return mapping

            meta = _resolve_gradient_profile_for_project(project_name, centerline)
            if not meta:
                logger.debug(f"[Gradient] no matching profile found for project '{project_name}'")
                return mapping

            _PROJECT_GRADIENT_CACHE_STATE[project_name] = _GRADIENT_CACHE_STATE_PROFILE_AVAILABLE

            profile_df = pd.read_csv(meta["_profile_path"])
            if profile_df.empty or "chainage_m" not in profile_df.columns:
                logger.warning(f"[Gradient] profile CSV missing chainage_m for '{meta.get('path_key')}'")
                return mapping

            profile_df = profile_df.sort_values("chainage_m").reset_index(drop=True)
            chainages = [float(v) for v in profile_df["chainage_m"].tolist()]
            if len(chainages) > 1:
                diffs = [chainages[i] - chainages[i - 1] for i in range(1, len(chainages))]
                step = float(pd.Series(diffs).median())
            else:
                step = 0.0
            tolerance = max(step * 1.5, 1.0)

            for _, row in gdf.iterrows():
                image_ref = str(row.get("Image Reference") or "").strip()
                geom = row.geometry
                if not image_ref or geom is None or geom.is_empty:
                    continue
                if geom.geom_type == "MultiLineString":
                    parts = list(geom.geoms)
                    if not parts:
                        continue
                    geom = max(parts, key=lambda g: g.length)
                if geom.geom_type != "LineString":
                    continue

                midpoint = geom.interpolate(0.5, normalized=True)
                chainage = float(centerline.project(midpoint))
                idx = _nearest_chainage_index(chainages, chainage)
                if idx is None:
                    continue
                profile_row = profile_df.iloc[idx]
                profile_chainage = float(profile_row.get("chainage_m", float("nan")))
                if math.isnan(profile_chainage) or abs(profile_chainage - chainage) > tolerance:
                    continue

                grade_raw = profile_row.get("Grade")
                grad_raw = profile_row.get("gradient_pct")
                if pd.isna(grade_raw) or pd.isna(grad_raw):
                    continue

                grade_coded = int(float(grade_raw))
                gradient_pct = float(grad_raw)
                if grade_coded in (1, 2):
                    mapping[image_ref] = (grade_coded, gradient_pct)

            logger.info(
                f"[Gradient] project '{project_name}' -> profile '{meta.get('path_key')}' mapped {len(mapping)} image refs",
            )
        except Exception as exc:
            logger.warning(f"[Gradient] WARNING: failed to build project gradient cache for '{project_name}': {exc}")

        return mapping


def _get_project_gradient_cache_state(project_name: str) -> str:
    _get_project_gradient_mapping(project_name)
    return _PROJECT_GRADIENT_CACHE_STATE.get(project_name, _GRADIENT_CACHE_STATE_PROFILE_MISSING)


def _lookup_project_gradient(project_name: str, image_ref: str) -> "tuple[int, float] | None":
    mapping = _get_project_gradient_mapping(project_name)
    if not mapping:
        return None
    if image_ref in mapping:
        return mapping[image_ref]

    if project_name and not image_ref.startswith(project_name + "_"):
        prefixed = f"{project_name}_{image_ref}"
        if prefixed in mapping:
            return mapping[prefixed]

    bare = image_ref.split("_", 1)[-1] if "_" in image_ref else image_ref
    for key, value in mapping.items():
        if key.endswith(bare) or bare.endswith(key):
            return value
    return None


def _inject_grade(image_ref: str, updates: dict, sources: "dict | None" = None,
                   project_name: str = "") -> "float | None":
    """Inject Grade from the master gradient profile into *updates* (in-place).
    The master profile is keyed by path_key + chainage; image refs are only used
    inside a per-project cache built from the current project's geometry.
    Returns grade_pct if found, else None.
    """
    try:
        hit = _lookup_project_gradient(project_name, image_ref)
        if not hit:
            # A project's segments are either all "Not Assessed" (no profile exists)
            # or all "No LiDAR" for unmatched segments (profile exists, segment outside
            # profiled chainage). Use the mapping content as the primary signal: if any
            # segment in this project resolved to a gradient value, the profile IS present
            # and this segment's miss means no LiDAR coverage at that chainage.
            mapping = _get_project_gradient_mapping(project_name)
            profile_found = bool(mapping) or (
                _PROJECT_GRADIENT_CACHE_STATE.get(project_name) == _GRADIENT_CACHE_STATE_PROFILE_AVAILABLE
            )
            gradient_status = (
                GRADIENT_STATUS_NO_LIDAR_RESULT if profile_found
                else GRADIENT_STATUS_NOT_ASSESSED
            )
            updates["Grade"] = None
            updates["Gradient %"] = None
            updates[GRADIENT_STATUS_FIELD] = gradient_status
            if sources is not None:
                sources["Grade"] = "Gradient Profile"
                sources["Gradient %"] = "Gradient Profile"
                sources[GRADIENT_STATUS_FIELD] = "Gradient Profile"
            logger.debug(
                f"[Gradient] no profile entry for '{image_ref}' in project '{project_name}'"
                f" -> {gradient_status}",
            )
            return None
        grade_coded, grade_pct = hit
        logger.debug(f"[Gradient] {image_ref}: {grade_pct:+.2f}% -> Grade {grade_coded}")
        if grade_coded not in (1, 2):
            logger.warning(f"[Gradient] WARNING: unexpected Grade value {grade_coded!r} for {image_ref} — skipping")
            return None
        updates["Grade"] = grade_coded
        updates["Gradient %"] = round(grade_pct, 2)
        updates[GRADIENT_STATUS_FIELD] = None
        if sources is not None:
            sources["Grade"] = "Gradient Profile"
            sources["Gradient %"] = "Gradient Profile"
            sources[GRADIENT_STATUS_FIELD] = "Gradient Profile"
        return grade_pct
    except Exception as _e:
        logger.warning(f"[Gradient] WARNING: error injecting Grade for {image_ref}: {_e}")
        return None
