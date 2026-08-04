"""Single source of truth for the installed PSAT version.

Read from ``backend/version.json``, which ships in the install tree and is
replaced by the updater along with the rest of the app. The updater compares
this against the remote manifest to decide what to fetch, and the launcher
records it so a failed update can roll back to a known-good version -- so it
must be present and cheap to read.

Deliberately NOT derived from git: a packaged install has no git metadata.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from app.services import paths

logger = logging.getLogger(__name__)

UNKNOWN_VERSION = "unknown"

_cache: dict | None = None


def _version_file() -> Path:
    return paths.backend_root() / "version.json"


def get_version_info() -> dict:
    """Return ``{"version": str, "channel": str, "released": str}``. Cached after first read.

    ``released`` is the release date (``YYYY-MM-DD``) shown in the UI; it defaults to
    ``""`` when an older bundle's version.json predates the field.
    """
    global _cache
    if _cache is not None:
        return _cache

    info = {"version": UNKNOWN_VERSION, "channel": "stable", "released": ""}
    path = _version_file()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            info["version"] = str(data.get("version") or UNKNOWN_VERSION)
            info["channel"] = str(data.get("channel") or "stable")
            info["released"] = str(data.get("released") or "")
    except FileNotFoundError:
        logger.warning("version.json not found at %s; reporting '%s'", path, UNKNOWN_VERSION)
    except Exception as exc:
        logger.warning("Could not read version.json (%s); reporting '%s'", exc, UNKNOWN_VERSION)

    _cache = info
    return info


def get_version() -> str:
    return get_version_info()["version"]
