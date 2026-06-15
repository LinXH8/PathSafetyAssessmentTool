# app/api/projects/routes.py
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

_INIT_LOCK = threading.Lock()
_INIT_ERR = {"cv": None}

_GIS_INSTANCE: "gis.GIS | None" = None
_ROAD_SECTIONS_GDF: gpd.GeoDataFrame | None = None
_PLANNING_AREAS_GDF: gpd.GeoDataFrame | None = None
_KNOWN_ROAD_NAMES: list[str] | None = None
_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".tif"}
_SOURCE_FOLDER_METADATA_FILENAME = "psat-folder-summary.json"
_SOURCE_FOLDER_METADATA_VERSION = 1
_QUARTER_SUFFIX_RE = re.compile(r"(?:[_\-\s]+(?:[1-4]Q\d{4}|Q[1-4]\d{4}))(?:__\d+)?$", re.IGNORECASE)


def _get_road_sections_gdf() -> gpd.GeoDataFrame:
    global _ROAD_SECTIONS_GDF
    if _ROAD_SECTIONS_GDF is not None:
        return _ROAD_SECTIONS_GDF

    backend_root = Path(__file__).resolve().parents[3]
    road_shp_candidates = [
        backend_root / "shapefiles" / "planningareas" / "ROADSECTIONLINE.shp",
        backend_root / "shapefiles" / "Road_name" / "ROADSECTIONLINE.shp",
        backend_root / "shapefiles" / "Road_name" / "ROADNETWORKLINE.shp",
    ]
    road_shp = next((candidate for candidate in road_shp_candidates if candidate.exists()), None)
    if road_shp is None:
        raise FileNotFoundError("No road sections shapefile found")

    gdf = gpd.read_file(str(road_shp))
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)

    _ROAD_SECTIONS_GDF = gdf
    return _ROAD_SECTIONS_GDF


def _get_planning_areas_gdf() -> gpd.GeoDataFrame:
    global _PLANNING_AREAS_GDF
    if _PLANNING_AREAS_GDF is not None:
        return _PLANNING_AREAS_GDF

    backend_root = Path(__file__).resolve().parents[3]
    planning_shp = backend_root / "shapefiles" / "planningareas" / "G_MP25_PLNG_AREA_NO_SEA_PL.shp"
    if not planning_shp.exists():
        raise FileNotFoundError("Planning areas shapefile not found")

    gdf = gpd.read_file(str(planning_shp))
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)

    _PLANNING_AREAS_GDF = gdf
    return _PLANNING_AREAS_GDF

def _get_gis() -> "gis.GIS":
    global _GIS_INSTANCE
    if _GIS_INSTANCE is not None:
        return _GIS_INSTANCE
    with _INIT_LOCK:
        if _GIS_INSTANCE is None:
            # backend/app/api/projects/routes.py -> backend is parents[3]
            shp_dir = (Path(__file__).resolve().parents[3] / "shapefiles").resolve()
            print(f"[GIS] Initializing with shp_dir: {shp_dir}")
            if not shp_dir.exists():
                print(f"[GIS] ERROR: Shapefile directory NOT FOUND at {shp_dir}")
                # Try fallback parent logic if needed, but resolve() should be correct
                raise FileNotFoundError(f"Shapefile directory not found: {shp_dir}")
            _GIS_INSTANCE = gis.GIS(gis.LayerStore.default(base_dir=str(shp_dir)))
            print(f"[GIS] Instance created successfully.")
    return _GIS_INSTANCE


def warmup_gis() -> None:
    """Pre-warm the GIS singleton in a background thread at app startup.

    Called once from create_app() so shapefiles are loaded before the first
    real request arrives, eliminating the cold-start penalty for end users.
    Any error is logged but never raised — the app remains fully functional,
    _get_gis() will just re-attempt construction on first use.
    """
    import threading

    def _warm():
        try:
            g = _get_gis()
            # Pre-load all registered layers so the first toggle is instant
            g.store.reload()
        except Exception as exc:  # pragma: no cover
            import logging
            logging.getLogger(__name__).warning("GIS warmup failed: %s", exc)

    t = threading.Thread(target=_warm, name="gis-warmup", daemon=True)
    t.start()

# Counts nested inference scopes.  PATCH handlers check this and
# return immediately (no-op 200) so they don't hold the GIL during inference.
_INFERENCE_DEPTH = 0


# —— Reuse your existing service layer —— #
from app.services.project_manager import project_manager, Project   # If the path is different, change to your real package path
import app.services.serializer as serializer
import app.services.cycleRAP_interface as CRI
import app.services.cycleRAP_VA as cycleRAP_VA

from pathlib import Path
from app.services import prediction as cv_pred
from app.services import gis_mapping as gis
import app.services.global_var as global_var


# ===== Treatment Definitions (must match frontend exactly) =====
TREATMENTS = [
    {
        "id": 1,
        "name": "Upgrade to on-road bicycle lane with light segregation",
        "triggers": [
            {"Facility Type": [5], "Light Segregation": [2]},
            {"Facility Type": [6], "Light Segregation": [2]},
            {"Facility Type": [1, 2], "Number of lanes – adjacent road": [1], "Peak pedestrian flow along or across facility": [3]},
            {"Facility Type": [1, 2], "Number of lanes – adjacent road": [1]},
        ],
        "effects": {"Facility Type": 4, "Light Segregation": 1, "Facility access": 1}
    },
    {
        "id": 2,
        "name": "Safety barrier (Adjacent road 0-1m)",
        "triggers": [
            {"Facility Type": [4, 5, 6], "Adjacent Road Lane 0-1m": [1], "Intersection or Road Crossing": [2]},
            {"Facility Type": [4, 5, 6], "Adjacent Road Lane 0-1m": [1], "Curvature": [1], "Intersection or Road Crossing": [2]},
            {"Facility Type": [3, 4, 5, 6], "Adjacent Road Lane 0-1m": [1], "Intersection or Road Crossing": [2]},
        ],
        "effects": {"Adjacent Road Lane 0-1m": 2, "Facility access": 1}
    },
    {
        "id": 3,
        "name": "Safety barrier (Adjacent road 1-3m)",
        "triggers": [
            {"Facility Type": [4, 5, 6], "Adjacent Road Lane 1-3m": [1], "Intersection or Road Crossing": [2]},
            {"Facility Type": [3, 4, 5, 6], "Adjacent Road Lane 1-3m": [1], "Intersection or Road Crossing": [2]},
        ],
        "effects": {"Adjacent Road Lane 1-3m": 2, "Facility access": 1}
    },
    {
        "id": 4,
        "name": "Upgrade to cycling-priority street",
        "triggers": [
            {"Facility Type": [1, 2, 5, 6], "Property Access": [1]},
        ],
        "effects": {"Facility access": 1}
    },
    {
        "id": 5,
        "name": "Upgrade to multi-use path",
        "triggers": [
            {"Facility Type": [1, 2, 5, 6], "Property Access": [1]},
        ],
        "effects": {"Facility Type": 2, "Facility Width per Direction": 3, "Facility access": 1}
    },
    {
        "id": 6,
        "name": "Upgrade to off-road bicycle path",
        "triggers": [
            {"Facility Type": [1, 2, 5, 6], "Property Access": [1]},
        ],
        "effects": {"Facility Type": 3, "Facility access": 1}
    },
    {
        "id": 7,
        "name": "Convert to one-way facility",
        "triggers": [
            {"Facility Type": [4, 5, 6], "Flow Direction": [2]},
        ],
        "effects": {"Flow Direction": 1, "Facility access": 1}
    },
    {
        "id": 8,
        "name": "Improve surface conditions",
        "triggers": [
            {"Loose or slippery surface": [1]},
        ],
        "effects": {"Loose or slippery surface": 2, "Major Surface Deformation or Drain Opening": 2}
    },
    {
        "id": 9,
        "name": "Install light segregation",
        "triggers": [
            {"Light Segregation": [2]},
        ],
        "effects": {"Light Segregation": 1}
    },
    {
        "id": 10,
        "name": "Install street lighting",
        "triggers": [
            {"Street Lighting": [2]},
        ],
        "effects": {"Street Lighting": 1}
    },
    {
        "id": 11,
        "name": "Remove fixed obstacles",
        "triggers": [
            {"Fixed Obstacle on Facility": [1]},
        ],
        "effects": {"Fixed Obstacle on Facility": 2}
    },
    {
        "id": 12,
        "name": "Remove non-fixed obstacles",
        "triggers": [
            {"Non-Fixed Obstacle on Facility": [1]},
        ],
        "effects": {"Non-Fixed Obstacle on Facility": 2}
    },
    {
        "id": 13,
        "name": "Remove width restriction",
        "triggers": [
            {"Width Restriction": [1]},
        ],
        "effects": {"Width Restriction": 2}
    },
    {
        "id": 14,
        "name": "Improve facility access",
        "triggers": [
            {"Facility access": [2]},
        ],
        "effects": {"Facility access": 1}
    },
    {
        "id": 15,
        "name": "Redesign sharp curves",
        "triggers": [
            {"Curvature": [1]},
        ],
        "effects": {"Curvature": 2}
    },
    {
        "id": 16,
        "name": "Widen the facility",
        "triggers": [
            {"Facility Width per Direction": [1, 2]},
        ],
        "effects": {"Facility Width per Direction": 3}
    },
    {
        "id": 17,
        "name": "Install protective barrier",
        "triggers": [
            {"Adjacent Severe Hazard 0-1m": [1]},
        ],
        "effects": {"Adjacent Severe Hazard 0-1m": 2}
    },
    {
        "id": 18,
        "name": "Improve delineation",
        "triggers": [
            {"Delineation": [2]},
        ],
        "effects": {"Delineation": 1}
    },
    {
        "id": 19,
        "name": "Review intersection approach",
        "triggers": [
            {"Intersection Approach": [1]},
        ],
        "effects": {"Intersection Approach": 2}
    },
    {
        "id": 20,
        "name": "Improve crossing facility",
        "triggers": [
            {"Crossing Facility": [2]},
        ],
        "effects": {"Crossing Facility": 1}
    },
    {
        "id": 21,
        "name": "Evaluate grade separation",
        "triggers": [
            {"Intersection or Road Crossing": [1]},
        ],
        "effects": {"Intersection or Road Crossing": 2}
    },
    {
        "id": 22,
        "name": "Reconfigure/remove parking",
        "triggers": [
            {"Adjacent Vehicle Parking 0-1m": [1]},
        ],
        "effects": {"Adjacent Vehicle Parking 0-1m": 2}
    },
    {
        "id": 23,
        "name": "Review tram/train rails",
        "triggers": [
            {"Tram or Train Rails": [1]},
        ],
        "effects": {"Tram or Train Rails": 2}
    },
    {
        "id": 24,
        "name": "Install traffic calming",
        "triggers": [
            {"Facility Type": [4], "Intersection or Road Crossing": [2], "Adjacent Road Lane 0-1m": [1]},
        ],
        "effects": {}
    },
    {
        "id": 25,
        "name": "Bicycle speed control",
        "triggers": [
            {"Bicycle/LV speed – average": [2]},
        ],
        "effects": {"Bicycle/LV speed – average": 1}
    },
]

# util
def ok(data, code=200):
    return jsonify(data), code

def fail(message, code=400):
    return jsonify({"error": message}), code

def df_to_records(df) -> list:
    """Convert a DataFrame to JSON-safe records, replacing NaN/Inf with None."""
    records = df.to_dict(orient="records")
    sanitized = []
    for row in records:
        clean = {}
        for k, v in row.items():
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                clean[k] = None
            else:
                clean[k] = v
        sanitized.append(clean)
    return sanitized

# Process-level context (replaces Streamlit's session_state)
_CTX = {"ready": False, "pm": None, "init_error": None}
_CTX_LOCK = threading.Lock()


def invalidate_ctx() -> None:
    """Reset the project context so the next request re-initialises for the active profile."""
    with _CTX_LOCK:
        _CTX["ready"] = False
        _CTX["pm"] = None
        _CTX["init_error"] = None


def get_ctx():
    """Lazy init: prepare the old-code dependencies the first time and reuse thereafter."""
    with _CTX_LOCK:
        if _CTX["ready"]:
            return _CTX

        # Surface a previously memoised init failure immediately.
        if _CTX["init_error"]:
            raise RuntimeError(f"Project context failed to initialise: {_CTX['init_error']}")

        print("[Context] Initialising project context...", flush=True)
        try:
            pm = project_manager()
        except Exception as exc:
            msg = f"project_manager() failed: {exc}\n{traceback.format_exc()}"
            print(f"[Context] ERROR: {msg}", flush=True)
            _CTX["init_error"] = msg
            raise RuntimeError(f"Project context failed to initialise: {msg}") from exc

        try:
            serializer.data_loader.initialise()
        except Exception:
            pass

        try:
            CRI.cycleRAP_interface.initialise(pm.src_path / "CycleRAP")
        except Exception as exc:
            msg = f"cycleRAP_interface.initialise() failed: {exc}\n{traceback.format_exc()}"
            print(f"[Context] ERROR: {msg}", flush=True)
            _CTX["init_error"] = msg
            raise RuntimeError(f"Project context failed to initialise: {msg}") from exc

        # If a profile is active, redirect the project manager to that profile's project root
        # instead of the legacy ../data directory from config.json.
        try:
            from app.services import profile_store as _ps
            active_id = _ps.get_active_profile_id()
            if active_id:
                profile_projects_root = _ps.get_profile_projects_root(active_id)
                if profile_projects_root.exists():
                    pm.des_path = profile_projects_root
                    pm._discover_projects()
        except Exception as _exc:
            print(f"[Context] Could not resolve profile projects root: {_exc}", flush=True)

        _CTX.update({"pm": pm, "ready": True, "init_error": None})
        print("[Context] Project context ready.", flush=True)
        return _CTX

_MODELS_READY = {"cv": False}

def _ensure_models_ready():
    """Load CV / GIS only once (thread-safe). Memoize init errors as 503."""
    with _INIT_LOCK:
        # If CV init failed before, short-circuit with 503
        if _INIT_ERR["cv"]:
            raise ServiceUnavailable(_INIT_ERR["cv"])

        if not _MODELS_READY["cv"]:
            try:
                ctx = get_ctx()
                pm = ctx["pm"]

                # Model dir resolution:
                # 1) env: MODEL_DIR
                # 2) common dirs near repo/backend/src
                from os import getenv
                from pathlib import Path as _P

                candidates = []
                env_dir = getenv("MODEL_DIR")
                if env_dir:
                    candidates.append(_P(env_dir))

                repo_root = _P(__file__).resolve().parents[3]  # .../backend
                candidates += [
                    repo_root / "model",
                    repo_root / "models",
                    pm.src_path.parent / "model",
                    pm.src_path.parent / "models",
                ]

                model_dir = None
                for d in candidates:
                    if (d / "path_segmentation.pt").exists():
                        model_dir = d.resolve()
                        break

                if model_dir is None:
                    tried = "\n".join(str(p) for p in candidates)
                    raise RuntimeError(f"Cannot find model_dir (missing path_segmentation.pt). Tried:\n{tried}")

                # YOLO models load
                print(f"[Autocode] Loading CV models from {model_dir} — this may take several minutes on CPU...", flush=True)
                cv_pred.CycleRAP_Coding_Helper.initialise(model_dir)
                _MODELS_READY["cv"] = True
                print("[Autocode] CV models loaded successfully.", flush=True)

            except Exception as e:
                _INIT_ERR["cv"] = f"CV init failed: {e}"
                print(f"[Autocode] ERROR: CV model init failed: {e}", flush=True)
                # Next calls will short-circuit quickly
                raise ServiceUnavailable(_INIT_ERR["cv"])


def _warmup_models_in_background():
    """Daemon thread: pre-load CV + GIS at server startup so the first autocode request is fast."""
    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed
    # Small delay to let Flask finish starting up before we hammer the CPU
    time.sleep(2)
    print("[Autocode] Background warmup: starting model pre-load...", flush=True)
    try:
        _ensure_models_ready()
        print("[Autocode] Background warmup: CV models ready.", flush=True)
    except Exception as e:
        print(f"[Autocode] Background warmup (CV) failed: {e}", flush=True)

    # Pre-load GIS shapefiles in parallel threads (I/O + C extensions release GIL)
    try:
        print("[GIS] Background warmup: loading shapefiles in parallel...", flush=True)
        t_total = time.perf_counter()
        _inst = _get_gis()
        layer_names = list(_inst.store.paths.keys())

        def _load_one(name):
            t0 = time.perf_counter()
            _inst.store.get(name)
            return time.perf_counter() - t0

        with ThreadPoolExecutor(max_workers=6, thread_name_prefix="gis-load") as pool:
            futs = {pool.submit(_load_one, n): n for n in layer_names}
            for fut in as_completed(futs):
                name = futs[fut]
                try:
                    elapsed = fut.result()
                    print(f"[GIS] Loaded: {name} ({elapsed:.1f}s)", flush=True)
                except Exception as exc:
                    print(f"[GIS] Warning: {name}: {exc}", flush=True)

        elapsed_total = time.perf_counter() - t_total
        print(f"[GIS] Background warmup complete ({elapsed_total:.1f}s total).", flush=True)
    except Exception as e:
        print(f"[GIS] Background warmup failed: {e}", flush=True)


# Kick off background warmup immediately when this module is imported (server start)
_warmup_thread = threading.Thread(target=_warmup_models_in_background, daemon=True, name="model-warmup")
_warmup_thread.start()


# ───────────────────────── Gradient lookup (module-level) ─────────────────────
# Catalog is rebuilt automatically when new profiles appear on disk.
_GRADIENT_PROFILE_CATALOG: "dict[str, dict] | None" = None
_GRADIENT_CATALOG_LOAD_TIME: float = 0.0
_PROJECT_GRADIENT_CACHE: dict[str, dict[str, tuple[int, float]]] = {}
_PROJECT_GRADIENT_CACHE_STATE: dict[str, str] = {}

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
                print("[Gradient] new profiles detected — rebuilding catalog", flush=True)
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
                print(f"[Gradient] skipping profile '{meta_path.parent.name}' with no valid gradients")
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
            print(f"[Gradient] WARNING: failed to read profile metadata {meta_path}: {exc}")

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
    if project_name in _PROJECT_GRADIENT_CACHE:
        return _PROJECT_GRADIENT_CACHE[project_name]

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
            print(f"[Gradient] no geo_data.gpkg for project '{project_name}'")
            return mapping

        gdf = gpd.read_file(gpkg_path)
        if gdf.empty or "Image Reference" not in gdf.columns:
            print(f"[Gradient] project '{project_name}' has no usable Image Reference column in geo_data.gpkg")
            return mapping

        if gdf.crs is None:
            gdf = gdf.set_crs("EPSG:3414")
        elif gdf.crs.to_epsg() != 3414:
            gdf = gdf.to_crs(epsg=3414)

        centerline = _stitch_gradient_centerline(gdf)
        if centerline is None:
            print(f"[Gradient] project '{project_name}' has no usable centerline for gradient lookup")
            return mapping

        meta = _resolve_gradient_profile_for_project(project_name, centerline)
        if not meta:
            print(f"[Gradient] no matching profile found for project '{project_name}'")
            return mapping

        _PROJECT_GRADIENT_CACHE_STATE[project_name] = _GRADIENT_CACHE_STATE_PROFILE_AVAILABLE

        profile_df = pd.read_csv(meta["_profile_path"])
        if profile_df.empty or "chainage_m" not in profile_df.columns:
            print(f"[Gradient] profile CSV missing chainage_m for '{meta.get('path_key')}'")
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

        print(
            f"[Gradient] project '{project_name}' -> profile '{meta.get('path_key')}' mapped {len(mapping)} image refs",
            flush=True,
        )
    except Exception as exc:
        print(f"[Gradient] WARNING: failed to build project gradient cache for '{project_name}': {exc}", flush=True)

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


def _display_source_name_from_namespace(namespace: str) -> str:
    return re.sub(r"\s+", " ", namespace.replace("_", " ").strip()).title()


def _build_source_namespace_map(in_path: Path) -> dict[str, str]:
    namespace_map: dict[str, str] = {}
    if not in_path.exists():
        return namespace_map

    for child_name in os.listdir(in_path):
        child_path = in_path / child_name
        if not child_path.is_dir():
            continue
        namespace_map[make_image_namespace(child_name).lower()] = child_name
    return namespace_map


def _get_project_source_folders(proj: Project, pm) -> list[str]:
    metadata_sources = getattr(proj.metadata, "source_folders", None) or []
    cleaned_sources: list[str] = []
    seen_sources: set[str] = set()
    for source in metadata_sources:
        source_name = str(source or "").strip()
        if not source_name or source_name in seen_sources:
            continue
        cleaned_sources.append(source_name)
        seen_sources.add(source_name)
    if cleaned_sources:
        return cleaned_sources

    dataset_name = str(getattr(proj.metadata, "dataset", "") or "").strip()
    if dataset_name and dataset_name != "MULTI_FOLDER_SELECTION":
        return [dataset_name]

    try:
        geo_df = proj.geo_data.df
    except Exception:
        geo_df = None

    if geo_df is None or geo_df.empty or "Image Reference" not in geo_df.columns:
        return []

    namespace_map = _build_source_namespace_map(pm.in_path)
    project_prefix = f"{proj.metadata.project_name}_"
    derived_sources: list[str] = []
    seen_sources.clear()

    for image_ref in geo_df["Image Reference"].dropna().astype(str):
        normalized_ref = image_ref.strip()
        if not normalized_ref:
            continue
        if normalized_ref.startswith(project_prefix):
            normalized_ref = normalized_ref[len(project_prefix):]
        if "__" not in normalized_ref:
            continue

        namespace = normalized_ref.split("__", 1)[0].strip("_")
        if not namespace:
            continue

        source_name = namespace_map.get(namespace.lower()) or _display_source_name_from_namespace(namespace)
        if source_name in seen_sources:
            continue
        derived_sources.append(source_name)
        seen_sources.add(source_name)

    return derived_sources


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
            print(
                f"[Gradient] no profile entry for '{image_ref}' in project '{project_name}'"
                f" -> {gradient_status}",
                flush=True,
            )
            return None
        grade_coded, grade_pct = hit
        print(f"[Gradient] {image_ref}: {grade_pct:+.2f}% -> Grade {grade_coded}", flush=True)
        if grade_coded not in (1, 2):
            print(f"[Gradient] WARNING: unexpected Grade value {grade_coded!r} for {image_ref} — skipping")
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
        print(f"[Gradient] WARNING: error injecting Grade for {image_ref}: {_e}")
        return None


# ───────────────────────── Endpoints ─────────────────────────

@bp.before_request
def _log_incoming():
    print(f"[Flask] >>> {request.method} {request.path}", flush=True)
    try:
        get_ctx()
    except Exception as exc:
        return jsonify({"error": f"Backend initialisation failed: {exc}"}), 500

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

@bp.post("/<project_name>/segments/delete-batch")
def delete_segments_batch(project_name):
    """
    Batch delete segments from a project at user-specified indices.
    POST body: { "indices": [0, 1, 5] }
    """
    ctx = get_ctx()
    pm = ctx["pm"]
    project = pm.project(project_name)
    if project is None:
        abort(404, description="Project not found")

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
        project.delete_segments(indices)
    except Exception as e:
        traceback.print_exc()
        abort(500, description=f"Failed to delete segments: {e}")

    # Return updated metadata
    meta = project.metadata.to_dict() if project.metadata else {}
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
def delete_segment(project_name: str, segment_index: int):
    """
    Delete a specific segment (point) from the project.
    """
    try:
        ctx = get_ctx()
        pm = ctx["pm"]
        proj = pm.project(project_name)
        
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

@bp.get("/<project_name>")
def get_project(project_name: str):
    """Read project metadata and available versions (read-only)."""
    ctx = get_ctx()
    proj: Project = ctx["pm"].project(project_name)
    ver = proj.latest()
    return jsonify({
        "name": proj.metadata.project_name,
        "versions": [v.path.name for v in proj.versions],
        "latest": ver.path.name
    })

@bp.get("/<project_name>/metadata")
def get_project_metadata(project_name: str):
    """Get project metadata including verified status and verified segment count."""
    ctx = get_ctx()
    proj: Project = ctx["pm"].project(project_name)
    return jsonify({
        "name": proj.metadata.project_name,
        "tags": proj.metadata.tags or [],
        "dataset": getattr(proj.metadata, 'dataset', None),
        "source_folders": _get_project_source_folders(proj, ctx["pm"]),
        "verified": getattr(proj.metadata, 'verified', False),
        "verified_segment_count": getattr(proj.metadata, 'verified_segment_count', 0),
        "autocoded_segment_count": getattr(proj.metadata, 'autocoded_segment_count', 0),
        "path_key": getattr(proj.metadata, 'path_key', None),
        "date_created": proj.metadata.date_created.isoformat() if hasattr(proj.metadata, 'date_created') and proj.metadata.date_created else None,
        "last_updated": proj.metadata.last_updated.isoformat() if hasattr(proj.metadata, 'last_updated') and proj.metadata.last_updated else None
    })

@bp.get("/<project_name>/versions/latest/attributes")
def get_latest_attributes(project_name: str):
    """Return the latest attributes.csv (converted to JSON for front-end table rendering).

    Also includes calculated band values (VB Band, BB Band, SB Band, BP Band) if they exist
    in the results, so filtering can use these calculated values.
    """
    ctx = get_ctx()
    proj: Project = ctx["pm"].project(project_name)
    ver = proj.latest()

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
            attrs_df.loc[no_grade & stale_status, GRADIENT_STATUS_FIELD] = GRADIENT_STATUS_NO_LIDAR_RESULT

    return jsonify({"rows": df_to_records(attrs_df)})

def _rmtree_robust(path: Path) -> bool:
    """Delete a directory tree, working around Windows file-lock races.

    Tries shutil.rmtree first; on failure deletes files one-by-one then removes
    the (hopefully now-empty) directory. Returns True when the directory is gone.
    """
    if not path.is_dir():
        return True
    try:
        shutil.rmtree(str(path))
        return not path.exists()
    except Exception:
        pass
    # File-by-file fallback (handles Windows thumbnail/AV lock races)
    for item in sorted(path.rglob("*"), reverse=True):
        try:
            if item.is_file() or item.is_symlink():
                item.unlink()
            elif item.is_dir():
                item.rmdir()
        except Exception:
            pass
    try:
        path.rmdir()
    except Exception:
        pass
    return not path.exists()


def _migrate_legacy_images(pm, project_name: str, proj) -> bool:
    """Convert a legacy project that stores copies in images/ to reference in/ directly.

    Strips the project-title prefix from every Image Reference in geo_data.gpkg,
    verifies each stripped name resolves to a file under in/, then deletes images/.
    Runs quietly — prints to stdout so Flask terminal shows progress.
    """
    try:
        images_dir = proj.project_path / global_var.PROJECT_IMAGES_FOLDER
        if not images_dir.is_dir():
            return False

        source_folders = getattr(proj.metadata, "source_folders", None) or []
        if not source_folders:
            print(f"[migrate] '{project_name}': no source_folders in metadata — skipping", flush=True)
            return False

        missing = [sf for sf in source_folders if not (pm.in_path / sf).is_dir()]
        if missing:
            print(
                f"[migrate] '{project_name}': source folder(s) not present in in/ — skipping: {missing}",
                flush=True,
            )
            return False

        geo_df = proj.geo_data.df
        if geo_df.empty or "Image Reference" not in geo_df.columns:
            print(f"[migrate] '{project_name}': geo_data missing Image Reference column — skipping", flush=True)
            return False

        prefix = project_name + "_"
        ns_map = {make_image_namespace(sf): sf for sf in source_folders}

        def _strip_and_resolve(img_ref: str):
            """Return (new_canonical_ref, in_path) or None.

            Tries progressively more aggressive prefix stripping:
            1. Strip project-name prefix (legacy copy convention)
            2. Strip source-folder namespace prefix (derived from metadata, not project name)
            For multi-folder projects the returned ref is in namespace__filename form.
            """
            working = img_ref[len(prefix):] if img_ref.startswith(prefix) else img_ref
            # Build candidate bare names in priority order: with namespace, then without.
            bare_candidates: list[str] = [working]
            if "__" in working:
                bare_candidates.append(working.split("__", 1)[1])

            if len(source_folders) == 1:
                sf = source_folders[0]
                for bare in bare_candidates:
                    candidate = pm.in_path / sf / bare
                    if candidate.is_file():
                        return bare, candidate
            else:
                for bare in bare_candidates:
                    if "__" in bare:
                        ns, orig = bare.split("__", 1)
                        if ns in ns_map:
                            candidate = pm.in_path / ns_map[ns] / orig
                            if candidate.is_file():
                                return f"{ns}__{orig}", candidate
                    for sf in source_folders:
                        candidate = pm.in_path / sf / bare
                        if candidate.is_file():
                            return f"{make_image_namespace(sf)}__{bare}", candidate
            return None

        img_refs = [
            r for r in geo_df["Image Reference"].tolist()
            if isinstance(r, str) and r.strip()
        ]
        if not img_refs:
            print(f"[migrate] '{project_name}': no image refs in geo_data — skipping", flush=True)
            return False

        print(f"[migrate] '{project_name}': checking {len(img_refs)} image refs against in/...", flush=True)

        new_ref_map: dict[str, str] = {}
        for img_ref in img_refs:
            result = _strip_and_resolve(img_ref)
            if result is None:
                print(f"[migrate] '{project_name}': '{img_ref}' not found in in/ — skipping migration", flush=True)
                return False
            new_ref_map[img_ref] = result[0]

        # All images confirmed in in/ — rewrite geo_data.gpkg
        proj.geo_data.df["Image Reference"] = proj.geo_data.df["Image Reference"].apply(
            lambda r: new_ref_map.get(str(r), r) if pd.notna(r) else r
        )
        # Write to a temp file first, then replace, to avoid Windows GDAL file-lock on the
        # existing geo_data.gpkg (SQLite connections may linger after gpd.read_file).
        tmp_gpkg = proj.project_path / "_geo_data_migrating.gpkg"
        try:
            proj.geo_data.df.to_file(str(tmp_gpkg), driver="GPKG", index=False)
            gpkg_path = proj.project_path / "geo_data.gpkg"
            if gpkg_path.exists():
                gpkg_path.unlink()
            tmp_gpkg.rename(gpkg_path)
        except Exception as write_exc:
            if tmp_gpkg.exists():
                tmp_gpkg.unlink(missing_ok=True)
            raise write_exc
        print(f"[migrate] '{project_name}': geo_data.gpkg updated ({len(new_ref_map)} refs)", flush=True)

        # Delete the now-redundant images/ folder
        deleted = _rmtree_robust(images_dir)
        if deleted:
            print(f"[migrate] '{project_name}': images/ deleted. Migration complete.", flush=True)
        else:
            print(f"[migrate] '{project_name}': images/ could not be fully deleted (file lock?). Will retry next open.", flush=True)
        return True

    except Exception as exc:
        print(f"[migrate] '{project_name}': migration error: {exc}", flush=True)
        return False


@bp.get("/<project_name>/geodata")
def get_geodata(project_name: str):
    """Return the project's GeoData (GeoJSON FeatureCollection)."""
    import json
    ctx = get_ctx()  # Reuse the existing init context
    proj = ctx["pm"].project(project_name)
    _migrate_legacy_images(ctx["pm"], project_name, proj)
    gdf = proj.geo_data.df  # GeoPandas GeoDataFrame

    # GeoDataFrame -> GeoJSON string, then to dict for jsonify-friendly output
    geojson_obj = json.loads(gdf.to_json())
    return jsonify(geojson_obj)

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
    resp.headers["Cache-Control"] = "public, max-age=86400"
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


@bp.get("/attribute-mappings")
def get_attribute_mappings():
    """
    Return field mappings for Attributes (numeric -> text), e.g.:
    {
      "Area type": {"1":"Urban","2":"Suburban","3":"Rural","4":"Industrial"},
      "Facility Type": {"1":"Sidewalk", "2":"Multi-Use Path", ...},
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
        print(f"Error loading custom attribute options: {e}")
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
        print(f"Error updating custom attribute options: {e}")
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
def calculate_score(project_name: str):
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
def get_results(project_name: str):
    """
    Retrieve the latest Overall Risk Levels for a project.
    Returns the calculated results from the latest version.
    """
    try:
        ctx = get_ctx()
        proj: Project = ctx["pm"].project(project_name)
        ver = proj.latest()

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

@bp.post("/<project_name>/treatments")
def evaluate_treatments(project_name: str):
    """
    Use the Excel STM macro to generate treatment suggestions:
    - Requires GeoData + Attributes
    """
    ctx = get_ctx()
    proj: Project = ctx["pm"].project(project_name)
    ver = proj.latest()

    gdf = proj.geo_data.df
    attrs = ver.attributes.df

    treatment_tbl = CRI.cycleRAP_interface.evaluate_treatment_suggestions(gdf, attrs)
    ver._treatment = treatment_tbl
    proj.save_all()

    return jsonify({"ok": True, "rows": df_to_records(treatment_tbl.df)})


@bp.post("/<project_name>/treatments/apply")
def apply_treatments(project_name: str):
    """
    Apply selected treatments to a specific segment.

    Request body:
        {
            "segment_index": 5,
            "treatment_ids": [1, 9, 14],
            "image_ref": "FERNVALE_001.jpg"  // Optional, for tracking
        }

    Response:
        {
            "ok": true,
            "segment_index": 5,
            "treatments_applied": "1,9,14",
            "modified_attributes": { "Facility Type": 4, ... },
            "before_scores": { "BB": 2.5, "BP": 1.2, "SB": 3.1, "VB": 5.8, "Overall Risk Level": 12.6 },
            "after_scores": { "BB": 1.8, "BP": 0.9, "SB": 2.2, "VB": 3.5, "Overall Risk Level": 8.4 }
        }
    """
    try:
        ctx = get_ctx()
        proj: Project = ctx["pm"].project(project_name)
        ver = proj.latest()

        data = request.get_json(silent=True) or {}
        segment_index = data.get("segment_index")
        treatment_ids = data.get("treatment_ids", [])
        image_ref = data.get("image_ref", "")

        if segment_index is None:
            return fail("Missing segment_index", 400)

        if not isinstance(treatment_ids, list):
            return fail("treatment_ids must be a list", 400)

        # Load original attributes
        attrs_df = ver.attributes.df
        if segment_index >= len(attrs_df):
            return fail(f"Segment index {segment_index} out of range", 400)

        original_row = dict(attrs_df.iloc[segment_index])

        # Apply treatment effects
        modified_row = original_row.copy()
        for treatment_id in treatment_ids:
            if not (1 <= treatment_id <= 25):
                return fail(f"Invalid treatment ID: {treatment_id}", 400)
            treatment = TREATMENTS[treatment_id - 1]  # Convert 1-based to 0-based
            for attr_name, new_value in treatment['effects'].items():
                modified_row[attr_name] = new_value

        # Calculate before scores (from original attributes)
        original_df = pd.DataFrame([original_row])
        before_scores_df = calculate_cyclerap_score_native(original_df)
        before_scores = {
            "BB": float(before_scores_df["BB"].iloc[0]),
            "BP": float(before_scores_df["BP"].iloc[0]),
            "SB": float(before_scores_df["SB"].iloc[0]),
            "VB": float(before_scores_df["VB"].iloc[0]),
            "Overall Risk Level": float(before_scores_df["Overall Risk Level"].iloc[0])
        }

        # Calculate after scores (from modified attributes)
        modified_df = pd.DataFrame([modified_row])
        after_scores_df = calculate_cyclerap_score_native(modified_df)
        after_scores = {
            "BB": float(after_scores_df["BB"].iloc[0]),
            "BP": float(after_scores_df["BP"].iloc[0]),
            "SB": float(after_scores_df["SB"].iloc[0]),
            "VB": float(after_scores_df["VB"].iloc[0]),
            "Overall Risk Level": float(after_scores_df["Overall Risk Level"].iloc[0])
        }

        # Convert modified_row values to JSON-serializable types
        serializable_modified_row = {}
        for col, val in modified_row.items():
            if pd.notna(val):
                try:
                    if hasattr(val, 'item'):  # numpy/pandas scalar
                        serializable_modified_row[col] = val.item()
                    else:
                        serializable_modified_row[col] = val
                except (ValueError, TypeError):
                    serializable_modified_row[col] = None
            else:
                serializable_modified_row[col] = None

        # Update or create treatment.csv
        treatment_df = ver.treatment.df

        # Ensure treatment dataframe has all attribute columns
        for col in attrs_df.columns:
            if col not in treatment_df.columns:
                treatment_df[col] = ""

        # Ensure the treatment.csv has enough rows
        if len(treatment_df) <= segment_index:
            # Need to expand the dataframe
            new_rows = [treatment_df.iloc[0].copy() if len(treatment_df) > 0 else {}] * (segment_index - len(treatment_df) + 1)
            treatment_df = pd.concat([treatment_df, pd.DataFrame(new_rows)], ignore_index=True)

        # Update the row with modified attributes
        for col in modified_row.keys():
            if col in treatment_df.columns:
                treatment_df.at[segment_index, col] = modified_row[col]

        # Update "Treatments Applied" column
        if "Treatments Applied" not in treatment_df.columns:
            treatment_df.insert(0, "Treatments Applied", "")

        if treatment_ids:
            treatment_df.at[segment_index, "Treatments Applied"] = ",".join(str(tid) for tid in treatment_ids)
        else:
            treatment_df.at[segment_index, "Treatments Applied"] = ""

        # Save updated treatment.csv
        ver._treatment = serializer.Treatment()
        ver.treatment.df = treatment_df
        ver.treatment.df_dirty = True
        proj.save_all()

        # Update last_updated
        proj.metadata.last_updated = datetime.datetime.now()
        proj.metadata.serialize(proj.project_path)

        return jsonify({
            "ok": True,
            "segment_index": segment_index,
            "treatments_applied": ",".join(str(tid) for tid in treatment_ids),
            "modified_attributes": serializable_modified_row,
            "before_scores": before_scores,
            "after_scores": after_scores
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return fail(f"Error applying treatments: {str(e)}", 500)


@bp.post("/<project_name>/treatments/preview")
def preview_treatments(project_name: str):
    """
    Preview selected treatments for a specific segment without saving.
    
    Request body:
        {
            "segment_index": 5,
            "treatment_ids": [1, 9, 14]
        }

    Response:
        {
            "ok": true,
            "segment_index": 5,
            "modified_attributes": { "Facility Type": 4, ... },
            "before_scores": { "BB": 2.5, ... },
            "after_scores": { "BB": 1.8, ... }
        }
    """
    try:
        ctx = get_ctx()
        proj: Project = ctx["pm"].project(project_name)
        ver = proj.latest()

        data = request.get_json(silent=True) or {}
        segment_index = data.get("segment_index")
        treatment_ids = data.get("treatment_ids", [])

        if segment_index is None:
            return fail("Missing segment_index", 400)

        if not isinstance(treatment_ids, list):
            return fail("treatment_ids must be a list", 400)

        # Load original attributes
        attrs_df = ver.attributes.df
        if segment_index >= len(attrs_df):
            return fail(f"Segment index {segment_index} out of range", 400)

        original_row = dict(attrs_df.iloc[segment_index])

        # Apply treatment effects
        modified_row = original_row.copy()
        for treatment_id in treatment_ids:
            if not (1 <= treatment_id <= 25):
                return fail(f"Invalid treatment ID: {treatment_id}", 400)
            treatment = TREATMENTS[treatment_id - 1]  # Convert 1-based to 0-based
            for attr_name, new_value in treatment['effects'].items():
                modified_row[attr_name] = new_value

        # Calculate before scores (from original attributes)
        original_df = pd.DataFrame([original_row])
        before_scores_df = calculate_cyclerap_score_native(original_df)
        before_scores = {
            "BB": float(before_scores_df["BB"].iloc[0]),
            "BP": float(before_scores_df["BP"].iloc[0]),
            "SB": float(before_scores_df["SB"].iloc[0]),
            "VB": float(before_scores_df["VB"].iloc[0]),
            "Overall Risk Level": float(before_scores_df["Overall Risk Level"].iloc[0])
        }

        # Calculate after scores (from modified attributes)
        modified_df = pd.DataFrame([modified_row])
        after_scores_df = calculate_cyclerap_score_native(modified_df)
        after_scores = {
            "BB": float(after_scores_df["BB"].iloc[0]),
            "BP": float(after_scores_df["BP"].iloc[0]),
            "SB": float(after_scores_df["SB"].iloc[0]),
            "VB": float(after_scores_df["VB"].iloc[0]),
            "Overall Risk Level": float(after_scores_df["Overall Risk Level"].iloc[0])
        }

        # Convert modified_row values to JSON-serializable types
        serializable_modified_row = {}
        for col, val in modified_row.items():
            if pd.notna(val):
                try:
                    if hasattr(val, 'item'):  # numpy/pandas scalar
                        serializable_modified_row[col] = val.item()
                    else:
                        serializable_modified_row[col] = val
                except (ValueError, TypeError):
                    serializable_modified_row[col] = None
            else:
                serializable_modified_row[col] = None

        return jsonify({
            "ok": True,
            "segment_index": segment_index,
            "modified_attributes": serializable_modified_row,
            "before_scores": before_scores,
            "after_scores": after_scores
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return fail(f"Error previewing treatments: {str(e)}", 500)


@bp.post("/<project_name>/treatments/effectiveness")
def treatment_effectiveness(project_name: str):
    """
    Count, per treatment, how many segments in the project would have their
    Overall Risk Level Band *improve* (band decreases) if that treatment
    were applied in isolation. Used by the frontend to rank the
    "By Treatment" list top-down by effectiveness.

    Request body (optional):
        { "treatment_ids": [1, 2, 3, ...] }   # defaults to all 25

    Response:
        {
            "ok": true,
            "total_segments": 412,
            "counts": { "1": 180, "2": 0, "3": 45, ... }
        }
    """
    try:
        ctx = get_ctx()
        proj: Project = ctx["pm"].project(project_name)
        ver = proj.latest()

        data = request.get_json(silent=True) or {}
        requested_ids = data.get("treatment_ids")
        if requested_ids is None:
            requested_ids = [t["id"] for t in TREATMENTS]
        if not isinstance(requested_ids, list):
            return fail("treatment_ids must be a list", 400)

        attrs_df = ver.attributes.df
        n = len(attrs_df)
        if n == 0:
            return jsonify({
                "ok": True,
                "total_segments": 0,
                "counts": {str(tid): 0 for tid in requested_ids},
                "applicable_counts": {str(tid): 0 for tid in requested_ids},
            })

        # Baseline scoring once
        before_df = calculate_cyclerap_score_native(attrs_df)
        before_band = before_df["Overall Risk Level Band"].to_numpy()

        treatment_map = {t["id"]: t for t in TREATMENTS}
        counts: dict[str, int] = {}
        applicable_counts: dict[str, int] = {}

        for tid in requested_ids:
            if tid not in treatment_map:
                counts[str(tid)] = 0
                applicable_counts[str(tid)] = 0
                continue
            treatment = treatment_map[tid]

            # Applicability mask (vectorized): OR of trigger sets, AND within a set
            mask = pd.Series(False, index=attrs_df.index)
            for trigger_set in treatment.get("triggers", []):
                set_mask = pd.Series(True, index=attrs_df.index)
                for attr_name, valid_values in trigger_set.items():
                    if attr_name not in attrs_df.columns:
                        set_mask = pd.Series(False, index=attrs_df.index)
                        break
                    set_mask &= attrs_df[attr_name].isin(valid_values)
                mask |= set_mask

            applicable_counts[str(tid)] = int(mask.sum())

            if not mask.any():
                counts[str(tid)] = 0
                continue

            modified = attrs_df.copy()
            for attr_name, new_value in treatment.get("effects", {}).items():
                if attr_name in modified.columns:
                    modified.loc[mask, attr_name] = new_value
                else:
                    modified[attr_name] = None
                    modified.loc[mask, attr_name] = new_value

            after_df = calculate_cyclerap_score_native(modified)
            after_band = after_df["Overall Risk Level Band"].to_numpy()

            improved = ((after_band < before_band) & mask.to_numpy()).sum()
            counts[str(tid)] = int(improved)

        return jsonify({
            "ok": True,
            "total_segments": int(n),
            "counts": counts,
            "applicable_counts": applicable_counts,
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return fail(f"Error computing treatment effectiveness: {str(e)}", 500)


@bp.get("/<project_name>/treatments/effectiveness/segment/<int:segment_index>")
def treatment_segment_effectiveness(project_name: str, segment_index: int):
    """
    For a single segment, compute the Overall Risk Level score drop for each
    treatment applied in isolation. Used by the frontend to rank the
    "By Segment" treatment list top-down by per-segment effectiveness.

    Response:
        {
            "ok": true,
            "score_drops": { "1": 4.2, "3": 0.0, ... }
        }
    """
    try:
        ctx = get_ctx()
        proj: Project = ctx["pm"].project(project_name)
        ver = proj.latest()

        attrs_df = ver.attributes.df
        n = len(attrs_df)
        if segment_index < 0 or segment_index >= n:
            return fail(f"segment_index {segment_index} out of range [0, {n})", 400)

        row_df = attrs_df.iloc[[segment_index]]
        before_score = float(calculate_cyclerap_score_native(row_df)["Overall Risk Level"].iloc[0])

        score_drops: dict[str, float] = {}
        for treatment in TREATMENTS:
            tid = treatment["id"]

            applicable = True
            for trigger_set in treatment.get("triggers", []):
                set_ok = True
                for attr_name, valid_values in trigger_set.items():
                    if attr_name not in row_df.columns:
                        set_ok = False
                        break
                    if row_df[attr_name].iloc[0] not in valid_values:
                        set_ok = False
                        break
                if set_ok:
                    break
            else:
                applicable = False

            if not applicable:
                score_drops[str(tid)] = 0.0
                continue

            modified = row_df.copy()
            for attr_name, new_value in treatment.get("effects", {}).items():
                if attr_name in modified.columns:
                    modified[attr_name] = new_value
                else:
                    modified[attr_name] = new_value

            after_score = float(calculate_cyclerap_score_native(modified)["Overall Risk Level"].iloc[0])
            score_drops[str(tid)] = round(before_score - after_score, 4)

        return jsonify({"ok": True, "score_drops": score_drops})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return fail(f"Error computing segment treatment effectiveness: {str(e)}", 500)


@bp.get("/<project_name>/treatments/all")
def get_all_treatments(project_name: str):
    """
    Return treatment state for every segment in one call.

    Reads treatment.csv once and returns which segments have treatments and
    what modified attributes are stored.  Does NOT re-score — scores are
    calculated lazily per segment on demand.

    Response:
        {
            "ok": true,
            "segments": {
                "3":  { "has_treatments": true,  "treatments_applied": [1, 9], "modified_attributes": {...} },
                "17": { "has_treatments": true,  "treatments_applied": [5],    "modified_attributes": {...} }
            }
        }
    Only segments that actually have treatments are included.
    """
    try:
        ctx = get_ctx()
        proj: Project = ctx["pm"].project(project_name)
        ver = proj.latest()

        treatment_df = ver.treatment.df
        attrs_df = ver.attributes.df

        segments: dict = {}

        if treatment_df is None or treatment_df.empty or "Treatments Applied" not in treatment_df.columns:
            return jsonify({"ok": True, "segments": segments})

        for idx, row in treatment_df.iterrows():
            treatments_str = row.get("Treatments Applied", "")
            if not treatments_str or pd.isna(treatments_str) or str(treatments_str).strip() == "":
                continue

            try:
                treatment_ids = [int(x.strip()) for x in str(treatments_str).split(",") if x.strip()]
            except ValueError:
                continue

            if not treatment_ids:
                continue

            modified_attributes: dict = {}
            for col in attrs_df.columns:
                if col in treatment_df.columns and col != "Treatments Applied":
                    val = row.get(col)
                    if pd.notna(val):
                        try:
                            modified_attributes[col] = val.item() if hasattr(val, 'item') else val
                        except (ValueError, TypeError):
                            modified_attributes[col] = None
                    else:
                        modified_attributes[col] = None

            segments[str(idx)] = {
                "has_treatments": True,
                "treatments_applied": treatment_ids,
                "modified_attributes": modified_attributes,
            }

        if segments:
            # Vectorized calculation of after_scores for all segments with treatments
            modified_rows = [v["modified_attributes"] for v in segments.values()]
            idx_keys = list(segments.keys())
            modified_df = pd.DataFrame(modified_rows)
            after_scores_df = calculate_cyclerap_score_native(modified_df)
            
            for i, idx_str in enumerate(idx_keys):
                after_scores = {
                    "BB": float(after_scores_df["BB"].iloc[i].item() if hasattr(after_scores_df["BB"].iloc[i], 'item') else after_scores_df["BB"].iloc[i]),
                    "BP": float(after_scores_df["BP"].iloc[i].item() if hasattr(after_scores_df["BP"].iloc[i], 'item') else after_scores_df["BP"].iloc[i]),
                    "SB": float(after_scores_df["SB"].iloc[i].item() if hasattr(after_scores_df["SB"].iloc[i], 'item') else after_scores_df["SB"].iloc[i]),
                    "VB": float(after_scores_df["VB"].iloc[i].item() if hasattr(after_scores_df["VB"].iloc[i], 'item') else after_scores_df["VB"].iloc[i]),
                    "Overall Risk Level": float(after_scores_df["Overall Risk Level"].iloc[i].item() if hasattr(after_scores_df["Overall Risk Level"].iloc[i], 'item') else after_scores_df["Overall Risk Level"].iloc[i])
                }
                segments[idx_str]["after_scores"] = after_scores

        return jsonify({"ok": True, "segments": segments})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return fail(f"Error retrieving all treatments: {str(e)}", 500)


@bp.get("/<project_name>/treatments/segment/<int:segment_index>")
def get_segment_treatments(project_name: str, segment_index: int):
    """
    Get treatment state for a specific segment.

    Response:
        {
            "ok": true,
            "segment_index": 5,
            "has_treatments": true,
            "treatments_applied": [1, 9, 14],
            "modified_attributes": { "Facility Type": 4, ... },
            "after_scores": { "BB": 1.8, "BP": 0.9, "SB": 2.2, "VB": 3.5, "Overall Risk Level": 8.4 }
        }
    """
    try:
        ctx = get_ctx()
        proj: Project = ctx["pm"].project(project_name)
        ver = proj.latest()

        treatment_df = ver.treatment.df

        # Check if segment exists in treatment.csv
        if segment_index >= len(treatment_df):
            return jsonify({
                "ok": True,
                "segment_index": segment_index,
                "has_treatments": False,
                "treatments_applied": []
            })

        row = treatment_df.iloc[segment_index]

        # Check if "Treatments Applied" column exists and has data
        treatments_str = ""
        if "Treatments Applied" in treatment_df.columns:
            treatments_str = row.get("Treatments Applied", "")

        # If no treatments applied, return early
        if not treatments_str or pd.isna(treatments_str) or treatments_str.strip() == "":
            return jsonify({
                "ok": True,
                "segment_index": segment_index,
                "has_treatments": False,
                "treatments_applied": []
            })

        # Parse treatment IDs
        try:
            treatment_ids = [int(x.strip()) for x in treatments_str.split(",") if x.strip()]
        except ValueError:
            return jsonify({
                "ok": True,
                "segment_index": segment_index,
                "has_treatments": False,
                "treatments_applied": []
            })

        # Extract modified attributes from row
        modified_attributes = {}
        attrs_df = ver.attributes.df
        original_row = dict(attrs_df.iloc[segment_index])

        for col in attrs_df.columns:
            val_treatment = None
            if col in treatment_df.columns and col != "Treatments Applied":
                val_treatment = row.get(col)
                
            # If value in treatment_df is not null and not empty string, use it
            if pd.notna(val_treatment) and str(val_treatment).strip() != "":
                # Convert pandas types to Python native types for JSON serialization
                try:
                    if hasattr(val_treatment, 'item'):  # numpy/pandas scalar
                        val_treatment = val_treatment.item()
                    # Ensure we get a Python native type
                    if isinstance(val_treatment, (int, float, bool)):
                        modified_attributes[col] = val_treatment
                    else:
                        modified_attributes[col] = float(val_treatment)
                except (ValueError, TypeError):
                    modified_attributes[col] = original_row.get(col)
            else:
                # Fallback to the original baseline attributes if this column was untouched
                modified_attributes[col] = original_row.get(col)

        # Calculate after scores from modified attributes
        modified_df = pd.DataFrame([modified_attributes])
        after_scores_df = calculate_cyclerap_score_native(modified_df)

        # Extract scores safely with explicit type conversion
        after_scores = {
            "BB": float(after_scores_df["BB"].iloc[0].item() if hasattr(after_scores_df["BB"].iloc[0], 'item') else after_scores_df["BB"].iloc[0]),
            "BP": float(after_scores_df["BP"].iloc[0].item() if hasattr(after_scores_df["BP"].iloc[0], 'item') else after_scores_df["BP"].iloc[0]),
            "SB": float(after_scores_df["SB"].iloc[0].item() if hasattr(after_scores_df["SB"].iloc[0], 'item') else after_scores_df["SB"].iloc[0]),
            "VB": float(after_scores_df["VB"].iloc[0].item() if hasattr(after_scores_df["VB"].iloc[0], 'item') else after_scores_df["VB"].iloc[0]),
            "Overall Risk Level": float(after_scores_df["Overall Risk Level"].iloc[0].item() if hasattr(after_scores_df["Overall Risk Level"].iloc[0], 'item') else after_scores_df["Overall Risk Level"].iloc[0])
        }

        return jsonify({
            "ok": True,
            "segment_index": segment_index,
            "has_treatments": True,
            "treatments_applied": [int(x) if hasattr(x, 'item') else int(x) for x in treatment_ids],
            "modified_attributes": modified_attributes,
            "after_scores": after_scores
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return fail(f"Error retrieving treatment state: {str(e)}", 500)


@bp.post("/<project_name>/treatments/apply-all")
def apply_all_treatments(project_name: str):
    """
    Apply all applicable recommended treatments to all segments within a project.

    This endpoint analyzes each segment, identifies applicable treatments,
    and applies all recommended treatments to it.

    Response:
        {
            "ok": true,
            "total_segments": 50,
            "segments_treated": 48,
            "segments_skipped": 2,
            "details": [
                {
                    "segment_index": 0,
                    "treatment_ids": [1, 9, 14],
                    "before_scores": { "BB": 2.5, ... },
                    "after_scores": { "BB": 1.8, ... }
                },
                ...
            ]
        }
    """
    try:
        ctx = get_ctx()
        proj: Project = ctx["pm"].project(project_name)
        ver = proj.latest()

        # Load attributes and treatment dataframes
        attrs_df = ver.attributes.df
        treatment_df = ver.treatment.df.copy()

        # Ensure treatment dataframe has all attribute columns
        for col in attrs_df.columns:
            if col not in treatment_df.columns:
                # Initialize column with None for all rows
                treatment_df[col] = None  # Use None first for proper pandas handling

        # Ensure treatment dataframe has same number of rows as attributes dataframe
        if len(treatment_df) < len(attrs_df):
            # Expand treatment dataframe to match attributes size
            new_rows = [treatment_df.iloc[0].copy() if len(treatment_df) > 0 else {}] * (len(attrs_df) - len(treatment_df))
            treatment_df = pd.concat([treatment_df, pd.DataFrame(new_rows)], ignore_index=True)

        # Helper function to get applicable treatments for a segment
        def get_applicable_treatments(attr_row):
            # Recreate the trigger logic from frontend
            applicable = []
            for treatment in TREATMENTS:
                for trigger_set in treatment.get("triggers", []):
                    # Check if all conditions in this trigger set are met
                    all_match = True
                    for attr_name, required_values in trigger_set.items():
                        if attr_name not in attr_row:
                            all_match = False
                            break
                        if attr_row[attr_name] not in required_values:
                            all_match = False
                            break

                    if all_match:
                        applicable.append(treatment)
                        break  # Only need one trigger set to match
            return applicable

        # Process each segment
        details = []
        total_treated = 0

        for segment_index in range(len(attrs_df)):
            try:
                original_row = dict(attrs_df.iloc[segment_index])

                # Get applicable treatments for this segment
                applicable_treatments = get_applicable_treatments(original_row)

                if not applicable_treatments:
                    continue  # Skip if no applicable treatments

                # Collect all treatment IDs for this segment
                treatment_ids = [t["id"] for t in applicable_treatments]

                # Apply treatment effects
                modified_row = original_row.copy()
                for treatment in applicable_treatments:
                    for attr_name, new_value in treatment['effects'].items():
                        modified_row[attr_name] = new_value

                # Calculate before scores
                original_df = pd.DataFrame([original_row])
                before_scores_df = calculate_cyclerap_score_native(original_df)
                before_scores = {
                    "BB": float(before_scores_df["BB"].iloc[0]),
                    "BP": float(before_scores_df["BP"].iloc[0]),
                    "SB": float(before_scores_df["SB"].iloc[0]),
                    "VB": float(before_scores_df["VB"].iloc[0]),
                    "Overall Risk Level": float(before_scores_df["Overall Risk Level"].iloc[0])
                }

                # Calculate after scores
                modified_df = pd.DataFrame([modified_row])
                after_scores_df = calculate_cyclerap_score_native(modified_df)
                after_scores = {
                    "BB": float(after_scores_df["BB"].iloc[0]),
                    "BP": float(after_scores_df["BP"].iloc[0]),
                    "SB": float(after_scores_df["SB"].iloc[0]),
                    "VB": float(after_scores_df["VB"].iloc[0]),
                    "Overall Risk Level": float(after_scores_df["Overall Risk Level"].iloc[0])
                }

                # Update treatment dataframe
                if len(treatment_df) <= segment_index:
                    new_rows = [treatment_df.iloc[0].copy() if len(treatment_df) > 0 else {}] * (segment_index - len(treatment_df) + 1)
                    treatment_df = pd.concat([treatment_df, pd.DataFrame(new_rows)], ignore_index=True)

                # Update the row with modified attributes
                for col in modified_row.keys():
                    if col in treatment_df.columns:
                        treatment_df.at[segment_index, col] = modified_row[col]

                # Update "Treatments Applied" column
                if "Treatments Applied" not in treatment_df.columns:
                    treatment_df.insert(0, "Treatments Applied", "")

                treatment_df.at[segment_index, "Treatments Applied"] = ",".join(str(tid) for tid in treatment_ids)

                # Record details
                details.append({
                    "segment_index": segment_index,
                    "treatment_ids": treatment_ids,
                    "before_scores": before_scores,
                    "after_scores": after_scores
                })

                total_treated += 1

            except Exception:
                continue

        # Mark treatment dataframe as dirty but don't save yet
        # User must click "Save" button to persist changes
        # Directly assign to the existing treatment object's df property
        # This sets df_dirty=True via the property setter
        ver.treatment.df = treatment_df
        # NOTE: NOT calling proj.save_all() here - changes will be saved only when user clicks Save

        return jsonify({
            "ok": True,
            "total_segments": int(len(attrs_df)),
            "segments_treated": int(total_treated),
            "segments_skipped": int(len(attrs_df) - total_treated),
            "details": details
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return fail(f"Error applying all treatments: {str(e)}", 500)


@bp.post("/<project_name>/treatments/apply-specific")
def apply_specific_treatment(project_name: str):
    """
    Apply a specific treatment to all applicable segments within a project.

    This endpoint analyzes each segment, checks if the given treatment_id is applicable,
    and applies it if so.

    Response:
        {
            "ok": true,
            "total_segments": 50,
            "segments_treated": 48,
            "segments_skipped": 2,
            "details": [ ... ]
        }
    """
    try:
        ctx = get_ctx()
        proj: Project = ctx["pm"].project(project_name)
        ver = proj.latest()
        
        data = request.get_json(silent=True) or {}
        target_treatment_id = data.get("treatment_id")
        if not target_treatment_id:
            return fail("Missing treatment_id", 400)
            
        target_treatment = next((t for t in TREATMENTS if t["id"] == target_treatment_id), None)
        if not target_treatment:
            return fail(f"Invalid treatment_id: {target_treatment_id}", 400)

        attrs_df = ver.attributes.df
        treatment_df = ver.treatment.df.copy()

        if len(treatment_df) < len(attrs_df):
            new_rows = [{}] * (len(attrs_df) - len(treatment_df))
            treatment_df = pd.concat([treatment_df, pd.DataFrame(new_rows)], ignore_index=True)

        def is_treatment_applicable(attr_row, treatment):
            for trigger_set in treatment.get("triggers", []):
                all_match = True
                for attr_name, required_values in trigger_set.items():
                    if attr_name not in attr_row:
                        all_match = False
                        break
                    if attr_row[attr_name] not in required_values:
                        all_match = False
                        break
                if all_match:
                    return True
            return False

        for col in attrs_df.columns:
            if col not in treatment_df.columns:
                treatment_df[col] = None

        details = []
        total_treated = 0

        if "Treatments Applied" not in treatment_df.columns:
            treatment_df.insert(0, "Treatments Applied", "")

        for segment_index in range(len(attrs_df)):
            try:
                original_row = dict(attrs_df.iloc[segment_index])
                
                if not is_treatment_applicable(original_row, target_treatment):
                    continue
                
                existing_treatments_str = treatment_df.at[segment_index, "Treatments Applied"]
                existing_treatment_ids = []
                if pd.notna(existing_treatments_str) and str(existing_treatments_str).strip():
                    try:
                        existing_treatment_ids = [int(x.strip()) for x in str(existing_treatments_str).split(",") if x.strip()]
                    except ValueError:
                        pass
                
                if target_treatment_id in existing_treatment_ids:
                    continue # Already applied
                
                treatment_ids = existing_treatment_ids + [target_treatment_id]
                
                modified_row = original_row.copy()
                for tid in treatment_ids:
                    t_obj = next((t for t in TREATMENTS if t["id"] == tid), None)
                    if t_obj:
                        for attr_name, new_value in t_obj['effects'].items():
                            modified_row[attr_name] = new_value

                original_df = pd.DataFrame([original_row])
                before_scores_df = calculate_cyclerap_score_native(original_df)
                before_scores = {
                    "BB": float(before_scores_df["BB"].iloc[0]),
                    "BP": float(before_scores_df["BP"].iloc[0]),
                    "SB": float(before_scores_df["SB"].iloc[0]),
                    "VB": float(before_scores_df["VB"].iloc[0]),
                    "Overall Risk Level": float(before_scores_df["Overall Risk Level"].iloc[0])
                }

                modified_df = pd.DataFrame([modified_row])
                after_scores_df = calculate_cyclerap_score_native(modified_df)
                after_scores = {
                    "BB": float(after_scores_df["BB"].iloc[0]),
                    "BP": float(after_scores_df["BP"].iloc[0]),
                    "SB": float(after_scores_df["SB"].iloc[0]),
                    "VB": float(after_scores_df["VB"].iloc[0]),
                    "Overall Risk Level": float(after_scores_df["Overall Risk Level"].iloc[0])
                }

                for col in modified_row.keys():
                    if col in treatment_df.columns:
                        treatment_df.at[segment_index, col] = modified_row[col]

                treatment_df.at[segment_index, "Treatments Applied"] = ",".join(str(tid) for tid in treatment_ids)

                details.append({
                    "segment_index": segment_index,
                    "treatment_ids": treatment_ids,
                    "before_scores": before_scores,
                    "after_scores": after_scores
                })

                total_treated += 1

            except Exception:
                continue

        ver.treatment.df = treatment_df

        return jsonify({
            "ok": True,
            "total_segments": int(len(attrs_df)),
            "segments_treated": int(total_treated),
            "segments_skipped": int(len(attrs_df) - total_treated),
            "details": details
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return fail(f"Error applying specific treatment: {str(e)}", 500)


@bp.post("/<project_name>/treatments/reset-all")
def reset_all_treatments(project_name: str):
    """
    Clear all applied treatments for all segments in a project.

    Response:
        {
            "ok": true,
            "total_segments": 50,
            "segments_reset": 48,
            "message": "All treatments have been reset"
        }
    """
    try:
        ctx = get_ctx()
        proj: Project = ctx["pm"].project(project_name)
        ver = proj.latest()

        # Load treatment dataframe
        treatment_df = ver.treatment.df.copy()

        # Ensure treatment dataframe has same number of rows as attributes dataframe
        attrs_df = ver.attributes.df
        if len(treatment_df) < len(attrs_df):
            # Expand treatment dataframe to match attributes size
            new_rows = [{}] * (len(attrs_df) - len(treatment_df))
            treatment_df = pd.concat([treatment_df, pd.DataFrame(new_rows)], ignore_index=True)

        # Count how many segments had treatments
        if "Treatments Applied" in treatment_df.columns:
            # fillna("") ensures NaNs become empty strings. astype(str) ensures everything is string.
            # str.strip() removes distinct whitespace.
            # Then we check if length > 0.
            # This handles: NaN, None, "", "   ".
            # It counts ANY row that has non-empty treatment string.
            applied_col = treatment_df["Treatments Applied"].fillna("").astype(str).str.strip()
            segments_reset = int((applied_col != "").sum())
        else:
            segments_reset = 0

        # Clear "Treatments Applied" column for all rows
        if "Treatments Applied" in treatment_df.columns:
            treatment_df["Treatments Applied"] = ""

        # Reset all attribute columns to original values from attributes.csv
        attrs_df = ver.attributes.df
        for col in treatment_df.columns:
            if col != "Treatments Applied" and col in attrs_df.columns:
                # Copy original attribute values from attributes.csv
                if col in attrs_df.columns:
                    treatment_df[col] = attrs_df[col].values

        # Mark treatment dataframe as dirty but don't save yet
        # User must click "Save" button to persist changes
        # Directly assign to the existing treatment object's df property
        # This sets df_dirty=True via the property setter
        ver.treatment.df = treatment_df
        # NOTE: NOT calling proj.save_all() here - changes will be saved only when user clicks Save

        return jsonify({
            "ok": True,
            "total_segments": int(len(treatment_df)),
            "segments_reset": segments_reset,
            "message": "All treatments have been reset"
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return fail(f"Error resetting treatments: {str(e)}", 500)


@bp.post("/<project_name>/treatments/save")
def save_treatments(project_name: str):
    """
    Save all pending treatment changes to treatment.csv

    Response:
        {
            "ok": true,
            "message": "Treatments saved successfully"
        }
    """
    try:
        ctx = get_ctx()
        proj: Project = ctx["pm"].project(project_name)
        ver = proj.latest()

        # Save all pending changes
        proj.save_all()

        # Update last_updated
        proj.metadata.last_updated = datetime.datetime.now()
        proj.metadata.serialize(proj.project_path)

        return jsonify({
            "ok": True,
            "message": "Treatments saved successfully"
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return fail(f"Error saving treatments: {str(e)}", 500)


@bp.put("/<string:name>/attributes")
def update_attributes(name: str):
    ctx = get_ctx()
    pm = ctx["pm"]
    proj = pm.project(name)
    if not proj:
        return fail("Project not found", 404)

    data = request.get_json(silent=True) or {}
    rows = data.get("rows")
    if not isinstance(rows, list):
        return fail("Invalid payload", 400)

    # Convert incoming rows to DataFrame
    new_attrs_df = pd.DataFrame(rows)

    # Get latest version for updating
    ver = proj.latest()

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

#-----------------------------------------------------------------------------------

def dms_to_decimal(dms, ref):
    deg = dms[0].num / dms[0].den
    minute = dms[1].num / dms[1].den
    sec = dms[2].num / dms[2].den
    dec = deg + minute/60 + sec/3600
    return -dec if ref in ['S','W'] else dec

def get_image_folder_geo(folder_path):
    records = []
    for fname in sorted(os.listdir(folder_path)):
        if not fname.lower().endswith(('.jpg', '.jpeg')):
            continue
        img_path = os.path.join(folder_path, fname)
        with open(img_path, 'rb') as f:
            tags = exifread.process_file(f, details=False)

        # Required GPS tags
        if {'GPS GPSLatitude', 'GPS GPSLongitude',
            'GPS GPSLatitudeRef', 'GPS GPSLongitudeRef'}.issubset(tags):
            
            lat = dms_to_decimal(tags['GPS GPSLatitude'].values,
                                tags['GPS GPSLatitudeRef'].printable)
            lon = dms_to_decimal(tags['GPS GPSLongitude'].values,
                                tags['GPS GPSLongitudeRef'].printable)
            
            records.append({
                'latitude':  lat,
                'longitude': lon,
                'filename':  fname
            })

    df = pd.DataFrame(records)
    df['geometry'] = [Point(xy) for xy in zip(df.longitude, df.latitude)]
    return gpd.GeoDataFrame(df, geometry='geometry', crs="EPSG:4326")


def _build_project_geo_data_from_points(
    geo_points: gpd.GeoDataFrame,
    source_name: str,
    selection_polygon: Polygon | None = None,
):
    df = geo_points.copy()
    if df.empty:
        raise ValueError(f"No geotagged images found in folder '{source_name}'")

    if selection_polygon is not None:
        df = df[df.geometry.apply(selection_polygon.covers)].reset_index(drop=True)
        if df.empty:
            return gpd.GeoDataFrame(columns=["LATITUDE", "LONGITUDE", "FILENAME", "geometry"], geometry="geometry", crs="EPSG:4326")

    df = df.rename(columns={"latitude": "LATITUDE", "longitude": "LONGITUDE", "filename": "FILENAME"})
    df = cycleRAP_VA.geoCode(df)
    df = cycleRAP_VA.get_geo_points_by_distance(df, min_distance=10)
    if "geometry" not in df.columns:
        raise ValueError(f"Missing 'geometry' after geocoding for folder '{source_name}'")

    gdf = gpd.GeoDataFrame(df, geometry="geometry", crs="EPSG:4326")
    return cycleRAP_VA.convert_points_to_linestrings(gdf)

def apply_image_namespaces(filename_df, filename_prefix=None):
    """Apply source-folder namespace prefix to FILENAME for multi-folder projects.
    Does not copy any files — images remain in in/ and are resolved at serve time.
    """
    if filename_prefix is None:
        return filename_df
    result_df = filename_df.copy()
    result_df["FILENAME"] = result_df["FILENAME"].apply(
        lambda f: f"{filename_prefix}__{f}"
    )
    return result_df

def build_project_geo_data(src_dir: Path, selection_polygon: Polygon | None = None):
    geo_points = get_image_folder_geo(str(src_dir))
    return _build_project_geo_data_from_points(geo_points, src_dir.name, selection_polygon)

def make_image_namespace(source_name: str) -> str:
    namespace = "".join(ch if ch.isalnum() else "_" for ch in source_name).strip("_")
    return namespace or "source"


def _resolve_image_from_in(pm, project_name: str, filename: str) -> "Path | None":
    """Resolve an image filename to its physical path under in/.

    For single-folder projects the filename is the bare original name.
    For multi-folder projects the filename is '{namespace}__{original}'.
    Namespace is produced by make_image_namespace(source_folder_name).
    Returns None when the image cannot be located.
    """
    try:
        proj = pm.project(project_name)
        source_folders = getattr(proj.metadata, "source_folders", None) or []
        if not source_folders:
            return None

        if len(source_folders) == 1:
            candidate = pm.in_path / source_folders[0] / filename
            if candidate.is_file():
                return candidate
        else:
            if "__" in filename:
                namespace, original = filename.split("__", 1)
                ns_map = {make_image_namespace(sf): sf for sf in source_folders}
                if namespace in ns_map:
                    candidate = pm.in_path / ns_map[namespace] / original
                    if candidate.is_file():
                        return candidate
            # Fallback: try all source folders with the bare filename
            for sf in source_folders:
                candidate = pm.in_path / sf / filename
                if candidate.is_file():
                    return candidate
    except Exception:
        pass
    return None


def _is_loopback_request() -> bool:
    remote_addr = (request.remote_addr or "").strip()
    if not remote_addr:
        return False

    try:
        return ipaddress.ip_address(remote_addr).is_loopback
    except ValueError:
        return False


def _clean_source_folder_name(raw_name) -> str | None:
    if not isinstance(raw_name, str):
        return None

    clean_name = raw_name.strip()
    if not clean_name or clean_name in {".", ".."}:
        return None
    if any(sep in clean_name for sep in ("/", "\\")):
        return None

    return clean_name


def _path_is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def _get_known_road_names() -> list[str]:
    global _KNOWN_ROAD_NAMES
    if _KNOWN_ROAD_NAMES is not None:
        return _KNOWN_ROAD_NAMES

    known_names: set[str] = set()
    backend_root = Path(__file__).resolve().parents[3]

    ref_csv_candidates = [
        backend_root / "shapefiles" / "road_reference.csv",
        backend_root / "app" / "shapefiles" / "road_reference.csv",
    ]
    ref_csv = next((candidate for candidate in ref_csv_candidates if candidate.exists()), None)

    if ref_csv is not None:
        import csv

        try:
            with open(ref_csv, newline="", encoding="utf-8-sig") as handle:
                reader = csv.DictReader(handle)
                for row in reader:
                    name = str(row.get("road_name", "")).strip()
                    if name:
                        known_names.add(name)
        except Exception as exc:
            current_app.logger.warning("Failed to read road_reference.csv for folder suggestions: %s", exc)

    try:
        road_gdf = _get_road_sections_gdf()
        road_name_col = next(
            (c for c in ("RD_NAM", "RD_NAME", "ROAD_NAME", "NAME", "RD_CD_DESC") if c in road_gdf.columns),
            None,
        )
        if road_name_col is not None:
            for raw_name in road_gdf[road_name_col].dropna().astype(str):
                name = raw_name.strip()
                if name and any(ch.isalnum() for ch in name):
                    known_names.add(name)
    except Exception as exc:
        current_app.logger.warning("Failed to read road shapefile for folder suggestions: %s", exc)

    _KNOWN_ROAD_NAMES = sorted(known_names)
    return _KNOWN_ROAD_NAMES


def _build_flat_copy_name(source_file: Path, source_root: Path, destination_dir: Path) -> str:
    relative_parts = source_file.relative_to(source_root).parts
    base_name = relative_parts[-1]
    if not (destination_dir / base_name).exists():
        return base_name

    prefix_parts = [part.strip().replace("/", "_").replace("\\", "_") for part in relative_parts[:-1] if part.strip()]
    if prefix_parts:
        candidate = "__".join(prefix_parts + [base_name])
        if not (destination_dir / candidate).exists():
            return candidate

    stem = Path(base_name).stem
    suffix = Path(base_name).suffix
    safe_stem = "__".join(prefix_parts + [stem]) if prefix_parts else stem
    counter = 2
    while True:
        candidate = f"{safe_stem}__{counter}{suffix}"
        if not (destination_dir / candidate).exists():
            return candidate
        counter += 1


def _iter_source_image_files(source_dir: Path) -> list[Path]:
    if not source_dir.exists() or not source_dir.is_dir():
        return []

    return [
        file_path
        for file_path in sorted(source_dir.rglob("*"))
        if file_path.is_file() and file_path.suffix.lower() in _IMAGE_EXTENSIONS
    ]


def _read_modified_datetime(image_path: Path) -> datetime.datetime | None:
    try:
        return datetime.datetime.fromtimestamp(image_path.stat().st_mtime)
    except OSError:
        return None


def _format_quarter_label(captured_at: datetime.datetime | None) -> str | None:
    if captured_at is None:
        return None

    quarter = ((captured_at.month - 1) // 3) + 1
    return f"{quarter}Q{captured_at.year}"


def _quarter_sort_key(label: str) -> tuple[int, int, str]:
    match = re.fullmatch(r"([1-4])Q(\d{4})", label)
    if match:
        return (int(match.group(2)), int(match.group(1)), label)

    legacy_match = re.fullmatch(r"Q([1-4])(\d{4})", label)
    if legacy_match:
        return (int(legacy_match.group(2)), int(legacy_match.group(1)), label)

    return (9999, 9999, label)


def _get_source_folder_metadata_path(source_dir: Path) -> Path:
    return source_dir / _SOURCE_FOLDER_METADATA_FILENAME


def _build_source_folder_cache_key(source_dir: Path, image_files: list[Path]) -> str:
    digest = hashlib.sha1()
    for image_file in image_files:
        try:
            stat = image_file.stat()
        except OSError:
            continue

        digest.update(image_file.relative_to(source_dir).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(stat.st_size).encode("ascii"))
        digest.update(b"\0")
        digest.update(str(stat.st_mtime_ns).encode("ascii"))
        digest.update(b"\0")

    return digest.hexdigest()


def _load_source_folder_metadata(source_dir: Path) -> dict | None:
    metadata_path = _get_source_folder_metadata_path(source_dir)
    if not metadata_path.exists() or not metadata_path.is_file():
        return None

    try:
        data = json.loads(metadata_path.read_text(encoding="utf-8"))
    except Exception:
        return None

    if not isinstance(data, dict):
        return None
    if data.get("version") != _SOURCE_FOLDER_METADATA_VERSION:
        return None
    if not isinstance(data.get("summary"), dict):
        return None

    return data


def _write_source_folder_metadata(source_dir: Path, cache_key: str, summary: dict) -> None:
    metadata_path = _get_source_folder_metadata_path(source_dir)
    temp_path = metadata_path.with_name(f"{metadata_path.name}.tmp")
    payload = {
        "version": _SOURCE_FOLDER_METADATA_VERSION,
        "generated_at": datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "cache_key": cache_key,
        "summary": summary,
    }
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(metadata_path)


def _build_source_folder_summary(source_dir: Path, image_files: list[Path]) -> dict:
    modified_dates = [
        modified_at
        for modified_at in (_read_modified_datetime(image_file) for image_file in image_files)
        if modified_at is not None
    ]

    geotagged_image_count = 0
    segment_count = 0
    segment_error = None

    try:
        geo_points = get_image_folder_geo(str(source_dir))
        geotagged_image_count = len(geo_points)
        if geotagged_image_count > 0:
            segment_count = len(_build_project_geo_data_from_points(geo_points, source_dir.name))
    except Exception as exc:
        segment_error = str(exc)

    quarter_labels = sorted({
        quarter_label
        for quarter_label in (_format_quarter_label(modified_at) for modified_at in modified_dates)
        if quarter_label is not None
    }, key=_quarter_sort_key)
    survey_quarter = quarter_labels[0] if len(quarter_labels) == 1 else None

    return {
        "folder_name": source_dir.name,
        "image_count": len(image_files),
        "geotagged_image_count": geotagged_image_count,
        "segment_count": segment_count,
        "segment_error": segment_error,
        "earliest_modified_at": min(modified_dates).isoformat() if modified_dates else None,
        "latest_modified_at": max(modified_dates).isoformat() if modified_dates else None,
        "survey_quarter": survey_quarter,
        "survey_quarters": quarter_labels,
    }


def _folder_name_has_quarter_suffix(folder_name: str) -> bool:
    return bool(_QUARTER_SUFFIX_RE.search(folder_name.strip()))


def _get_unique_source_folder_target(in_root: Path, desired_name: str, current_dir: Path | None = None) -> Path:
    candidate_name = desired_name
    counter = 2

    while True:
        candidate_dir = in_root / candidate_name
        if current_dir is not None and candidate_dir == current_dir:
            return candidate_dir
        if not candidate_dir.exists():
            return candidate_dir

        candidate_name = f"{desired_name}__{counter}"
        counter += 1


def _maybe_auto_rename_source_folder(source_dir: Path, in_root: Path, summary: dict) -> tuple[Path, str | None]:
    survey_quarter = str(summary.get("survey_quarter") or "").strip()
    if not survey_quarter:
        return source_dir, None
    if _folder_name_has_quarter_suffix(source_dir.name):
        return source_dir, None

    target_dir = _get_unique_source_folder_target(in_root, f"{source_dir.name}_{survey_quarter}", source_dir)
    if target_dir == source_dir:
        return source_dir, None

    previous_name = source_dir.name
    source_dir.rename(target_dir)
    summary["folder_name"] = target_dir.name
    return target_dir, previous_name


def _resolve_source_folder_preview(source_dir: Path, in_root: Path) -> dict:
    image_files = _iter_source_image_files(source_dir)
    cache_key = _build_source_folder_cache_key(source_dir, image_files)
    metadata = _load_source_folder_metadata(source_dir)

    cached = False
    summary = None
    if metadata is not None and metadata.get("cache_key") == cache_key:
        cached_summary = metadata.get("summary")
        if isinstance(cached_summary, dict):
            summary = dict(cached_summary)
            cached = True

    if summary is None:
        summary = _build_source_folder_summary(source_dir, image_files)

    summary["folder_name"] = source_dir.name
    renamed_from = None
    try:
        source_dir, renamed_from = _maybe_auto_rename_source_folder(source_dir, in_root, summary)
    except Exception as exc:
        current_app.logger.warning("Failed to auto-rename source folder %s: %s", source_dir, exc)

    summary["folder_name"] = source_dir.name

    if not cached or renamed_from is not None:
        try:
            _write_source_folder_metadata(source_dir, cache_key, summary)
        except Exception as exc:
            current_app.logger.warning("Failed to write source folder metadata for %s: %s", source_dir, exc)

    result = dict(summary)
    result["cached"] = cached and renamed_from is None
    result["mixed_quarters"] = len(result.get("survey_quarters") or []) > 1
    result["renamed_from"] = renamed_from
    return result

@bp.get("/folders")
def list_input_folders():
    """
    List available subfolders under the input root (folders only)
    GET /api/projects/folders
    Response: { items: [ "FolderA", "FolderB", ... ] }
    """
    try:
        ctx = get_ctx()
    except Exception as exc:
        return jsonify({"error": f"Backend initialisation failed: {exc}"}), 500
    pm = ctx["pm"]
    in_path: Path = pm.in_path

    if not in_path.exists():
        return ok({"items": []})

    items = [f for f in os.listdir(in_path) if (in_path / f).is_dir()]
    items.sort()
    return ok({"items": items})


@bp.get("/folders/preview")
def preview_input_folder():
    """
    Return a folder summary derived from image file modified timestamps.
    """
    ctx = get_ctx()
    pm = ctx["pm"]

    folder_name = _clean_source_folder_name(request.args.get("folder_name"))
    if not folder_name:
        return fail("folder_name is required", 400)

    in_root = pm.in_path.resolve()
    source_dir = (in_root / folder_name).resolve()
    if not _path_is_within(source_dir, in_root):
        return fail("Invalid folder_name", 400)
    if not source_dir.exists() or not source_dir.is_dir():
        return fail("Source folder not found", 404)

    return ok(_resolve_source_folder_preview(source_dir, in_root))


@bp.get("/folders/image")
def get_input_folder_image():
    """
    Return an image file under a source folder in /in for preview purposes.
    """
    ctx = get_ctx()
    pm = ctx["pm"]

    folder_name = _clean_source_folder_name(request.args.get("folder_name"))
    relative_path = str(request.args.get("relative_path") or "").strip()
    if not folder_name or not relative_path:
        abort(400, description="folder_name and relative_path are required")

    in_root = pm.in_path.resolve()
    source_dir = (in_root / folder_name).resolve()
    if not _path_is_within(source_dir, in_root):
        abort(400, description="Invalid image path")
    if not source_dir.exists() or not source_dir.is_dir():
        abort(404, description="Source folder not found")

    safe_path = safe_join(str(source_dir), relative_path)
    if safe_path is None:
        abort(400, description="Invalid image path")

    file_path = Path(safe_path).resolve()
    if not _path_is_within(file_path, source_dir):
        abort(400, description="Invalid image path")
    if not file_path.exists() or not file_path.is_file():
        abort(404, description="Image not found")

    resp = send_from_directory(str(source_dir), file_path.relative_to(source_dir).as_posix(), conditional=True)
    resp.headers["Cache-Control"] = "public, max-age=3600"
    return resp


@bp.get("/folders/suggestions")
def list_input_folder_suggestions():
    """
    Return searchable destination folder suggestions for source imports.
    Includes both existing input folders and known road names from reference data.
    """
    ctx = get_ctx()
    pm = ctx["pm"]
    in_path: Path = pm.in_path

    existing_folders = set()
    if in_path.exists():
        existing_folders = {
            item.name
            for item in in_path.iterdir()
            if item.is_dir()
        }
    suggestion_names = existing_folders | set(_get_known_road_names())

    items = [
        {"name": name, "exists": name in existing_folders}
        for name in suggestion_names
    ]
    items.sort(key=lambda item: (not item["exists"], item["name"].lower()))
    return ok({"items": items})


@bp.post("/folders/pick-local")
def pick_local_source_folder():
    """
    Open a native folder picker on the same machine as the backend.
    Local-only by design so deployed instances do not expose filesystem browsing.
    """
    if not _is_loopback_request():
        return fail("Local folder browsing is only available from the same machine as the server", 403)

    root = None
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected_path = filedialog.askdirectory(title="Select image folder to import")
    except Exception as exc:
        current_app.logger.exception("Failed to open local folder picker")
        return fail(f"Local folder picker is unavailable in this environment: {exc}", 500)
    finally:
        if root is not None:
            try:
                root.destroy()
            except Exception:
                pass

    if not selected_path:
        return ok({"path": None, "suggested_folder_name": None})

    return ok({
        "path": selected_path,
        "suggested_folder_name": Path(selected_path).name,
    })


@bp.post("/folders/copy-local")
def copy_images_to_source_folder():
    """
    Copy image files from a local folder on the backend machine into a source folder under /in.
    Local-only by design so deployed instances do not expose arbitrary filesystem reads.
    """
    if not _is_loopback_request():
        return fail("Local folder copy is only available from the same machine as the server", 403)

    ctx = get_ctx()
    pm = ctx["pm"]
    data = request.get_json(silent=True) or {}

    folder_name = _clean_source_folder_name(data.get("folder_name"))
    if not folder_name:
        return fail("Destination folder name is required", 400)

    source_path = str(data.get("source_path") or "").strip()
    if not source_path:
        return fail("Source folder path is required", 400)

    try:
        source_dir = Path(source_path).expanduser().resolve()
    except Exception:
        return fail("Source folder path is invalid", 400)

    if not source_dir.exists() or not source_dir.is_dir():
        return fail("Source folder does not exist or is not a directory", 400)

    in_root = pm.in_path.resolve()
    destination_dir = (in_root / folder_name).resolve()
    if not _path_is_within(destination_dir, in_root):
        return fail("Invalid destination folder name", 400)

    if source_dir == destination_dir or _path_is_within(source_dir, destination_dir) or _path_is_within(destination_dir, source_dir):
        return fail("Source and destination folders must not overlap", 400)

    image_files = _iter_source_image_files(source_dir)

    if not image_files:
        return fail("No image files were found in the selected folder", 400)

    destination_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    errors: list[str] = []

    for image_file in image_files:
        try:
            destination_name = _build_flat_copy_name(image_file, source_dir, destination_dir)
            shutil.copy2(image_file, destination_dir / destination_name)
            count += 1
        except Exception as exc:
            rel_path = image_file.relative_to(source_dir)
            errors.append(f"Failed to copy {rel_path}: {exc}")

    preview = _resolve_source_folder_preview(destination_dir, in_root)

    return ok({
        "count": count,
        "errors": errors,
        "folder_name": preview["folder_name"],
        "renamed_from": preview["renamed_from"],
        "preview": preview,
        "message": f"Copied {count} image(s) into folder '{preview['folder_name']}'",
    })


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
    in_path: Path = pm.in_path
    backend_root = Path(__file__).resolve().parents[3]

    # Merged result: roads from shapefile with exists flag from CSV + folder check
    all_road_names: dict[str, dict] = {}  # { "ROAD NAME": { "points": count, "exists": bool } }

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
                                all_road_names[name] = {"points": 0, "exists": False}
                            all_road_names[name]["points"] += 1
                    except (KeyError, ValueError):
                        continue
        except Exception as e:
            print(f"[roads-in-polygon] CSV lookup failed: {e}", flush=True)

    for name in csv_roads:
        all_road_names[name]["exists"] = in_path.exists() and (in_path / name).is_dir()

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
            print(
                f"[roads-in-polygon] shapefile hit {len(intersecting_roads)} features"
                f" | poly bounds {poly.bounds}",
                flush=True,
            )
            road_counts: dict[str, int] = {}
            for raw_name in intersecting_roads[road_name_col].dropna().astype(str):
                name = raw_name.strip()
                if not name or not any(ch.isalnum() for ch in name):
                    continue
                road_counts[name] = road_counts.get(name, 0) + 1

            for name, count in road_counts.items():
                if name not in all_road_names:
                    all_road_names[name] = {
                        "points": count,
                        "exists": in_path.exists() and (in_path / name).is_dir(),
                    }
                else:
                    all_road_names[name]["points"] += count
    except Exception as e:
        print(f"[roads-in-polygon] shapefile lookup failed: {type(e).__name__}: {e}", flush=True)

    # If we have any road data (CSV or shapefile), return it
    if all_road_names:
        roads = []
        for name in sorted(all_road_names):
            roads.append({
                "name": name,
                "points": all_road_names[name]["points"],
                "exists": all_road_names[name]["exists"],
            })
        print(f"[DEBUG] Returning {len(roads)} merged roads (fallback=False)")
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

            exists = in_path.exists() and (in_path / road_name).is_dir()

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
    polygon_coords = data.get("polygon")
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

    selection_polygon = None
    if polygon_coords is not None:
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
    pm.create_project(
        project_name,
        combined_geo_data,
        dataset_name,
        tags=tags,
        source_folders=normalized_folder_names,
    )

    return ok({
        "ok": True,
        "name": project_name,
        "source_count": len(normalized_folder_names),
        "skipped_sources": skipped_sources,
    })

@bp.post("/folders/upload-images")
def upload_images_to_source_folder():
    """
    Upload images to a source folder in the /in directory.
    POST /api/projects/folders/upload-images
    """
    ctx = get_ctx()
    pm = ctx["pm"]

    try:
        # Get folder name from request
        folder_name = request.form.get('folder_name')
        if not folder_name or not folder_name.strip():
            return fail("Folder name is required", 400)

        folder_name = folder_name.strip()

        # Get the source folder path (in directory)
        source_dir: Path = pm.in_path / folder_name
        source_dir.mkdir(parents=True, exist_ok=True)

        # Get uploaded files
        if 'images' not in request.files:
            return fail("No image files provided", 400)

        uploaded_files = request.files.getlist('images')
        if not uploaded_files:
            return fail("No image files provided", 400)

        count = 0
        errors = []

        # Allowed image extensions
        allowed_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'}

        for file in uploaded_files:
            if file.filename == '':
                errors.append("Empty filename")
                continue

            # Validate file extension
            file_ext = Path(file.filename).suffix.lower()
            if file_ext not in allowed_extensions:
                errors.append(f"Invalid file type: {file.filename}")
                continue

            try:
                # To prevent directory traversal attacks, resolve relative paths securely
                # file.filename could be "folder/img.jpg" or just "img.jpg"
                clean_path = Path(file.filename)
                
                # Check for malicious paths (e.g. ones with '..')
                if '..' in clean_path.parts or clean_path.is_absolute():
                    errors.append(f"Invalid file path: {file.filename}")
                    continue

                # Save file to source folder, preserving any subdirectories
                file_path = source_dir / clean_path
                file_path.parent.mkdir(parents=True, exist_ok=True)
                file.save(str(file_path))
                count += 1
            except Exception as e:
                errors.append(f"Failed to save {file.filename}: {str(e)}")

        return ok({
            "count": count,
            "errors": errors,
            "message": f"Uploaded {count} image(s) to folder '{folder_name}'"
        })

    except Exception as e:
        traceback.print_exc()
        return fail(f"Error uploading images: {e}", 500)

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
        new_verified = payload.get("verified")
        new_verified_segment_count = payload.get("verified_segment_count")
        new_autocoded_segment_count = payload.get("autocoded_segment_count")

        # While YOLO inference is running, skip all disk I/O to avoid holding
        # the GIL and slowing down inference (10-20x overhead observed).
        # Name renames are never batched by the frontend during autocode, so
        # it is safe to defer counter/tag updates until inference finishes.
        if _INFERENCE_DEPTH > 0 and new_name is None:
            return ok({"ok": True, "deferred": True})

        # Get the project
        try:
            proj = pm.project(project_name)
        except KeyError:
            return fail("Project not found", 404)

        # Check if any metadata needs updating
        metadata_updated = False

        # Update tags if provided
        if new_tags is not None:
            if not isinstance(new_tags, list):
                return fail("Tags must be an array", 400)
            proj.metadata.tags = new_tags
            metadata_updated = True

        # Update path_key override if provided. Empty string clears the override.
        if new_path_key is not None:
            if not isinstance(new_path_key, str):
                return fail("path_key must be a string", 400)
            proj.metadata.path_key = new_path_key.strip() or None
            metadata_updated = True

        # Update verified status if provided
        if new_verified is not None:
            proj.metadata.verified = bool(new_verified)
            metadata_updated = True

        # Update verified segment count if provided
        if new_verified_segment_count is not None:
            proj.metadata.verified_segment_count = int(new_verified_segment_count)
            metadata_updated = True

        # Update autocoded segment count if provided
        if new_autocoded_segment_count is not None:
            proj.metadata.autocoded_segment_count = int(new_autocoded_segment_count)
            metadata_updated = True

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

@bp.post("/<project_name>/autocode/image")
def autocode_image(project_name: str):
    print(f"[Autocode] >>> autocode_image called for project='{project_name}'", flush=True)
    try:
        _ensure_models_ready()

        ctx = get_ctx()
        pm = ctx["pm"]
        payload = request.get_json(force=True, silent=True) or {}
        image_ref = payload.get("imageRef")
        if not image_ref:
            return fail("imageRef is required", 400)

        legacy_path = (pm.des_path / project_name / global_var.PROJECT_IMAGES_FOLDER / image_ref).resolve()
        if legacy_path.is_file():
            img_path = legacy_path
        else:
            img_path = _resolve_image_from_in(pm, project_name, image_ref)
        if img_path is None or not img_path.exists():
            return fail(f"image not found: {image_ref}", 404)

        skip_obstacles = bool(payload.get("skipObstacles", False))
        print(f"[Autocode] CV inference: {image_ref} (skip_obstacles={skip_obstacles})", flush=True)
        global _INFERENCE_DEPTH
        _INFERENCE_DEPTH += 1
        try:
            updates = cv_pred.CycleRAP_Coding_Helper.autocode(img_path, skip_obstacles=skip_obstacles) or {}
        finally:
            _INFERENCE_DEPTH -= 1
        updates = {k: v for k, v in updates.items() if v is not None}
        print(f"[Autocode] CV done: {image_ref} → {len(updates)} field(s) set", flush=True)

        # Inject Grade from pre-computed LAZ gradient lookup (no-op if not available)
        gradient_pct = _inject_grade(image_ref, updates, project_name=project_name)

        # Return both updates and changed_fields for change tracking/highlighting in UI
        # changed_fields: list of field names that were updated by CV model
        resp: dict = {"updates": updates, "changed_fields": list(updates.keys())}
        if gradient_pct is not None:
            resp["gradient_pct"] = round(gradient_pct, 3)
        return ok(resp)

    except ServiceUnavailable as e:
        return fail(str(e), 503)
    except Exception as e:
        traceback.print_exc()
        return fail(f"autocode_image error: {e}", 500)


def _get_segment_midpoint(coords):
    from shapely.geometry import LineString, Point

    if not coords:
        raise ValueError("coords (LineString) is required")

    if len(coords) == 1:
        lon, lat = coords[0]
        return Point(lon, lat)

    try:
        line = LineString(coords)
        if line.is_empty or line.length == 0:
            lon, lat = coords[0]
            return Point(lon, lat)
        return line.interpolate(0.5, normalized=True)
    except Exception:
        lon, lat = coords[0]
        return Point(lon, lat)


@bp.post("/<project_name>/autocode/gis")
def autocode_gis(project_name: str):
    try:
        payload = request.get_json(force=True, silent=True) or {}
        coords = payload.get("coords")  # [[lon, lat], ...]

        if not coords or not isinstance(coords, list) or not isinstance(coords[0], list):
            return fail("coords (LineString) is required", 400)

        # Most GIS attributes remain anchored to the segment start point.
        start_lon, start_lat = coords[0]
        from shapely.geometry import Point
        pt = Point(start_lon, start_lat)
        curvature_pt = _get_segment_midpoint(coords)

        # Optional field filter: when provided (bulk per-attribute mode), skip GIS queries
        # whose output field is not in the set. None means run everything (full autocode,
        # single-segment manual button from the frontend).
        fields_filter = payload.get("fields")
        if fields_filter and not isinstance(fields_filter, list):
            fields_filter = None
        _needs = lambda *flds: not fields_filter or any(f in fields_filter for f in flds)

        _gis = _get_gis()

        updates: dict[str, int | float] = {}

        # Rules
        if _needs("Peak pedestrian flow along or across facility") and _gis.is_mrt(pt):
            updates["Peak pedestrian flow along or across facility"] = 3
        if _needs("Heavy vehicle flow") and _gis.is_bus_lane(pt):
            updates["Heavy vehicle flow"] = 2
        if _needs("Adjacent Vehicle Parking 0-1m") and _gis.is_parking(pt):
            updates["Adjacent Vehicle Parking 0-1m"] = 1
        if _needs("Peak pedestrian flow along or across facility") and _gis.is_bus_stop(pt):
            # overrides 3 → 2
            updates["Peak pedestrian flow along or across facility"] = 2

        # Pedestrian Crossing Detection
        # Set to Present (1) if within 5m of bus stop OR road crossing
        if _needs("Pedestrian Crossing") and (
            _gis.is_bus_stop(pt, dist=10)
            or _gis.is_road_crossing(pt, dist=10)
            or _gis.is_mrt(pt, dist=10)
        ):
            updates["Pedestrian Crossing"] = 1  # 1 = Present

        # Bicycle Crossing Facility Detection
        # Set Crossing Facility = Present (1) and Crossing Type = "Bicycle Crossing"
        # if within 2m of a known bicycle crossing point (AMG_BC2025_shp)
        if _needs("Crossing Facility", "Crossing Type") and _gis.is_bicycle_crossing(pt, dist=2):
            updates["Crossing Facility"] = 1          # 1 = Present
            updates["Crossing Type"] = "Bicycle Crossing"

        # Intersecting Bicycle Facility Detection
        # Present (1) if within 5m of a road crossing; Not Present (2) otherwise.
        # CV will override to Not Present (2) if a dominant traffic/zebra crossing mask is detected.
        if _needs("Intersecting Bicycle Facility"):
            if _gis.is_road_crossing(pt, dist=5):
                updates["Intersecting Bicycle Facility"] = 1  # 1 = Present
            else:
                updates["Intersecting Bicycle Facility"] = 2  # 2 = Not Present

        if _needs("Area type"):
            area = _gis.get_area_type(pt)
            updates["Area type"] = int(area)

        if _needs("Road AADT"):
            updates["Road AADT"] = 6000

        if _needs("Peak bicycle/LV traffic flow", "Peak pedestrian flow along or across facility"):
            res = _gis.get_peak_pedestrian_flow(pt, dist=10)
            bpks = (res or {}).get("before_peaks")
            spks = (res or {}).get("sensor_peaks")

            def apply_peak(peaks):
                if not peaks:
                    return
                if int(peaks.get("MICROMOBILITY", 0)) > 50:
                    updates["Peak bicycle/LV traffic flow"] = 2
                if int(peaks.get("OTHER", 0)) > 50:
                    updates["Peak pedestrian flow along or across facility"] = 3

            if spks:
                apply_peak(spks)
            elif bpks:
                apply_peak(bpks)

        # Added for Road Operating Speed (mean)
        # Calculate road operating speed based on nearest road link
        if _needs("Road operating speed (mean)"):
            road_speed = _gis.get_road_operating_speed(pt, buffer_dist=20, max_dist=30, default_speed=30.0)
            updates["Road operating speed (mean)"] = road_speed

        # Added for Road Speed Limit
        # Calculate road speed limit based on nearest speed limit segment
        if _needs("Road speed limit"):
            speed_limit = _gis.get_road_speed_limit(pt, buffer_dist=20, max_dist=30, default_limit=10)
            updates["Road speed limit"] = speed_limit

        # Added for Heavy Vehicle Flow
        # Calculate heavy vehicle flow based on proximity to bus lanes
        if _needs("Heavy vehicle flow"):
            heavy_vehicle_flow = _gis.get_heavy_vehicle_flow(pt, buffer_dist=15, max_dist=15, default_value=1)
            updates["Heavy vehicle flow"] = heavy_vehicle_flow

        # Added for Curvature
        # Calculate curvature using actual path centerline shapefiles
        # Uses two-stage process from original PathAssignmentTool:
        #   Stage 1: Expanding ring (1m→5m) to find nearest path
        #   Stage 2: Fixed 5m window to calculate curvature from that path
        if _needs("Curvature", "Curvature Sub-category"):
            curvature, curvature_subcat = _gis.get_curvature(curvature_pt, sharp_turn_threshold=10.0, default_value=2)
            updates["Curvature"] = curvature
            if curvature_subcat is not None:
                updates["Curvature Sub-category"] = curvature_subcat

        # Added for Facility Width per Direction
        # Calculate facility width using expanding ring search on path centerline shapefiles
        if _needs("Facility Width per Direction", "Facility Width Sub-category"):
            facility_width, width_subcat = _gis.get_facility_width(pt, start_radius=2.0, max_radius=10.0, step_size=2.0, default_value=2)
            updates["Facility Width per Direction"] = facility_width
            if width_subcat is not None:
                updates["Facility Width Sub-category"] = width_subcat

        # Added for Number of lanes – adjacent road
        # Look up the LANES attribute from the nearest kerb line within 20 m
        if _needs("Number of lanes – adjacent road"):
            nol = _gis.get_number_of_lane(pt, dist=20)
            if nol is not None:
                updates["Number of lanes – adjacent road"] = nol

        # Defect-based surface condition checks
        _DEFORM = "Major Surface Deformation or Drain Opening"
        _SLIP = "Loose or slippery surface"
        if _needs(_DEFORM, _SLIP):
            try:
                from shapely.geometry import LineString as _LineString
                import geopandas as _gpd
                from app.services.defects_store import get_defects_store
                line_raw = _LineString(coords)
                # Auto-detect CRS: EPSG:3414 easting > 180; WGS84 lon ≈ 103–104
                if coords[0][0] < 180:
                    line_metric = _gpd.GeoSeries([line_raw], crs="EPSG:4326").to_crs("EPSG:3414").iloc[0]
                else:
                    line_metric = line_raw
                nearby = get_defects_store().query_near_line(line_metric, 5.0)
                has_deform = False
                has_slip = False
                for d in nearby:
                    dt = d["type_of_defect"].strip().lower()
                    if dt == "algae":
                        has_slip = True
                    elif dt != "faded marking":
                        has_deform = True
                if has_deform and _needs(_DEFORM):
                    updates[_DEFORM] = 1
                if has_slip and _needs(_SLIP):
                    updates[_SLIP] = 1
            except FileNotFoundError:
                pass
            except Exception:
                pass

        # Return both updates and changed_fields for change tracking/highlighting in UI
        # changed_fields: list of field names that were updated by GIS rules
        return ok({"updates": updates, "changed_fields": list(updates.keys())})

    except ServiceUnavailable as e:
        return fail(str(e), 503)
    except Exception as e:
        traceback.print_exc()
        return fail(f"autocode_gis error: {e}", 500)


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
                        print(f"[GIS] Layer '{layer_key}' sub-layer '{layer_name}': empty or None — skipped")
                        continue

                    # Spatial query using the CACHED sindex (fast, read-only)
                    candidate_indices = list(gdf.sindex.intersection(buffer_geom.bounds))

                    if not candidate_indices:
                        print(f"[GIS] Layer '{layer_key}' sub-layer '{layer_name}': 0 candidates in spatial index (total features: {len(gdf)})")
                        continue

                    candidates = gdf.iloc[candidate_indices]
                    intersecting = candidates[candidates.geometry.notna() & candidates.intersects(buffer_geom)]

                    print(f"[GIS] Layer '{layer_key}' sub-layer '{layer_name}': {len(intersecting)} intersecting features found (candidates: {len(candidates)})")

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
                    print(f"Error processing sub-layer '{layer_name}': {e}")

            result_layers[layer_key] = all_features

        # Build response
        layer_summary = {k: len(v) for k, v in result_layers.items()}
        print(f"[GIS] Response: {layer_summary}")

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

@bp.route('/gis/viewport', methods=['POST'])
def get_gis_viewport_layers():
    """Fetch GIS layers within a map viewport bounding box (used by Path Analysis page)."""
    try:
        data = request.get_json(force=True) or {}
        bbox = data.get('bbox')           # [minLon, minLat, maxLon, maxLat]
        requested_layers = data.get('layers', [])
        max_features = min(int(data.get('max_features', 300)), 500)

        if not bbox or len(bbox) != 4:
            return fail("bbox must be [minLon, minLat, maxLon, maxLat]", 400)

        min_lon, min_lat, max_lon, max_lat = [float(v) for v in bbox]

        _gis = _get_gis()

        # Reproject the bbox from WGS84 to the metric CRS used for spatial indexing
        bbox_gdf = gpd.GeoDataFrame(geometry=[box(min_lon, min_lat, max_lon, max_lat)], crs="EPSG:4326")
        bbox_gdf = bbox_gdf.to_crs(_gis.store.metric_crs)
        buffer_geom = bbox_gdf.geometry.iloc[0]

        layer_names = {
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

        result_layers = {}

        for layer_key in requested_layers:
            if layer_key not in layer_names:
                continue

            layer_targets = layer_names[layer_key]
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

                    intersecting_wgs84 = intersecting.copy().to_crs("EPSG:4326")

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
                    print(f"[GIS Viewport] Error processing layer '{layer_name}': {e}")

            result_layers[layer_key] = all_features

        layer_summary = {k: len(v) for k, v in result_layers.items()}
        print(f"[GIS Viewport] Response: {layer_summary}")
        return ok({"ok": True, "layers": result_layers})

    except Exception as e:
        traceback.print_exc()
        return fail(f"GIS viewport layers error: {e}", 500)


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


@bp.post("/<project_name>/autocode/all")
def autocode_all(project_name: str):
    """
    Modes:
      A) Single (backward-compatible):
         Body: { imageRef: "...", coords: [[lon,lat],...], index?: int }
      B) Bulk - all rows:
         Body: { all: true }  (optionally { save: true } to persist)
      C) Bulk - selected indices:
         Body: { indices: [0,2,5], save?: true }

    Returns:
      - For single: { updates: {...}, saved: bool }
      - For bulk: {
          saved: bool,
          total: N,
          ok: K,
          fail: M,
          errors: [{ index, reason }],
        }
    """
    try:
        payload = request.get_json(force=True, silent=True) or {}
        want_stream: bool = bool(payload.get("stream", False))

        # ---------- detect mode ----------
        run_all: bool = bool(payload.get("all"))
        indices = payload.get("indices")
        has_single_fields = ("imageRef" in payload) or ("coords" in payload) or ("index" in payload)

        # Always ensure models/layers first
        _ensure_models_ready()

        ctx = get_ctx()
        pm = ctx["pm"]
        proj = pm.project(project_name)
        ver = proj.latest()

        # ---------- helpers to resolve per-row data ----------
        import math
        from shapely.geometry import LineString as _LS

        def _resolve_image_ref(idx: int) -> str | None:
            """
            Resolve the image filename for a given row index.

            This function looks for image references in the correct location:
            1. Primary source: geo_data.df (where project_manager stores image refs during creation)
            2. Fallback: attributes.df (in case user manually added it there)

            It also verifies that the referenced image file actually exists on disk.

            Args:
                idx: Row index in the attributes/geo_data tables

            Returns:
                str: Image filename if found and exists, None otherwise
            """
            def _image_ref_exists(img_ref: str) -> bool:
                """Check images/ dir first, then in/ (for new/migrated projects)."""
                legacy = (pm.des_path / project_name / global_var.PROJECT_IMAGES_FOLDER / img_ref).resolve()
                if legacy.is_file():
                    return True
                return _resolve_image_from_in(pm, project_name, img_ref) is not None

            # Primary source: geo_data (where image references are stored during project creation)
            if 0 <= idx < len(proj.geo_data.df):
                geo_row = proj.geo_data.df.iloc[idx]
                for key in ("Image Reference", "Image_Reference", "image", "img", "FILENAME"):
                    if key in geo_row and pd.notna(geo_row[key]) and str(geo_row[key]).strip():
                        img_ref = str(geo_row[key]).strip()
                        if _image_ref_exists(img_ref):
                            return img_ref

            # Fallback: attributes table (in case it was copied there)
            if 0 <= idx < len(ver.attributes.df):
                attr_row = ver.attributes.df.iloc[idx]
                for key in ("Image Reference", "Image_Reference", "image", "img", "FILENAME"):
                    if key in attr_row and pd.notna(attr_row[key]) and str(attr_row[key]).strip():
                        img_ref = str(attr_row[key]).strip()
                        if _image_ref_exists(img_ref):
                            return img_ref
            return None

        def _resolve_coords(idx: int):
            if 0 <= idx < len(proj.geo_data.df):
                geom = proj.geo_data.df.geometry.iloc[idx]
                if geom is not None and isinstance(geom, _LS) and not geom.is_empty:
                    # shapely coords -> [[lon,lat], ...]
                    return [list(c) for c in list(geom.coords)]
            return None

        # Fields produced EXCLUSIVELY by GIS (autocode_gis). CV never produces these.
        # Safe to skip CV inference when ALL requested fields are in this set.
        # NOTE: "Peak pedestrian flow along or across facility" is intentionally EXCLUDED —
        # GIS conditionally overrides CV for that field; if GIS doesn't fire (not near MRT/bus
        # stop), the CV-computed default is the correct final value, so CV must still run.
        _GIS_ONLY_FIELDS: frozenset = frozenset({
            "Area type",
            "Road AADT",
            "Road operating speed (mean)",
            "Road speed limit",
            "Curvature",
            "Curvature Sub-category",
            "Facility Width per Direction",
            "Facility Width Sub-category",
            "Heavy vehicle flow",
            "Adjacent Vehicle Parking 0-1m",
            "Pedestrian Crossing",
            "Peak bicycle/LV traffic flow",
            "Grade",  # from LAZ gradient lookup, not from CV
            "Number of lanes – adjacent road",  # from kerb_line shapefile LANES column
        })

        def _call_autocode_pair(image_ref: str, coords, skip_cv: bool = False, skip_gis: bool = False, skip_obstacles: bool = False, fields_filter: "list | None" = None):
            """
            Call CV and/or GIS autocoding for a single image and merge results.

            This function orchestrates the complete auto-coding process:
            1. Calls autocode_image (CV model) to analyze the photo   [skippable]
            2. Calls autocode_gis (GIS rules) to analyze the location [skippable]
            3. Merges updates (GIS overrides CV if both set the same field)
            4. Tracks the source (CV or GIS) for each updated field

            Args:
                image_ref: Image filename (e.g., "ProjectName_IMG_001.jpg")
                coords: LineString coordinates as [[lon, lat], ...] for GIS analysis
                skip_cv: If True, skip CV inference entirely (safe when all requested
                         fields are in _GIS_ONLY_FIELDS — CV never produces them)
                skip_gis: If True, skip GIS queries entirely
                skip_obstacles: If True, skip the obstacle detector model (second YOLO
                         pass) — safe when no obstacle-related fields are requested

            Returns:
                tuple: (merged_updates, sources, error)
                    - merged_updates: dict of {field_name: code_value}
                    - sources: dict of {field_name: "CV" or "GIS"}
                    - error: None if success, error message string if failed
            """
            img_updates: dict = {}
            if not skip_cv:
                # Call CV auto-coding endpoint
                with current_app.test_request_context(method="POST", json={"imageRef": image_ref, "skipObstacles": skip_obstacles}):
                    img_resp, img_code = autocode_image(project_name)
                if img_code >= 400:
                    return None, None, img_resp.get_json().get("error", f"/image {img_code}")
                img_updates = (img_resp.get_json() or {}).get("updates", {})

            gis_updates: dict = {}
            if not skip_gis:
                # Call GIS auto-coding endpoint
                with current_app.test_request_context(method="POST", json={"coords": coords, "fields": fields_filter}):
                    gis_resp, gis_code = autocode_gis(project_name)
                if gis_code >= 400:
                    return None, None, gis_resp.get_json().get("error", f"/gis {gis_code}")
                gis_updates = (gis_resp.get_json() or {}).get("updates", {})

            # Merge updates: GIS overrides CV if both set the same field
            # Example: If CV sets "Area type"=2 and GIS sets "Area type"=1, final value is 1
            merged = {**img_updates, **gis_updates}

            # Special case: "Crossing Type" — append GIS value to CV value instead of override
            # e.g. CV="Traffic Crossing" + GIS="Bicycle Crossing" → "Traffic Crossing, Bicycle Crossing"
            if "Crossing Type" in img_updates and "Crossing Type" in gis_updates:
                cv_type = img_updates["Crossing Type"]   # may be None
                gis_type = gis_updates["Crossing Type"]
                merged["Crossing Type"] = f"{cv_type}, {gis_type}" if cv_type else gis_type

            # Track which fields came from CV vs GIS for UI highlighting badges
            sources = {}
            for field in img_updates:
                sources[field] = "CV"
            for field in gis_updates:
                sources[field] = "GIS"  # GIS overrides CV source if both set the same field

            # Special case: "Intersecting Bicycle Facility" — CV wins over GIS only when CV
            # explicitly detected a dominant traffic/zebra crossing (value is not None).
            # GIS says Present when a road crossing is within 5 m, but if CV saw a pedestrian
            # crossing dominating the image it overrides to Not Present.
            ibf_key = "Intersecting Bicycle Facility"
            if img_updates.get(ibf_key) is not None and ibf_key in gis_updates:
                merged[ibf_key] = img_updates[ibf_key]
                sources[ibf_key] = "CV"

            return merged, sources, None

        # ========================================================================
        # Used by the single "Auto-code" button in the UI
        # Payload: { imageRef: "...", coords: [[lon,lat],...], index?: int }
        if has_single_fields and not run_all and not indices:
            image_ref = payload.get("imageRef")
            coords = payload.get("coords")
            if not image_ref or not coords:
                return fail("imageRef and coords are required", 400)

            # Call CV + GIS autocoding
            merged, sources, err = _call_autocode_pair(image_ref, coords)
            if err:
                return fail(err, 500)

            # Inject Grade from pre-computed LAZ gradient lookup
            _inject_grade(image_ref, merged, sources, project_name=project_name)
            idx = payload.get("index")
            if isinstance(idx, int) and 0 <= idx < len(ver.attributes.df):
                changed_fields = []  # Only fields that actually changed value
                field_sources = {}   # Source (CV/GIS) for each changed field

                for field, code in (merged or {}).items():
                    # Check if value actually changed (not just set to same value)
                    old_val = ver.attributes.df.at[idx, field] if field in ver.attributes.df.columns else None
                    if old_val != code:
                        changed_fields.append(field)
                        field_sources[field] = sources.get(field, "Unknown")
                    # Update the DataFrame
                    ver.attributes.df.at[idx, field] = code

                # Save immediately for single-image autocoding
                ver.save_all()

                return ok({
                    "updates": merged,
                    "saved": True,
                    "changed_fields": changed_fields,      # For UI highlighting
                    "field_sources": field_sources         # For CV/GIS badges
                })

            # No index provided - return updates without saving
            return ok({
                "updates": merged,
                "saved": False,
                "changed_fields": list(merged.keys()),
                "field_sources": sources
            })

        # ========================================================================
        # BULK MODE: Auto-code multiple/all images
        # ========================================================================
        # Used by the "Auto-code all" button in the UI
        # Payload options:
        #   - { all: true, save?: false }              -> Process all rows
        #   - { indices: [0,2,5], save?: false }       -> Process specific rows
        #   - { ..., stream: true }                    -> SSE streaming (yields progress per row)

        # Determine which rows to process
        if not indices:
            indices = list(range(len(ver.attributes.df)))
        else:
            indices = [i for i in indices if isinstance(i, int) and 0 <= i < len(ver.attributes.df)]

        # Check if we should save to disk (default: True, but UI passes False for temp changes)
        save = bool(payload.get("save", True))

        # Optional field filter: only apply updates for these specific field names
        fields_filter = payload.get("fields")  # list[str] | None
        if fields_filter and not isinstance(fields_filter, list):
            fields_filter = None  # Ignore malformed value

        # Determine whether CV inference can be skipped for this batch.
        # CV is safe to skip only when ALL requested fields are exclusively
        # produced by GIS (never by CV). This avoids running expensive YOLO
        # inference when the user selects e.g. only "Area type" or "Curvature".
        skip_cv = bool(fields_filter and all(f in _GIS_ONLY_FIELDS for f in fields_filter))
        if skip_cv:
            print(f"[Autocode] Skipping CV inference — all requested fields are GIS-only: {fields_filter}", flush=True)

        # Fields that require the obstacle detector model (second YOLO pass).
        # Safe to skip when none of these are in the requested fields.
        _CV_OBSTACLE_FIELDS: frozenset = frozenset({
            "Fixed Obstacle on Facility",
            "Non-Fixed Obstacle on Facility",
            "Width Restriction",
            "FO Type",
            "NFO Type",
        })
        skip_obstacles = bool(
            not skip_cv  # obstacle skip only relevant when CV runs at all
            and fields_filter
            and not any(f in _CV_OBSTACLE_FIELDS for f in fields_filter)
        )
        if skip_obstacles:
            print(f"[Autocode] Skipping obstacle detection — no obstacle fields requested: {fields_filter}", flush=True)

        def _bulk_gen():
            """
            Generator that processes all rows and yields dicts:
              {"type": "progress", "processed": N, "total": M, "errors": E}  — after each row
              {"type": "done", "saved": bool, "total": M, "ok": K, ...}       — after completion

            Streaming mode (want_stream=True): events are serialised to SSE and returned as a
            Flask streaming Response so the frontend can update the progress counter per segment.
            Non-streaming mode: events are consumed internally and the "done" event is returned
            as a normal JSON response (backward-compatible).
            """
            import json as _json  # noqa: F401 — used by caller's SSE wrapper
            global _INFERENCE_DEPTH

            errors: list = []
            ok_count: int = 0
            changed_by_row: dict = {}
            sources_by_row: dict = {}

            total_count = len(indices)
            print(f"[Autocode] Bulk starting: {total_count} rows for project '{project_name}'", flush=True)
            _INFERENCE_DEPTH += 1
            try:
                for idx in indices:
                    try:
                        # Resolve image filename and coordinates for this row
                        image_ref = _resolve_image_ref(idx)
                        coords = _resolve_coords(idx)

                        # Validate we have the required data
                        if not image_ref:
                            geo_row = proj.geo_data.df.iloc[idx] if idx < len(proj.geo_data.df) else None
                            if geo_row is not None:
                                img_col = "Image Reference"
                                img_val = geo_row.get(img_col) if img_col in geo_row else None
                                errors.append({"index": idx, "reason": f"missing or invalid imageRef (geo_data['{img_col}'] = {repr(img_val)})"})
                            else:
                                errors.append({"index": idx, "reason": "missing imageRef (row not in geo_data)"})
                            continue

                        if not coords:
                            errors.append({"index": idx, "reason": "missing LineString coords"})
                            continue

                        # Run CV + GIS autocoding for this row
                        merged, sources, err = _call_autocode_pair(image_ref, coords, skip_cv=skip_cv, skip_obstacles=skip_obstacles, fields_filter=fields_filter)
                        if err:
                            errors.append({"index": idx, "reason": err})
                            continue

                        # Inject Grade from pre-computed LAZ gradient lookup
                        if not skip_cv or (fields_filter and "Grade" in fields_filter):
                            _inject_grade(image_ref, merged, sources, project_name=project_name)

                        # Apply per-attribute filter: only keep requested fields
                        if fields_filter:
                            actual_filter = list(fields_filter)
                            if "Grade" in actual_filter:
                                actual_filter.append("Gradient %")
                            if "Delineation" in actual_filter:
                                actual_filter.append("Delineation Type")
                            merged = {k: v for k, v in (merged or {}).items() if k in actual_filter}
                            sources = {k: v for k, v in (sources or {}).items() if k in actual_filter}

                        # Track which fields actually changed (for UI highlighting)
                        changed_fields: list = []
                        field_sources: dict = {}
                        for field, code in (merged or {}).items():
                            old_val = ver.attributes.df.at[idx, field] if field in ver.attributes.df.columns else None
                            if old_val != code:
                                changed_fields.append(field)
                                field_sources[field] = sources.get(field, "Unknown")
                            ver.attributes.df.at[idx, field] = code

                        changed_by_row[idx] = changed_fields
                        sources_by_row[idx] = field_sources
                        ok_count += 1

                        # Yield per-row progress event (consumed by SSE wrapper or discarded)
                        yield {"type": "progress", "processed": ok_count, "total": total_count, "errors": len(errors)}

                        if ok_count % 10 == 0:
                            print(f"[Autocode] Bulk progress: {ok_count}/{total_count} done ({len(errors)} errors so far)", flush=True)

                    except Exception as e:
                        traceback.print_exc()
                        errors.append({"index": idx, "reason": str(e)})
            finally:
                _INFERENCE_DEPTH -= 1

            # --- Area Type Smoothing (100m rule) ---
            try:
                area_col = "Area type"
                if len(indices) > 1 and area_col in ver.attributes.df.columns and (not fields_filter or area_col in fields_filter):
                    import pandas as pd
                    df_len = len(ver.attributes.df)
                    area_vals = ver.attributes.df[area_col].copy()
                    
                    lengths = pd.Series([10.0] * df_len)
                    if getattr(proj, "geo_data", None) and getattr(proj.geo_data, "df", None) is not None and "Length" in proj.geo_data.df.columns:
                        lengths = pd.to_numeric(proj.geo_data.df["Length"], errors='coerce').fillna(10.0)
                    elif "Length" in ver.attributes.df.columns:
                        lengths = pd.to_numeric(ver.attributes.df["Length"], errors='coerce').fillna(10.0)
                    elif "Distance" in ver.attributes.df.columns:
                        lengths = pd.to_numeric(ver.attributes.df["Distance"], errors='coerce').fillna(10.0)
                    
                    i = 0
                    while i < df_len:
                        curr_val = area_vals.iloc[i]
                        run_len = 0.0
                        j = i
                        while j < df_len and area_vals.iloc[j] == curr_val:
                            run_len += lengths.iloc[j]
                            j += 1
                        
                        if run_len < 100.0:
                            prev_val = area_vals.iloc[i-1] if i > 0 else None
                            next_val = area_vals.iloc[j] if j < df_len else None
                            replace_val = curr_val
                            if prev_val is not None:
                                replace_val = prev_val
                            elif next_val is not None:
                                replace_val = next_val
                                
                            for k in range(i, j):
                                area_vals.iloc[k] = replace_val
                        i = j
                        
                    for idx_ in range(df_len):
                        new_val = area_vals.iloc[idx_]
                        if ver.attributes.df.at[idx_, area_col] != new_val:
                            ver.attributes.df.at[idx_, area_col] = new_val
                            if idx_ in changed_by_row:
                                if area_col not in changed_by_row[idx_]:
                                    changed_by_row[idx_].append(area_col)
                            else:
                                changed_by_row[idx_] = [area_col]
                                
                            if idx_ not in sources_by_row:
                                sources_by_row[idx_] = {}
                            sources_by_row[idx_][area_col] = "GIS (Smoothed)"
            except Exception as e:
                print(f"[Autocode] Area type smoothing failed: {e}", flush=True)

            # Save to disk (runs only when the loop completes; skipped on generator abandon/disconnect)
            if save and ok_count > 0:
                print(f"[Autocode] Bulk complete: {ok_count}/{total_count} OK, {len(errors)} failed. Saving...", flush=True)
                ver.save_all()
                proj.metadata.last_updated = datetime.datetime.now()
                proj.metadata.serialize(proj.project_path)

            updated_attributes = df_to_records(ver.attributes.df)
            yield {
                "type": "done",
                "saved": bool(save and ok_count > 0),
                "total": len(indices),
                "ok": ok_count,
                "fail": len(errors),
                "errors": errors,
                "changed_by_row": changed_by_row,
                "sources_by_row": sources_by_row,
                "updated_attributes": updated_attributes,
            }

        # ── Streaming mode: return SSE response ──────────────────────────────
        if want_stream:
            import json as _json

            def _sse():
                for event in _bulk_gen():
                    yield f"data: {_json.dumps(event)}\n\n"

            return Response(
                stream_with_context(_sse()),
                mimetype="text/event-stream",
                headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
            )

        # ── Non-streaming mode: consume generator, return JSON ───────────────
        final_event = None
        for event in _bulk_gen():
            if event["type"] == "done":
                final_event = event
        return ok({k: v for k, v in (final_event or {}).items() if k != "type"})

    except ServiceUnavailable as e:
        return fail(str(e), 503)
    except Exception as e:
        traceback.print_exc()
        return fail(f"autocode_all error: {e}", 500)


# ===== Baseline Management Endpoints =====

@bp.get("/<project_name>/baseline/exists")
def baseline_exists(project_name: str):
    """Check if baseline CSV exists for a project."""
    try:
        ctx = get_ctx()
        pm = ctx["pm"]
        proj = pm.project(project_name)

        baseline_path = proj.project_path / "baseline" / f"{project_name}_baseline.csv"
        exists = baseline_path.exists()

        return ok({"exists": exists})
    except KeyError:
        return fail("Project not found", 404)
    except Exception as e:
        traceback.print_exc()
        return fail(f"Error checking baseline: {e}", 500)


@bp.get("/<project_name>/baseline")
def get_baseline(project_name: str):
    """
    Get baseline CSV as JSON array of row dictionaries.

    Response:
        {
            "ok": true,
            "rows": [
                {"Facility Type": 2, "Area type": 1, ...},
                ...
            ]
        }
    """
    try:
        ctx = get_ctx()
        pm = ctx["pm"]
        proj = pm.project(project_name)

        baseline_path = proj.project_path / "baseline" / f"{project_name}_baseline.csv"

        if not baseline_path.exists():
            return ok({"rows": []})  # No baseline yet

        # Read CSV and convert to JSON
        baseline_df = pd.read_csv(baseline_path)
        rows = df_to_records(baseline_df)

        return ok({"rows": rows})

    except KeyError:
        return fail("Project not found", 404)
    except Exception as e:
        traceback.print_exc()
        return fail(f"Error reading baseline: {e}", 500)


@bp.post("/<project_name>/baseline")
def save_baseline(project_name: str):
    """
    Create or update baseline CSV for a project.

    Body:
        {
            "rows": [
                {"Facility Type": 2, "Area type": 1, ...},
                ...
            ]
        }

    Response:
        {
            "ok": true,
            "message": "Baseline saved successfully"
        }
    """
    try:
        ctx = get_ctx()
        pm = ctx["pm"]
        proj = pm.project(project_name)

        data = request.get_json(force=True, silent=True) or {}
        rows = data.get("rows")

        if not isinstance(rows, list):
            return fail("rows must be an array", 400)

        # Create baseline directory if not exists
        baseline_dir = proj.project_path / "baseline"
        baseline_dir.mkdir(parents=True, exist_ok=True)

        # Create DataFrame and save to CSV
        baseline_df = pd.DataFrame(rows)
        baseline_path = baseline_dir / f"{project_name}_baseline.csv"
        baseline_df.to_csv(baseline_path, index=False, encoding='utf-8')

        return ok({"message": "Baseline saved successfully"})

    except KeyError:
        return fail("Project not found", 404)
    except Exception as e:
        traceback.print_exc()
        return fail(f"Error saving baseline: {e}", 500)

# ===== Autocode Metadata Management Endpoints =====

@bp.get("/<project_name>/autocode-metadata")
def get_autocode_metadata(project_name: str):
    """
    Get autocode metadata (changed fields and sources) as JSON.
    
    Response:
        {
            "ok": true,
            "changedFieldsByRow": { "0": ["Field1"], ... },
            "fieldSourcesByRow": { "0": {"Field1": "GIS"}, ... }
        }
    """
    try:
        ctx = get_ctx()
        pm = ctx["pm"]
        proj = pm.project(project_name)
        
        # Use 'autocode' directory for metadata
        autocode_dir = proj.project_path / "autocode"
        metadata_path = autocode_dir / f"{project_name}_metadata.json"
        
        if not metadata_path.exists():
            return ok({
                "changedFieldsByRow": {},
                "fieldSourcesByRow": {}
            })
            
        import json
        with open(metadata_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        return ok(data)

    except KeyError:
        return fail("Project not found", 404)
    except Exception as e:
        traceback.print_exc()
        return fail(f"Error reading autocode metadata: {e}", 500)

@bp.post("/<project_name>/autocode-metadata")
def save_autocode_metadata(project_name: str):
    """
    Save autocode metadata (changed fields and sources) as JSON.
    
    Body:
        {
            "changedFieldsByRow": { ... },
            "fieldSourcesByRow": { ... }
        }
    """
    try:
        ctx = get_ctx()
        pm = ctx["pm"]
        proj = pm.project(project_name)
        
        data = request.get_json(force=True, silent=True) or {}
        
        # Create autocode directory if not exists
        autocode_dir = proj.project_path / "autocode"
        autocode_dir.mkdir(parents=True, exist_ok=True)
        
        metadata_path = autocode_dir / f"{project_name}_metadata.json"
            
        import json
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            
        return ok({"message": "Autocode metadata saved successfully"})

    except KeyError:
        return fail("Project not found", 404)
    except Exception as e:
        traceback.print_exc()
        return fail(f"Error saving autocode metadata: {e}", 500)
