"""Profiles that ship WITH the app and are installed on first launch.

Some datasets are produced centrally and every install should have them -- the
islandwide autocoded survey, for example. They cannot simply live in the user-data
root, because that root is per-machine and is never touched by the updater. So they
ship inside the *install* tree (``backend/seed_profiles/``, an update component of
its own) and are copied out into the user-data root the first time an install runs.

Layout of one seed:

    backend/seed_profiles/<slug>/
        profile.json                     <- id, name, email, division, pin, seed_version
        projects/<Project Name>/...      <- copied verbatim into the user's profile

Seeding is deliberately conservative:

* It runs once per (slug, seed_version), recorded in ``<profiles>/.seeded.json``.
  A user who deletes a seeded profile does NOT get it silently resurrected on the
  next launch -- only a bumped ``seed_version`` re-seeds.
* A project directory that already exists is left alone. The shipped copy is a
  starting point; anything the user has since coded or treated wins.
* Every failure is logged and swallowed. A missing seed must never stop the app
  from starting.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
from pathlib import Path

import app.services.paths as paths
from app.services import profile_store

logger = logging.getLogger(__name__)

_SEED_DIRNAME = "seed_profiles"
_STATE_FILENAME = ".seeded.json"
_DESCRIPTOR_FILENAME = "profile.json"


def seed_profiles_root() -> Path:
    """Where the shipped seeds live. Install-owned; treat as read-only."""
    return paths.backend_root() / _SEED_DIRNAME


def _state_path() -> Path:
    return paths.profiles_dir() / _STATE_FILENAME


def _read_state() -> dict:
    path = _state_path()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_state(state: dict) -> None:
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    temp_path.replace(path)


def _read_descriptor(seed_dir: Path) -> dict | None:
    descriptor_path = seed_dir / _DESCRIPTOR_FILENAME
    try:
        descriptor = json.loads(descriptor_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        logger.warning("Seed profile %s has no usable %s (%s)",
                       seed_dir.name, _DESCRIPTOR_FILENAME, exc)
        return None
    return descriptor if isinstance(descriptor, dict) else None


def _copy_projects(seed_dir: Path, destination_root: Path) -> list[str]:
    """Copy each shipped project that the profile does not already have."""
    source_root = seed_dir / "projects"
    if not source_root.is_dir():
        return []

    destination_root.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    for source in sorted(source_root.iterdir()):
        if not source.is_dir():
            continue
        destination = destination_root / source.name
        if destination.exists():
            logger.info("Seed project '%s' already present; leaving it untouched",
                        source.name)
            continue
        # Copy to a temp sibling first so an interrupted copy can never look like a
        # complete project (project discovery only sees the final name).
        staging = destination_root / f".{source.name}.incoming"
        shutil.rmtree(staging, ignore_errors=True)
        shutil.copytree(source, staging)
        staging.replace(destination)
        copied.append(source.name)
    return copied


def _seed_one(seed_dir: Path, state: dict) -> bool:
    """Install one seed. Returns True when `state` was modified."""
    descriptor = _read_descriptor(seed_dir)
    if descriptor is None:
        return False

    slug = str(descriptor.get("slug") or seed_dir.name)
    seed_version = int(descriptor.get("seed_version") or 1)
    recorded = state.get(slug)
    if isinstance(recorded, dict) and int(recorded.get("seed_version") or 0) >= seed_version:
        return False

    name = str(descriptor.get("username") or descriptor.get("name") or "").strip()
    profile, created = profile_store.register_seeded_profile(
        profile_id=str(descriptor.get("id") or ""),
        username=name,
        email=str(descriptor.get("email") or ""),
        pin=str(descriptor.get("pin") or ""),
        division=str(descriptor.get("division") or ""),
        slug=slug,
    )

    projects_root = profile_store.profile_projects_root_for_slug(str(profile.get("slug") or slug))
    copied = _copy_projects(seed_dir, projects_root)

    state[slug] = {"seed_version": seed_version, "profile_id": profile.get("id")}
    logger.info(
        "Seed profile '%s' %s (%d project(s) copied)",
        profile.get("name"), "created" if created else "already registered", len(copied),
    )
    return True


def ensure_seed_profiles() -> None:
    """Install any shipped profile this machine has not seeded yet. Never raises."""
    # Escape hatch for the build scripts, whose verification step calls create_app()
    # on the build machine -- there is no reason to copy hundreds of MB of survey
    # data into the builder's app-data dir just to prove the app imports.
    if os.environ.get("PSAT_SKIP_SEED_PROFILES") == "1":
        return

    root = seed_profiles_root()
    if not root.is_dir():
        return

    try:
        state = _read_state()
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Could not read seed state: %s", exc)
        return

    dirty = False
    for seed_dir in sorted(root.iterdir()):
        if not seed_dir.is_dir() or seed_dir.name.startswith("."):
            continue
        try:
            dirty = _seed_one(seed_dir, state) or dirty
        except Exception as exc:
            logger.warning("Could not install seed profile '%s': %s", seed_dir.name, exc)

    if dirty:
        try:
            _write_state(state)
        except OSError as exc:
            logger.warning("Could not persist seed state: %s", exc)
