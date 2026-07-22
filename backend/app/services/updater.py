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


def diff_components(manifest: dict, installed: dict | None = None) -> list[str]:
    """Component names whose content differs from what is installed."""
    installed = read_installed_state() if installed is None else installed
    changed = []
    for name, spec in (manifest.get("components") or {}).items():
        want = _component_digest(spec)
        if installed.get(name) != want:
            changed.append(name)
    return sorted(changed)


def _component_digest(spec: dict) -> str:
    """Stable identity for a component: hash of its parts' hashes."""
    joined = "|".join(part.get("sha256", "") for part in spec.get("parts", []))
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


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


def _download_part(url: str, dest: Path, expected_sha: str) -> None:
    """Download to a .tmp then rename, so a partial file is never mistaken for done."""
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

    progress: optional callable(component_name, done_parts, total_parts).
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

    try:
        for name in changed:
            spec = manifest["components"][name]
            parts = spec.get("parts", [])
            local_parts = []
            for index, part in enumerate(parts):
                url = _asset_url(manifest, manifest_url, part["name"])
                dest = pending / part["name"]
                logger.info("Downloading %s (%d/%d)", part["name"], index + 1, len(parts))
                _download_part(url, dest, part["sha256"])
                local_parts.append(part["name"])
                if progress:
                    progress(name, index + 1, len(parts))
            plan["components"][name] = {
                "parts": local_parts,
                "digest": _component_digest(spec),
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
