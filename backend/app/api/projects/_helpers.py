"""Shared request/response + init infrastructure for the projects blueprint.

Owns the single `projects` Flask blueprint's cross-cutting helpers: the request
context (`get_ctx`), JSON envelopes (`ok`/`fail`), the `with_project` decorator,
the GIS singleton (`_get_gis`), CV-model readiness, the incoming-request logger,
and the shared `_INFERENCE_DEPTH` counter. Every route module imports from here."""
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




_INIT_LOCK = threading.Lock()
_INIT_ERR = {"cv": None}

_GIS_INSTANCE: "gis.GIS | None" = None

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
            # Pre-build the prepared (2D, validity-filtered) path layers + spatial
            # indexes so the first curvature autocode doesn't pay that cost on the
            # request thread. Without this, the first bulk curvature run stalls while
            # the ~180k-feature footpath layer is z-stripped and indexed.
            for _store_key in ("cycling_path", "shared_path", "footpath"):
                try:
                    g._load_path_layer(_store_key)
                except Exception:
                    pass
        except Exception as exc:  # pragma: no cover
            import logging
            logging.getLogger(__name__).warning("GIS warmup failed: %s", exc)

    t = threading.Thread(target=_warm, name="gis-warmup", daemon=True)
    t.start()

# Counts nested inference scopes.  PATCH handlers check this and
# return immediately (no-op 200) so they don't hold the GIL during inference.
_INFERENCE_DEPTH = 0

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

        print("[Context] Initialising project context...")
        try:
            pm = project_manager()
        except Exception as exc:
            msg = f"project_manager() failed: {exc}\n{traceback.format_exc()}"
            print(f"[Context] ERROR: {msg}")
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
            print(f"[Context] ERROR: {msg}")
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
            print(f"[Context] Could not resolve profile projects root: {_exc}")

        _CTX.update({"pm": pm, "ready": True, "init_error": None})
        print("[Context] Project context ready.")
        return _CTX


def with_project(_fn=None, *, version=False):
    """Resolve the route's project (and optionally its latest version) and inject them.

    Replaces the ``ctx = get_ctx(); proj = ctx["pm"].project(<name>); ver = proj.latest()``
    boilerplate repeated across most project endpoints, and standardises the
    project-resolution failure path to a JSON 404 (previously inconsistent: some
    handlers caught ``KeyError`` and returned ``fail("Project not found", 404)`` while
    others let it propagate to Flask's default HTML 500).

    Usage::

        @bp.get("/<project_name>/metadata")
        @with_project
        def handler(project_name, pm, proj): ...

        @bp.get("/<project_name>/results")
        @with_project(version=True)
        def handler(project_name, pm, proj, ver): ...

    The project name is read from the route's ``project_name`` kwarg, falling back to
    ``name`` (the ``<string:name>`` variant). Injected kwargs:

    - ``pm``   — the shared, profile-aware project manager (``get_ctx()["pm"]``)
    - ``proj`` — the resolved ``Project``
    - ``ver``  — ``proj.latest()`` (only when ``version=True``)

    Side effects: calls ``get_ctx()`` (cheap cached no-op after ``before_request``).
    Returns ``fail("Project not found", 404)`` on a missing project and
    ``fail("Project version not found", 404)`` when the project has no versions —
    both JSON. All non-resolution errors still surface via the handler's own logic.
    """
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            project_name = kwargs.get("project_name") or kwargs.get("name")
            pm = get_ctx()["pm"]
            try:
                proj = pm.project(project_name)
            except KeyError:
                return fail("Project not found", 404)
            kwargs["pm"] = pm
            kwargs["proj"] = proj
            if version:
                try:
                    kwargs["ver"] = proj.latest()
                except (ValueError, FileNotFoundError):
                    return fail("Project version not found", 404)
            return fn(*args, **kwargs)
        return wrapper

    # Support both bare ``@with_project`` and parameterised ``@with_project(version=True)``.
    return decorator(_fn) if _fn is not None else decorator


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
                print(f"[Autocode] Loading CV models from {model_dir} — this may take several minutes on CPU...")
                cv_pred.CycleRAP_Coding_Helper.initialise(model_dir)
                _MODELS_READY["cv"] = True
                print("[Autocode] CV models loaded successfully.")

            except Exception as e:
                _INIT_ERR["cv"] = f"CV init failed: {e}"
                print(f"[Autocode] ERROR: CV model init failed: {e}")
                # Next calls will short-circuit quickly
                raise ServiceUnavailable(_INIT_ERR["cv"])


def _warmup_models_in_background():
    """Daemon thread: pre-load CV + GIS at server startup so the first autocode request is fast."""
    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed
    # Small delay to let Flask finish starting up before we hammer the CPU
    time.sleep(2)
    print("[Autocode] Background warmup: starting model pre-load...")
    try:
        _ensure_models_ready()
        print("[Autocode] Background warmup: CV models ready.")
    except Exception as e:
        print(f"[Autocode] Background warmup (CV) failed: {e}")

    # Pre-load GIS shapefiles in parallel threads (I/O + C extensions release GIL)
    try:
        print("[GIS] Background warmup: loading shapefiles in parallel...")
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
                    print(f"[GIS] Loaded: {name} ({elapsed:.1f}s)")
                except Exception as exc:
                    print(f"[GIS] Warning: {name}: {exc}")

        elapsed_total = time.perf_counter() - t_total
        print(f"[GIS] Background warmup complete ({elapsed_total:.1f}s total).")
    except Exception as e:
        print(f"[GIS] Background warmup failed: {e}")


# Kick off background warmup immediately when this module is imported (server start)
_warmup_thread = threading.Thread(target=_warmup_models_in_background, daemon=True, name="model-warmup")
_warmup_thread.start()


# ───────────────────────── Endpoints ─────────────────────────

@bp.before_request
def _log_incoming():
    print(f"[Flask] >>> {request.method} {request.path}")
    try:
        get_ctx()
    except Exception as exc:
        return jsonify({"error": f"Backend initialisation failed: {exc}"}), 500


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
