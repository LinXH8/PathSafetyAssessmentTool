from flask import Blueprint

bp = Blueprint("projects", __name__)

# Support modules (helpers only, no route handlers). Imported first so the
# route modules below can import from them without ordering surprises.
from . import _helpers, roads_util, image_utils, gradient  # noqa: E402,F401

# Route modules. Importing each one registers its handlers on ``bp``.
from . import (  # noqa: E402,F401
    crud,
    segments,
    treatments,
    images,
    source_folders,
    gis_queries,
    autocode,
    export,
    baseline,
)

# Back-compat shim for external imports of ``app.api.projects.routes``.
from . import routes  # noqa: E402,F401
