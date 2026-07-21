import logging
import os

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
