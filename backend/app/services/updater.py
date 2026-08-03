"""Remote update client: check a manifest, download only what changed, stage it.

Users have no Git and never visit a website to update. The app checks a manifest
published on a GitHub Release, compares it against what is installed, and downloads
only the components whose hash differs (a frontend fix is ~10 MB, not 9 GB).

This module only ever DOWNLOADS and STAGES. It never modifies the running
installation: files in use cannot be replaced by the process using them, so the
swap is done by the launcher before the app starts (see scripts/bundle/launch_psat.py).

Integrity is sha256 per part -- a truncated download is a likely failure, not a
hypothetical one. There is deliberately no signature checking: for an internal tool
where the same account controls both the source and the releases, key management
costs more than it buys (decision 2026-07-21).

State lives in two files under the install root:
    installed.json   what is currently installed  {component: sha256}
    pending/         staged download + apply plan, consumed by the launcher
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from app.services import paths, version

logger = logging.getLogger(__name__)

CHUNK = 1024 * 1024
NETWORK_TIMEOUT = 30
INSTALLED_STATE = "installed.json"
PENDING_DIR = "pending"
PENDING_PLAN = "plan.json"

# Where to look for releases. Overridable so a test/staging feed can be pointed at
# without a rebuild.
DEFAULT_MANIFEST_URL = os.environ.get(
    "PSAT_UPDATE_URL",
    "https://github.com/LinXH8/PathSafetyAssessmentTool/releases/latest/download/manifest.json",
)


@dataclass
class UpdateStatus:
    current_version: str
    available_version: str | None = None
    notes: str = ""
    components: list[str] = field(default_factory=list)
    download_bytes: int = 0
    error: str | None = None
    pending: bool = False

    def as_dict(self) -> dict:
        return {
            "currentVersion": self.current_version,
            "availableVersion": self.available_version,
            "updateAvailable": bool(self.available_version) and not self.pending,
            "pending": self.pending,
            "notes": self.notes,
            "components": self.components,
            "downloadBytes": self.download_bytes,
            "error": self.error,
        }


def install_root() -> Path:
    return paths.install_root()


def _installed_state_path() -> Path:
    return install_root() / INSTALLED_STATE


def _pending_dir() -> Path:
    return install_root() / PENDING_DIR


def read_installed_state() -> dict:
    try:
        return json.loads(_installed_state_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def write_installed_state(state: dict) -> None:
    try:
        _installed_state_path().write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    except OSError as exc:
        logger.warning("Could not record installed state: %s", exc)


def has_pending_update() -> bool:
    return (_pending_dir() / PENDING_PLAN).is_file()


def _fetch(url: str, timeout: int = NETWORK_TIMEOUT) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "PSAT-updater"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def _asset_url(manifest: dict, manifest_url: str, part_name: str) -> str:
    """Resolve a part name to a download URL.

    Prefers an explicit base_url in the manifest; otherwise assumes the parts sit
    beside manifest.json, which is how GitHub release assets are laid out.
    """
    base = (manifest.get("base_url") or "").strip()
    if base:
        return base.rstrip("/") + "/" + part_name
    return manifest_url.rsplit("/", 1)[0] + "/" + part_name


def fetch_manifest(manifest_url: str = DEFAULT_MANIFEST_URL) -> dict:
    data = json.loads(_fetch(manifest_url).decode("utf-8"))
    if data.get("schema") != 1:
        raise ValueError(f"Unsupported manifest schema: {data.get('schema')!r}")
    return data


# ── Component identity ────────────────────────────────────────────────────────
# A component's identity is a hash of its FILE TREE (sorted relative-path + each
# file's sha256), NOT a hash of the download zip. This is the whole fix for the
# "fresh install re-downloads everything" bug: a tree hash can be computed from
# the files a machine ALREADY HAS, so a machine can tell what version each part is
# on without any baseline file having been shipped or an update ever applied. The
# build (make_release.py) imports these same functions from the bundle it packages
# so the two sides can never compute a digest differently.

_BACKEND_EXCLUDE_TOP = {"models", "shapefiles"}


def component_source(name: str, base: Path) -> tuple[Path, set[str]]:
    """Map a component name to (directory, excluded top-level names) under `base`.

    `base` is the bundle root at build time and the install root at runtime, so the
    same mapping serves both. The backend component excludes models/ and shapefiles/
    because those ship as their own components.
    """
    if name == "webui":
        return base / "webui", set()
    if name == "backend":
        return base / "backend", set(_BACKEND_EXCLUDE_TOP)
    if name == "models":
        return base / "backend" / "models", set()
    if name == "python":
        return base / "python", set()
    if name == "launcher":
        # The bootstrapper that applies updates. Shipping it as its own component lets a
        # fix to the apply logic itself be delivered remotely. It is a standalone
        # top-level dir, so it is safe to replace wholesale even by an older launcher.
        return base / "launcher", set()
    if name.startswith("shp-"):
        return base / "backend" / "shapefiles" / name[len("shp-"):], set()
    return base / "__unknown_component__" / name, set()  # -> empty tree -> "changed"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(CHUNK), b""):
            digest.update(block)
    return digest.hexdigest()


def _iter_component_files(root: Path, exclude_top: set[str]):
    if not root.is_dir():
        return
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if rel.parts and rel.parts[0] in exclude_top:
            continue
        yield path, rel


def component_tree_digest(root: Path, exclude_top: set[str] | None = None) -> str:
    """sha256 over the sorted (relative-path, file-sha256) list of a directory."""
    exclude_top = exclude_top or set()
    entries = sorted(
        (rel.as_posix(), _sha256_file(path))
        for path, rel in _iter_component_files(root, exclude_top)
    )
    outer = hashlib.sha256()
    for rel, digest in entries:
        outer.update(rel.encode("utf-8"))
        outer.update(b"\0")
        outer.update(digest.encode("utf-8"))
        outer.update(b"\n")
    return outer.hexdigest()


def _component_fingerprint(root: Path, exclude_top: set[str]) -> list:
    """A cheap signature (file count, total bytes, newest mtime) used to skip the
    expensive content hash when nothing has changed since it was last computed."""
    count = 0
    total = 0
    latest = 0
    for path, _rel in _iter_component_files(root, exclude_top):
        try:
            st = path.stat()
        except OSError:
            continue
        count += 1
        total += st.st_size
        latest = max(latest, st.st_mtime_ns)
    return [count, total, latest]


def local_component_digest(name: str, cache: dict | None = None) -> str:
    """Tree digest of the component as INSTALLED, using installed.json as a cache.

    installed.json here is purely a cache: {component: {"digest": ..., "fp": [...]}}
    keyed by the cheap fingerprint. A cache hit avoids re-hashing gigabytes on every
    check; a miss (first check, or files changed by an update) recomputes and
    updates the cache. It is never required to exist and never trusted blindly.
    """
    root, exclude = component_source(name, install_root())
    fp = _component_fingerprint(root, exclude)
    store = read_installed_state() if cache is None else cache
    entry = store.get(name)
    if isinstance(entry, dict) and entry.get("fp") == fp and entry.get("digest"):
        return entry["digest"]
    digest = component_tree_digest(root, exclude)
    store[name] = {"digest": digest, "fp": fp}
    if cache is None:
        write_installed_state(store)
    return digest


def diff_components(manifest: dict, installed: dict | None = None) -> list[str]:
    """Component names whose installed file tree differs from the manifest."""
    cache = read_installed_state() if installed is None else installed
    changed = []
    for name, spec in (manifest.get("components") or {}).items():
        want = spec.get("digest")
        if not want:
            # Manifest built before tree digests existed; fall back to "changed"
            # rather than silently skipping (won't happen once make_release is updated).
            changed.append(name)
            continue
        if local_component_digest(name, cache) != want:
            changed.append(name)
    if installed is None:
        write_installed_state(cache)  # persist any freshly computed cache entries
    return sorted(changed)


def check_for_update(manifest_url: str = DEFAULT_MANIFEST_URL) -> UpdateStatus:
    """Non-blocking-friendly check. Never raises: offline is normal, not an error."""
    status = UpdateStatus(current_version=version.get_version())
    if has_pending_update():
        status.pending = True
        try:
            plan = json.loads((_pending_dir() / PENDING_PLAN).read_text(encoding="utf-8"))
            status.available_version = plan.get("app_version")
            status.notes = plan.get("notes", "")
        except (OSError, ValueError):
            pass
        return status

    try:
        manifest = fetch_manifest(manifest_url)
    except (urllib.error.URLError, OSError, ValueError) as exc:
        # Offline, proxied, or the feed does not exist yet. The app keeps working.
        status.error = f"Could not reach the update server: {exc}"
        return status

    changed = diff_components(manifest)
    if not changed:
        return status

    status.available_version = manifest.get("app_version")
    status.notes = manifest.get("notes", "")
    status.components = changed
    status.download_bytes = sum(
        manifest["components"][name].get("size", 0) for name in changed
    )
    return status


def _download_part(url: str, dest: Path, expected_sha: str, on_chunk=None) -> None:
    """Download to a .tmp then rename, so a partial file is never mistaken for done.

    on_chunk: optional callable(nbytes) invoked as each block lands, so the caller can
    report true byte-level progress across the whole download.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    digest = hashlib.sha256()
    request = urllib.request.Request(url, headers={"User-Agent": "PSAT-updater"})
    with urllib.request.urlopen(request, timeout=NETWORK_TIMEOUT) as response, open(tmp, "wb") as handle:
        while True:
            block = response.read(CHUNK)
            if not block:
                break
            handle.write(block)
            digest.update(block)
            if on_chunk:
                on_chunk(len(block))

    actual = digest.hexdigest()
    if actual != expected_sha:
        tmp.unlink(missing_ok=True)
        raise ValueError(
            f"Checksum mismatch for {dest.name}: expected {expected_sha[:12]}…, got {actual[:12]}…"
        )
    tmp.replace(dest)


def download_update(manifest_url: str = DEFAULT_MANIFEST_URL,
                    progress=None) -> UpdateStatus:
    """Download changed components into pending/. Does NOT apply them.

    progress: optional callable(component_name, done_bytes, total_bytes) reporting true
    byte-level progress across ALL components — so the UI bar tracks the whole download,
    not one part of one component (most components are a single part, which made a
    part-count bar read ~100% almost immediately).
    """
    status = UpdateStatus(current_version=version.get_version())
    try:
        manifest = fetch_manifest(manifest_url)
    except (urllib.error.URLError, OSError, ValueError) as exc:
        status.error = f"Could not reach the update server: {exc}"
        return status

    changed = diff_components(manifest)
    if not changed:
        return status

    pending = _pending_dir()
    if pending.exists():
        shutil.rmtree(pending, ignore_errors=True)
    pending.mkdir(parents=True, exist_ok=True)

    plan = {
        "app_version": manifest.get("app_version"),
        "notes": manifest.get("notes", ""),
        "components": {},
    }

    # Total is the sum of every changed component's compressed size; progress is the
    # running count of bytes actually written, reported as each block lands.
    total_bytes = sum(int(manifest["components"][n].get("size", 0)) for n in changed)
    downloaded = {"bytes": 0}

    try:
        for name in changed:
            spec = manifest["components"][name]
            parts = spec.get("parts", [])
            local_parts = []
            for index, part in enumerate(parts):
                url = _asset_url(manifest, manifest_url, part["name"])
                dest = pending / part["name"]
                logger.info("Downloading %s (%d/%d)", part["name"], index + 1, len(parts))

                def on_chunk(nbytes: int, _component: str = name) -> None:
                    downloaded["bytes"] += nbytes
                    if progress:
                        progress(_component, downloaded["bytes"], total_bytes)

                _download_part(url, dest, part["sha256"], on_chunk=on_chunk)
                local_parts.append(part["name"])
            plan["components"][name] = {
                "parts": local_parts,
                "digest": spec.get("digest"),  # the manifest's tree digest
            }
    except (urllib.error.URLError, OSError, ValueError) as exc:
        shutil.rmtree(pending, ignore_errors=True)
        status.error = f"Update download failed: {exc}"
        return status

    (pending / PENDING_PLAN).write_text(json.dumps(plan, indent=2) + "\n", encoding="utf-8")

    status.available_version = plan["app_version"]
    status.notes = plan["notes"]
    status.components = changed
    status.pending = True
    return status


def discard_pending() -> None:
    shutil.rmtree(_pending_dir(), ignore_errors=True)
