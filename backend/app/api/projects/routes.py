"""Backwards-compatibility shim (S3.2).

The former 6,455-line ``routes.py`` monolith was split into domain blueprint
modules (crud, segments, treatments, images, source_folders, gis_queries,
autocode, export, baseline) plus shared helper modules (_helpers, image_utils,
gradient, roads_util). All handlers still register on the single ``projects``
blueprint, so URLs and endpoint names are unchanged.

This module only re-exports the public names that code outside the package has
historically imported from ``app.api.projects.routes`` (``get_ctx``,
``invalidate_ctx``, ``warmup_gis``, ``_get_gis``, ...).
"""
from ._helpers import (  # noqa: F401
    get_ctx,
    invalidate_ctx,
    warmup_gis,
    _get_gis,
    ok,
    fail,
)
