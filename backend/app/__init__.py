import logging
import os

from flask import Flask
from flask_cors import CORS
from .config import Config
from .api import register_blueprints


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
    app = Flask(__name__)
    app.config.from_object(config_object)

    # Enable CORS for all routes
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    register_blueprints(app)

    # Pre-load GIS shapefiles in background so layer toggles are instant
    from .api.projects.routes import warmup_gis
    warmup_gis()

    return app
