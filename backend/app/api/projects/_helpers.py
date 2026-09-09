"""Shared request/response + init infrastructure for the projects blueprint.

Owns the single `projects` Flask blueprint's cross-cutting helpers: the request
context (`get_ctx`), JSON envelopes (`ok`/`fail`), the `with_project` decorator,
the GIS singleton (`_get_gis`), CV-model readiness, the incoming-request logger,
and the shared `_INFERENCE_DEPTH` counter. Every route module imports from here."""
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
            logger.info(f"[GIS] Initializing with shp_dir: {shp_dir}")
            if not shp_dir.exists():
                logger.error(f"[GIS] ERROR: Shapefile directory NOT FOUND at {shp_dir}")
                # Try fallback parent logic if needed, but resolve() should be correct
                raise FileNotFoundError(f"Shapefile directory not found: {shp_dir}")
            _GIS_INSTANCE = gis.GIS(gis.LayerStore.default(base_dir=str(shp_dir)))
            logger.info(f"[GIS] Instance created successfully.")
    return _GIS_INSTANCE


def warmup_gis() -> None:
    """Pre-warm the GIS singleton in a background thread at app startup.

    Called once from create_app() so shapefiles are loaded before the first
    real request arrives, eliminating the cold-start penalty for end users.
    Any error is logged but never raised — the app remains fully functional,
    _get_gis() will just re-attempt construction on first use.
    """
    import threading

    def _warm() -> None:
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

# Metadata PATCH payloads deferred while _INFERENCE_DEPTH > 0, keyed by
# (profile id, project name), merged and flushed to disk the moment depth
# returns to 0 so deferred counter/tag updates are never silently dropped.
# Keyed by profile as well as project: whichever user's inference finishes
# last does the flush, and that is not necessarily the user who queued it.
_PENDING_METADATA_UPDATES: dict[tuple[str | None, str], dict] = {}
# Guards the depth counter and the pending map. `+= 1` on a module global is
# not atomic; with several users running inference on different waitress
# threads a lost update would leave the depth stuck > 0 and defer every
# metadata PATCH forever.
_PENDING_LOCK = threading.Lock()


def enter_inference() -> None:
    global _INFERENCE_DEPTH
    with _PENDING_LOCK:
        _INFERENCE_DEPTH += 1


def exit_inference() -> None:
    global _INFERENCE_DEPTH
    with _PENDING_LOCK:
        _INFERENCE_DEPTH -= 1
        flush = _INFERENCE_DEPTH == 0 and bool(_PENDING_METADATA_UPDATES)
    if flush:
        _flush_pending_metadata_updates()


def queue_pending_metadata_update(project_name: str, payload: dict) -> bool:
    """Defer a metadata PATCH from the calling session's profile until inference ends.

    Returns False -- and queues nothing -- when no inference is running, in
    which case the caller must apply the update itself. The depth check and the
    enqueue share one lock section: checked separately, a PATCH could observe
    depth > 0, lose the race to exit_inference()'s final flush, and then sit in
    the map unflushed until somebody's next inference run.
    """
    key = (_session_profile_id(), project_name)
    with _PENDING_LOCK:
        if _INFERENCE_DEPTH <= 0:
            return False
        _PENDING_METADATA_UPDATES.setdefault(key, {}).update(payload)
        return True


def apply_metadata_fields(proj, payload: dict) -> bool:
    """Apply tags/path_key/verified/verified_segment_count/autocoded_segment_count
    from payload onto proj.metadata. Returns True if anything changed."""
    changed = False

    new_tags = payload.get("tags")
    if new_tags is not None and isinstance(new_tags, list):
        proj.metadata.tags = new_tags
        changed = True

    new_path_key = payload.get("path_key")
    if new_path_key is not None and isinstance(new_path_key, str):
        proj.metadata.path_key = new_path_key.strip() or None
        changed = True

    new_verified = payload.get("verified")
    if new_verified is not None:
        proj.metadata.verified = bool(new_verified)
        changed = True

    new_verified_segment_count = payload.get("verified_segment_count")
    if new_verified_segment_count is not None:
        proj.metadata.verified_segment_count = int(new_verified_segment_count)
        changed = True

    new_autocoded_segment_count = payload.get("autocoded_segment_count")
    if new_autocoded_segment_count is not None:
        proj.metadata.autocoded_segment_count = int(new_autocoded_segment_count)
        changed = True

    return changed


def _flush_pending_metadata_updates() -> None:
    """Apply and persist any metadata updates deferred during inference.
    Called automatically by exit_inference() once _INFERENCE_DEPTH hits 0."""
    with _PENDING_LOCK:
        pending = dict(_PENDING_METADATA_UPDATES)
        _PENDING_METADATA_UPDATES.clear()

    for (profile_id, project_name), payload in pending.items():
        try:
            # Resolve against the profile that queued the update -- never the
            # session of whichever request happens to be finishing inference.
            pm = get_ctx(profile_id=profile_id)["pm"]
            proj = pm.project(project_name)
            if apply_metadata_fields(proj, payload):
                proj.metadata.last_updated = datetime.datetime.now()
                proj.metadata.serialize(proj.project_path)
        except Exception:
            logger.exception(
                f"[Autocode] Failed to flush pending metadata update for project "
                f"'{project_name}' (profile {profile_id})"
            )

# util
def ok(data, code: int = 200) -> tuple[Response, int]:
    return jsonify(data), code

def fail(message: str, code: int = 400) -> tuple[Response, int]:
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

# Per-profile project contexts (replaces Streamlit's session_state, and the
# single process-wide context that predates per-browser sessions).
#
# Key = the profile id from the request's session cookie. None = the legacy
# data/ root, which is only ever resolved with no request context at all (the
# model/GIS warm-up thread) and is never served to a browser: the login gate
# in app/auth.py rejects unauthenticated /api/* requests before we get here.
_CTXS: dict[str | None, dict] = {}
_CTX_LOCK = threading.Lock()
# serializer.data_loader / cycleRAP_interface are process-wide singletons:
# initialise them once, not once per profile.
_GLOBAL_INIT_DONE = False
_UNSET = object()


def _session_profile_id() -> str | None:
    from app.services import profile_store as _ps
    return _ps.get_active_profile_id()  # None outside a request context


def invalidate_ctx(profile_id: str | None = None) -> None:
    """Drop one profile's cached context (its next request re-discovers projects),
    or every context when called with no argument."""
    with _CTX_LOCK:
        if profile_id is None:
            _CTXS.clear()
        else:
            _CTXS.pop(profile_id, None)


def _run_global_init_once(pm) -> None:
    """Process-level, one-time initialisation. Caller holds _CTX_LOCK."""
    global _GLOBAL_INIT_DONE
    if _GLOBAL_INIT_DONE:
        return

    try:
        serializer.data_loader.initialise()
    except Exception:
        pass

    try:
        CRI.cycleRAP_interface.initialise(pm.src_path / "CycleRAP")
    except Exception as exc:
        # NON-FATAL since scoring went native. Every live scoring/treatment
        # path uses calculate_cyclerap_score_native() (cyclerap_scoring.py,
        # v2.14, pure Python); cycleRAP_interface is the legacy Excel/COM
        # route and is effectively dead code. This used to raise, which
        # bricked the ENTIRE project context -- and therefore the whole app
        # -- if the .xlsm was missing or Excel was not installed. On a
        # packaged machine neither is guaranteed, so log and continue.
        logger.warning(
            "cycleRAP_interface.initialise() failed (non-fatal; native scoring "
            "is used for all live paths): %s", exc
        )
        logger.debug(traceback.format_exc())

    _GLOBAL_INIT_DONE = True


def _build_ctx(key: str | None) -> dict:
    """Build and cache the context for one profile (or the legacy root).
    Caller holds _CTX_LOCK."""
    label = key or "<legacy root>"
    logger.info("[Context] Initialising project context for %s...", label)
    try:
        pm = project_manager()
    except Exception as exc:
        msg = f"project_manager() failed: {exc}\n{traceback.format_exc()}"
        logger.error(f"[Context] ERROR: {msg}")
        _CTXS[key] = {"ready": False, "pm": None, "init_error": msg, "profile_id": key}
        raise RuntimeError(f"Project context failed to initialise: {msg}") from exc

    _run_global_init_once(pm)

    if key is not None:
        # Point the project manager at this profile's project root instead of
        # the legacy ../data directory from config.json. Unlike the single-user
        # code this replaces, a failure here is NOT swallowed: falling back to
        # the shared legacy root would hand one user another's projects.
        from app.services import profile_store as _ps
        pm.des_path = _ps.get_profile_projects_root(key)
        pm._discover_projects()

    ctx = {"pm": pm, "ready": True, "init_error": None, "profile_id": key}
    _CTXS[key] = ctx
    logger.info("[Context] Project context ready for %s.", label)
    return ctx


def get_ctx(profile_id=_UNSET) -> dict:
    """Lazy init: prepare the old-code dependencies the first time and reuse thereafter.

    Returns the context for the calling session's profile by default. Pass
    ``profile_id`` explicitly to target another profile (the deferred-metadata
    flush does), or ``None`` for the legacy root.
    """
    key = _session_profile_id() if profile_id is _UNSET else profile_id
    with _CTX_LOCK:
        ctx = _CTXS.get(key)
        if ctx is None:
            return _build_ctx(key)
        # Surface a previously memoised init failure immediately.
        if ctx["init_error"]:
            raise RuntimeError(f"Project context failed to initialise: {ctx['init_error']}")
        return ctx


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

def _ensure_models_ready() -> None:
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
                    if (d / "path_segmentation_6July.pt").exists():
                        model_dir = d.resolve()
                        break

                if model_dir is None:
                    tried = "\n".join(str(p) for p in candidates)
                    raise RuntimeError(f"Cannot find model_dir (missing path_segmentation_6July.pt). Tried:\n{tried}")

                # YOLO models load
                logger.info(f"[Autocode] Loading CV models from {model_dir} — this may take several minutes on CPU...")
                cv_pred.CycleRAP_Coding_Helper.initialise(model_dir)
                _MODELS_READY["cv"] = True
                logger.info("[Autocode] CV models loaded successfully.")

            except Exception as e:
                _INIT_ERR["cv"] = f"CV init failed: {e}"
                logger.error(f"[Autocode] ERROR: CV model init failed: {e}")
                # Next calls will short-circuit quickly
                raise ServiceUnavailable(_INIT_ERR["cv"])


def _warmup_models_in_background() -> None:
    """Daemon thread: pre-load CV + GIS at server startup so the first autocode request is fast."""
    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed
    # Small delay to let Flask finish starting up before we hammer the CPU
    time.sleep(2)
    logger.info("[Autocode] Background warmup: starting model pre-load...")
    try:
        _ensure_models_ready()
        logger.info("[Autocode] Background warmup: CV models ready.")
    except Exception as e:
        logger.error(f"[Autocode] Background warmup (CV) failed: {e}")

    # Pre-load GIS shapefiles in parallel threads (I/O + C extensions release GIL)
    try:
        logger.info("[GIS] Background warmup: loading shapefiles in parallel...")
        t_total = time.perf_counter()
        _inst = _get_gis()
        layer_names = list(_inst.store.paths.keys())

        def _load_one(name: str) -> float:
            t0 = time.perf_counter()
            _inst.store.get(name)
            return time.perf_counter() - t0

        with ThreadPoolExecutor(max_workers=6, thread_name_prefix="gis-load") as pool:
            futs = {pool.submit(_load_one, n): n for n in layer_names}
            for fut in as_completed(futs):
                name = futs[fut]
                try:
                    elapsed = fut.result()
                    logger.info(f"[GIS] Loaded: {name} ({elapsed:.1f}s)")
                except Exception as exc:
                    logger.warning(f"[GIS] Warning: {name}: {exc}")

        elapsed_total = time.perf_counter() - t_total
        logger.info(f"[GIS] Background warmup complete ({elapsed_total:.1f}s total).")
    except Exception as e:
        logger.error(f"[GIS] Background warmup failed: {e}")


# Kick off background warmup immediately when this module is imported (server start)
_warmup_thread = threading.Thread(target=_warmup_models_in_background, daemon=True, name="model-warmup")
_warmup_thread.start()


# ───────────────────────── Endpoints ─────────────────────────

@bp.before_request
def _log_incoming() -> tuple[Response, int] | None:
    logger.debug(f"[Flask] >>> {request.method} {request.path}")
    try:
        get_ctx()
    except Exception as exc:
        return jsonify({"error": f"Backend initialisation failed: {exc}"}), 500


def _get_segment_midpoint(coords: list) -> "Point":
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
