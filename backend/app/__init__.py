# ── OpenMP ordering guard — MUST STAY FIRST ──────────────────────────────────
# torch and MKL each ship their own OpenMP runtime (libiomp5md.dll). If torch
# loads before numpy, two copies get initialised and the process dies with
# "OMP: Error #15 ... libiomp5md.dll already initialized". Importing numpy first
# initialises MKL's copy, which torch then reuses.
#
# Verified on the packaging env (2026-07-21): `import torch` alone -> Error #15;
# `import fiona` then torch -> Error #15; `import numpy` then torch -> fine.
# The app only worked before because geopandas happened to pull numpy in first.
# That is too fragile to rely on, especially in a rebuilt/frozen environment.
#
# Do NOT "fix" a recurrence with KMP_DUPLICATE_LIB_OK=TRUE: Intel documents that
# it can "silently produce incorrect results", which is unacceptable for scoring.
import numpy as _numpy  # noqa: F401  (import for side effect; keep first)

import logging
import os
import sys
from pathlib import Path


def _bind_native_data_dirs() -> None:
    """Point GDAL/PROJ at the data dirs inside THIS interpreter's environment.

    conda normally sets GDAL_DATA/PROJ_LIB from its activation scripts, but the
    packaged app launches ``python.exe`` directly and never activates anything --
    hence the "Cannot find header.dxf (GDAL_DATA is not defined)" warning.

    More importantly the packaged env gets MOVED (built here, installed into
    %LOCALAPPDATA% on another machine), so any absolute data path baked in at
    build time is wrong at runtime. Deriving them from ``sys.prefix`` makes the
    environment self-locating wherever it is unpacked.

    Only sets what is missing, so an explicit override still wins.
    """
    prefix = Path(sys.prefix)
    for var_names, subdir in (
        (("GDAL_DATA",), Path("Library") / "share" / "gdal"),
        (("PROJ_LIB", "PROJ_DATA"), Path("Library") / "share" / "proj"),
    ):
        candidate = prefix / subdir
        if not candidate.is_dir():
            continue
        for var in var_names:
            os.environ.setdefault(var, str(candidate))


_bind_native_data_dirs()

from flask import Flask
from flask_cors import CORS
from .config import Config
from .api import register_blueprints
from .webui import register_webui


def _configure_logging():
    """Configure root logging so the app's leveled logs emit to stdout.

    Replaces the ad-hoc ``print(..., flush=True)`` calls that used to write
    status/diagnostic lines directly to stdout (see REFACTOR_PLAN S3.3). Level
    defaults to INFO and is overridable via the ``LOG_LEVEL`` env var (e.g.
    ``DEBUG`` to surface the per-request/per-segment diagnostics). Idempotent:
    a no-op if logging handlers are already configured (e.g. under Gunicorn).
    """
    level = getattr(logging, os.environ.get("LOG_LEVEL", "INFO").upper(), logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


def create_app(config_object=Config):
    _configure_logging()

    # Make sure the writable tree exists before anything tries to read it. In a
    # packaged install this is the first thing that touches %LOCALAPPDATA%.
    from .services import paths
    paths.ensure_user_dirs()
    logging.getLogger(__name__).info(
        "install_root=%s user_data_root=%s (bundled=%s)",
        paths.install_root(), paths.user_data_root(), paths.is_bundled(),
    )
    # static_folder=None: Flask's default /static route is unused (there is no
    # app/static dir) and would only clutter the URL space that register_webui
    # now owns.
    app = Flask(__name__, static_folder=None)
    app.config.from_object(config_object)

    # Per-browser PIN sessions and the /api/* login gate (multi-user server
    # mode). Must come before the blueprints so the gate runs before any
    # blueprint-level before_request hook.
    from .auth import configure_session, register_auth_gate
    configure_session(app)
    register_auth_gate(app)

    # Enable CORS for all routes
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    register_blueprints(app)

    # Serve the built frontend from the same origin/port as the API. Registered
    # after the blueprints so the SPA catch-all can never shadow /api/*.
    register_webui(app)

    # Pre-load GIS shapefiles in background so layer toggles are instant
    from .api.projects.routes import warmup_gis
    warmup_gis()

    return app
