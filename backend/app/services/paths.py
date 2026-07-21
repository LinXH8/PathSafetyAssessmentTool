"""Central resolution of PSAT's INSTALL root vs. writable USER-DATA root.

Packaging (see ``temp/DEPLOYMENT_PACKAGING_PLAN.md``) splits the filesystem in two:

* **Install root** -- app code, the frozen Python env, YOLO models, bundled GIS
  shapefiles, ``webui/``. Owned and *replaced wholesale* by the updater.
  Treat as read-only at runtime.
* **User-data root** -- profiles, projects, survey images (``in/``), generated
  reports. **Never touched by the updater.** Must always be writable.

Keeping these apart is what lets an update replace app files without destroying
user data, and lets the app be installed somewhere the user cannot write.

Resolution order for the user-data root:
  1. ``PSAT_DATA_DIR`` env var -- what the packaged launcher sets. Explicit wins.
  2. If running from a *bundle* (``webui/`` present, no ``frontend/`` source
     tree), ``%LOCALAPPDATA%\\PSAT\\data``. A safety net so a bundle that was
     launched without the env var still writes somewhere valid rather than into
     a possibly read-only install directory.
  3. Otherwise the repo root -- i.e. **exactly today's dev layout**
     (``<repo>/data``, ``<repo>/in``, ``<repo>/profiles``). Development
     behaviour is intentionally unchanged.

``source_folder`` (the CycleRAP workbook dir) is deliberately NOT relocated: it
is read-only app data and stays in the install root.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# .../backend/app/services/paths.py -> parents[2] == backend/
_BACKEND_ROOT = Path(__file__).resolve().parents[2]


def backend_root() -> Path:
    """The ``backend/`` directory (app code)."""
    return _BACKEND_ROOT


def install_root() -> Path:
    """Install/repo root -- the parent of ``backend/``."""
    return _BACKEND_ROOT.parent


def is_bundled() -> bool:
    """True when running from a packaged bundle rather than a source checkout."""
    root = install_root()
    try:
        return (root / "webui").is_dir() and not (root / "frontend").is_dir()
    except OSError:
        return False


def _platform_data_home() -> Path:
    """Per-user writable app-data dir for the current OS."""
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA")
        return (Path(base) if base else Path.home() / "AppData" / "Local") / "PSAT" / "data"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "PSAT"
    return Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share")) / "PSAT"


def user_data_root() -> Path:
    """Root of all writable state. See module docstring for resolution order."""
    env_dir = os.environ.get("PSAT_DATA_DIR")
    if env_dir:
        return Path(env_dir).expanduser()
    if is_bundled():
        return _platform_data_home()
    return install_root()


# --- individual writable locations -------------------------------------------
# In dev these resolve to exactly the paths used today, so nothing moves.

def profiles_dir() -> Path:
    """Profile registry + per-profile project trees."""
    return user_data_root() / "profiles"


def projects_dir() -> Path:
    """Legacy (pre-profile) project root -- config.json's ``destination_folder``."""
    return user_data_root() / "data"


def in_dir() -> Path:
    """Raw survey image folders -- config.json's ``in_folder``.

    Explicitly excluded from updates: the updater must never touch this.
    """
    return user_data_root() / "in"


def generated_reports_dir() -> Path:
    """Exported reports."""
    return user_data_root() / "Generated Reports"


def _writable_split_active() -> bool:
    """True when writable state must live apart from the install tree.

    In a plain source checkout there is no split: everything stays exactly where
    it is today. The split only engages for a packaged install (or when
    PSAT_DATA_DIR is set explicitly), which is precisely when the install tree
    is updater-owned and possibly read-only.
    """
    return is_bundled() or bool(os.environ.get("PSAT_DATA_DIR"))


def bundled_shapefiles_dir() -> Path:
    """GIS layers shipped with the app. Updater-owned; treat as read-only."""
    return backend_root() / "shapefiles"


def user_shapefiles_dir() -> Path:
    """Writable GIS layer dir for user uploads.

    Users can upload/rename/delete GIS layers, but the bundled ``shapefiles/``
    tree is a versioned update component -- writing there would both fail on a
    read-only install and let an update destroy user-uploaded layers. So uploads
    land here and lookups search this dir first, then the bundled one.

    In a source checkout this returns the same ``backend/shapefiles`` used today.
    """
    if _writable_split_active():
        return user_data_root() / "shapefiles"
    return bundled_shapefiles_dir()


def config_path() -> Path:
    """Path to the writable ``config.json``.

    ``save_config``/``write_config`` mutate this at runtime (e.g. current_project),
    so in a packaged install it cannot live in the updater-owned install tree.
    On first use there it is seeded from the bundled default. Unchanged in a
    source checkout.
    """
    bundled = backend_root() / "config.json"
    if not _writable_split_active():
        return bundled

    user_config = user_data_root() / "config.json"
    if not user_config.exists():
        try:
            user_config.parent.mkdir(parents=True, exist_ok=True)
            if bundled.exists():
                user_config.write_bytes(bundled.read_bytes())
        except OSError:
            pass
    return user_config


def resolve_configured_dir(configured: str | None, default: Path) -> Path:
    """Resolve a config.json folder value.

    An **absolute** path in config.json is honoured as an explicit override.
    Legacy *relative* values (``"../data"``, ``"../in"``) are ignored in favour
    of ``default`` -- they encode the old repo-relative layout, which is wrong
    once the writable root moves out of the install directory.
    """
    if configured:
        candidate = Path(configured).expanduser()
        if candidate.is_absolute():
            return candidate
    return default


def ensure_user_dirs() -> None:
    """Create the writable tree if missing. Safe to call repeatedly."""
    for path in (profiles_dir(), projects_dir(), in_dir(), generated_reports_dir(),
                 user_shapefiles_dir()):
        try:
            path.mkdir(parents=True, exist_ok=True)
        except OSError:
            # Surface later at the point of use with a real error message rather
            # than preventing the app from starting.
            pass
