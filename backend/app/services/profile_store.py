from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import threading
import unicodedata
from pathlib import Path

from app.services.cycleRAP_VA import get_full_path

_STATE_LOCK = threading.RLock()
_ACTIVE_PROFILE_ID: str | None = None
_PIN_RE = re.compile(r"^\d{4,12}$")
_LEGACY_DIVISION = "Unassigned"
_REGISTRY_BACKUP_DIRNAME = "_registry_backups"
_LATEST_REGISTRY_BACKUP_FILENAME = "profiles.latest.json"
_PROFILE_SUPPORT_DIRS = {_REGISTRY_BACKUP_DIRNAME, "__pycache__"}


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _profiles_root() -> Path:
    return _repo_root() / "profiles"


def _registry_path() -> Path:
    return _profiles_root() / "profiles.json"


def _registry_backups_root() -> Path:
    return _profiles_root() / _REGISTRY_BACKUP_DIRNAME


def _legacy_projects_root() -> Path:
    config_path = Path(get_full_path("config.json"))
    destination_folder = "../data"
    if config_path.exists():
        try:
            with open(config_path, "r", encoding="utf-8") as handle:
                config = json.load(handle)
            destination_folder = str(config.get("destination_folder") or destination_folder)
        except Exception:
            destination_folder = "../data"
    return Path(get_full_path(destination_folder)).resolve()


def _default_state() -> dict:
    return {"version": 1, "profiles": []}


def _normalize_state(state: dict) -> dict:
    if not isinstance(state, dict):
        raise ValueError("Profile registry is invalid")

    state.setdefault("version", 1)
    state.setdefault("profiles", [])
    for profile in state.get("profiles", []):
        profile["division"] = _clean_division(profile.get("division"), allow_default=True)
        profile.setdefault("last_active_at", None)
    return state


def _profile_storage_dirs() -> list[Path]:
    root = _profiles_root()
    if not root.exists():
        return []

    result: list[Path] = []
    for child in root.iterdir():
        if not child.is_dir():
            continue
        if child.name.startswith(".") or child.name in _PROFILE_SUPPORT_DIRS:
            continue
        result.append(child)
    return sorted(result, key=lambda item: item.name.lower())


def _read_state_file(file_path: Path) -> dict:
    with open(file_path, "r", encoding="utf-8") as handle:
        state = json.load(handle)
    return _normalize_state(state)


def _write_state_file(file_path: Path, state: dict) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = Path(str(file_path) + ".tmp")
    with open(temp_path, "w", encoding="utf-8") as handle:
        json.dump(state, handle, indent=2)
    temp_path.replace(file_path)


def _registry_backup_candidates() -> list[Path]:
    backups_root = _registry_backups_root()
    if not backups_root.exists():
        return []

    latest_path = backups_root / _LATEST_REGISTRY_BACKUP_FILENAME
    timestamped = sorted(
        [
            candidate
            for candidate in backups_root.glob("profiles.*.json")
            if candidate.name != _LATEST_REGISTRY_BACKUP_FILENAME
        ],
        reverse=True,
    )

    candidates: list[Path] = []
    if latest_path.exists():
        candidates.append(latest_path)
    candidates.extend(timestamped)
    return candidates


def _load_backup_state(*, require_profiles: bool = False) -> tuple[dict | None, Path | None]:
    for candidate in _registry_backup_candidates():
        try:
            state = _read_state_file(candidate)
        except Exception:
            continue
        if require_profiles and not state.get("profiles"):
            continue
        return state, candidate
    return None, None


def _profile_registry_guard_message(reason: str, profile_dirs: list[Path]) -> str:
    detail = ", ".join(path.name for path in profile_dirs[:8])
    if len(profile_dirs) > 8:
        detail += ", ..."
    locations = [str(_registry_path())]
    latest_backup = _registry_backups_root() / _LATEST_REGISTRY_BACKUP_FILENAME
    locations.append(str(latest_backup))
    return (
        f"Profile registry {reason} while local profile directories still exist"
        + (f": {detail}" if detail else "")
        + ". Refusing to initialize empty local state. Inspect or restore one of: "
        + ", ".join(locations)
    )


def _restore_registry_from_backup(state: dict, backup_path: Path, reason: str) -> dict:
    print(f"[Profiles] Restoring registry from backup '{backup_path}' ({reason}).", flush=True)
    _write_state_file(_registry_path(), state)
    _write_state_file(_registry_backups_root() / _LATEST_REGISTRY_BACKUP_FILENAME, state)
    return state


def _clean_division(division: str | None, *, allow_default: bool = False) -> str:
    clean_division = " ".join(str(division or "").split())
    if clean_division:
        return clean_division
    if allow_default:
        return _LEGACY_DIVISION
    raise ValueError("Division is required")


def _clean_profile_name(name: str | None) -> str:
    clean_name = " ".join(str(name or "").split())
    if clean_name:
        return clean_name
    raise ValueError("Profile name is required")


def _ensure_unique_profile_name(
    profiles: list[dict],
    name: str,
    *,
    exclude_profile_id: str | None = None,
) -> None:
    normalized_name = name.casefold()
    for profile in profiles:
        if exclude_profile_id and str(profile.get("id") or "") == exclude_profile_id:
            continue
        if str(profile.get("name") or "").casefold() == normalized_name:
            raise ValueError("A profile with that name already exists")


def _ensure_root() -> None:
    _profiles_root().mkdir(parents=True, exist_ok=True)


def _load_state() -> dict:
    _ensure_root()
    registry_path = _registry_path()
    profile_dirs = _profile_storage_dirs()

    if not registry_path.exists():
        backup_state, backup_path = _load_backup_state(require_profiles=bool(profile_dirs))
        if backup_state is not None and backup_path is not None:
            return _restore_registry_from_backup(backup_state, backup_path, "registry file missing")
        if profile_dirs:
            raise RuntimeError(_profile_registry_guard_message("is missing", profile_dirs))
        state = _default_state()
        _save_state(state)
        return state

    try:
        state = _read_state_file(registry_path)
    except Exception as exc:
        backup_state, backup_path = _load_backup_state(require_profiles=bool(profile_dirs))
        if backup_state is not None and backup_path is not None:
            return _restore_registry_from_backup(backup_state, backup_path, "registry file invalid")
        raise ValueError("Profile registry is invalid") from exc

    if not state.get("profiles") and profile_dirs:
        backup_state, backup_path = _load_backup_state(require_profiles=True)
        if backup_state is not None and backup_path is not None:
            return _restore_registry_from_backup(backup_state, backup_path, "registry file empty")
        raise RuntimeError(_profile_registry_guard_message("is empty", profile_dirs))

    return state


def _save_state(state: dict) -> None:
    _ensure_root()
    state = _normalize_state(state)
    registry_path = _registry_path()
    backups_root = _registry_backups_root()
    backups_root.mkdir(parents=True, exist_ok=True)

    if registry_path.exists():
        timestamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        archive_path = backups_root / f"profiles.{timestamp}.json"
        shutil.copy2(registry_path, archive_path)

    _write_state_file(registry_path, state)
    _write_state_file(backups_root / _LATEST_REGISTRY_BACKUP_FILENAME, state)


def _slugify(name: str) -> str:
    normalized = unicodedata.normalize("NFKD", name)
    ascii_name = normalized.encode("ascii", "ignore").decode("ascii")
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_name).strip("-").lower()
    return cleaned or "profile"


def _make_unique_slug(name: str, profiles: list[dict]) -> str:
    base = _slugify(name)
    existing = {str(profile.get("slug") or "") for profile in profiles}
    candidate = base
    index = 2
    while candidate in existing:
        candidate = f"{base}-{index}"
        index += 1
    return candidate


def _hash_pin(pin: str, salt_hex: str | None = None) -> tuple[str, str]:
    salt = bytes.fromhex(salt_hex) if salt_hex else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt, 200_000)
    return digest.hex(), salt.hex()


def _verify_pin(profile: dict, pin: str) -> bool:
    expected = str(profile.get("pin_hash") or "")
    salt_hex = str(profile.get("pin_salt") or "")
    if not expected or not salt_hex:
        return False
    actual, _ = _hash_pin(pin, salt_hex)
    return hmac.compare_digest(expected, actual)


def _project_root_for_slug(slug: str) -> Path:
    return _profiles_root() / slug / "projects"


def _ensure_profile_project_root(profile: dict) -> Path:
    project_root = _project_root_for_slug(str(profile.get("slug") or ""))
    project_root.mkdir(parents=True, exist_ok=True)
    return project_root


def _count_projects(profile: dict) -> int:
    project_root = _project_root_for_slug(str(profile.get("slug") or ""))
    if not project_root.exists():
        return 0
    return sum(1 for child in project_root.iterdir() if child.is_dir())


def _serialize_profile(profile: dict) -> dict:
    return {
        "id": str(profile.get("id") or ""),
        "name": str(profile.get("name") or ""),
        "slug": str(profile.get("slug") or ""),
        "division": _clean_division(profile.get("division"), allow_default=True),
        "created_at": str(profile.get("created_at") or ""),
        "last_active_at": str(profile.get("last_active_at") or "") or None,
        "project_count": _count_projects(profile),
        "has_pin": True,
    }


def _find_profile(state: dict, profile_id: str) -> dict | None:
    for profile in state.get("profiles", []):
        if str(profile.get("id") or "") == profile_id:
            return profile
    return None


def _require_profile(state: dict, profile_id: str) -> dict:
    profile = _find_profile(state, profile_id)
    if profile is None:
        raise ValueError("Profile not found")
    return profile


def list_profiles() -> list[dict]:
    with _STATE_LOCK:
        state = _load_state()
        profiles = [_serialize_profile(profile) for profile in state.get("profiles", [])]
    return sorted(profiles, key=lambda profile: profile["name"].lower())


def list_legacy_projects() -> list[str]:
    legacy_root = _legacy_projects_root()
    if not legacy_root.exists():
        return []
    return sorted(child.name for child in legacy_root.iterdir() if child.is_dir())


def create_profile(name: str, pin: str, division: str) -> dict:
    clean_name = _clean_profile_name(name)
    if not _PIN_RE.fullmatch(str(pin or "")):
        raise ValueError("PIN must be 4 to 12 digits")
    clean_division = _clean_division(division)

    with _STATE_LOCK:
        state = _load_state()
        _ensure_unique_profile_name(state.get("profiles", []), clean_name)

        pin_hash, pin_salt = _hash_pin(pin)
        profile = {
            "id": secrets.token_hex(8),
            "name": clean_name,
            "slug": _make_unique_slug(clean_name, state.get("profiles", [])),
            "division": clean_division,
            "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "last_active_at": None,
            "pin_hash": pin_hash,
            "pin_salt": pin_salt,
        }
        state.setdefault("profiles", []).append(profile)
        _save_state(state)
        _ensure_profile_project_root(profile)
        return _serialize_profile(profile)


def get_active_profile_id() -> str | None:
    return _ACTIVE_PROFILE_ID


def get_active_profile() -> dict | None:
    profile_id = get_active_profile_id()
    if profile_id is None:
        return None
    with _STATE_LOCK:
        state = _load_state()
        profile = _find_profile(state, profile_id)
        if profile is None:
            return None
        return _serialize_profile(profile)


def login_profile(profile_id: str, pin: str) -> dict:
    global _ACTIVE_PROFILE_ID

    if not _PIN_RE.fullmatch(str(pin or "")):
        raise PermissionError("Invalid PIN")

    with _STATE_LOCK:
        state = _load_state()
        profile = _require_profile(state, str(profile_id or ""))
        if not _verify_pin(profile, pin):
            raise PermissionError("Invalid PIN")
        _ensure_profile_project_root(profile)
        profile["last_active_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
        _save_state(state)
        _ACTIVE_PROFILE_ID = str(profile.get("id") or "")
        return _serialize_profile(profile)


def logout_profile() -> None:
    global _ACTIVE_PROFILE_ID
    _ACTIVE_PROFILE_ID = None


def get_profile_projects_root(profile_id: str) -> Path:
    with _STATE_LOCK:
        state = _load_state()
        profile = _require_profile(state, profile_id)
        return _ensure_profile_project_root(profile)


def touch_profile_activity(profile_id: str, when: dt.datetime | str | None = None) -> dict:
    with _STATE_LOCK:
        state = _load_state()
        profile = _require_profile(state, str(profile_id or ""))
        if when is None:
            timestamp = dt.datetime.now(dt.timezone.utc).isoformat()
        elif isinstance(when, dt.datetime):
            timestamp = when.astimezone(dt.timezone.utc).isoformat() if when.tzinfo else when.replace(tzinfo=dt.timezone.utc).isoformat()
        else:
            timestamp = str(when)
        profile["last_active_at"] = timestamp
        _save_state(state)
        return _serialize_profile(profile)


def update_profile(profile_id: str, current_pin: str, name: str, division: str) -> dict:
    clean_name = _clean_profile_name(name)
    clean_division = _clean_division(division)

    with _STATE_LOCK:
        state = _load_state()
        profile = _require_profile(state, str(profile_id or ""))
        if not _verify_pin(profile, current_pin):
            raise PermissionError("Invalid current PIN")

        _ensure_unique_profile_name(
            state.get("profiles", []),
            clean_name,
            exclude_profile_id=str(profile.get("id") or ""),
        )
        profile["name"] = clean_name
        profile["division"] = clean_division
        _save_state(state)
        return _serialize_profile(profile)


def reset_profile_pin(profile_id: str, current_pin: str, new_pin: str) -> dict:
    if not _PIN_RE.fullmatch(str(new_pin or "")):
        raise ValueError("PIN must be 4 to 12 digits")

    with _STATE_LOCK:
        state = _load_state()
        profile = _require_profile(state, str(profile_id or ""))
        if not _verify_pin(profile, current_pin):
            raise PermissionError("Invalid current PIN")

        pin_hash, pin_salt = _hash_pin(new_pin)
        profile["pin_hash"] = pin_hash
        profile["pin_salt"] = pin_salt
        _save_state(state)
        return _serialize_profile(profile)


def get_legacy_projects_root() -> Path:
    return _legacy_projects_root()


def move_legacy_projects_to_profile(profile_id: str, project_names: list[str] | None = None) -> dict:
    with _STATE_LOCK:
        state = _load_state()
        profile = _require_profile(state, profile_id)
        destination_root = _ensure_profile_project_root(profile)
        legacy_root = _legacy_projects_root()

        requested_names = None
        if project_names is not None:
            requested_names = {str(name or "").strip() for name in project_names if str(name or "").strip()}

        moved: list[str] = []
        skipped: list[dict[str, str]] = []
        missing: list[str] = []

        if requested_names and not legacy_root.exists():
            return {"moved": moved, "skipped": skipped, "missing": sorted(requested_names)}
        if not legacy_root.exists():
            return {"moved": moved, "skipped": skipped, "missing": missing}

        available = {child.name: child for child in legacy_root.iterdir() if child.is_dir()}
        selected_names = sorted(requested_names) if requested_names is not None else sorted(available)

        for project_name in selected_names:
            source = available.get(project_name)
            if source is None:
                missing.append(project_name)
                continue
            destination = destination_root / project_name
            if destination.exists():
                skipped.append({"name": project_name, "reason": "already_exists"})
                continue
            shutil.move(str(source), str(destination))
            moved.append(project_name)

        return {"moved": moved, "skipped": skipped, "missing": missing}


def _copy_or_link(src: str, dst: str) -> None:
    """Hardlink files when possible (same volume) to avoid duplicating large image
    folders, falling back to a full copy across volumes or when linking is unsupported."""
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def share_projects_to_profile(
    target_profile_id: str,
    project_names: list[str],
    source_profile_id: str | None = None,
) -> dict:
    """Copy projects from a source profile (the active profile by default) into a target
    profile's project area, leaving the originals untouched."""
    with _STATE_LOCK:
        state = _load_state()
        target = _require_profile(state, str(target_profile_id or ""))

        resolved_source_id = str(source_profile_id or get_active_profile_id() or "")
        if not resolved_source_id:
            raise ValueError("A source profile must be active before sharing projects")
        if resolved_source_id == str(target.get("id") or ""):
            raise ValueError("Cannot share a project to the profile it already belongs to")

        source = _require_profile(state, resolved_source_id)
        source_root = _ensure_profile_project_root(source)
        destination_root = _ensure_profile_project_root(target)

        requested_names = [str(name or "").strip() for name in project_names if str(name or "").strip()]

        shared: list[str] = []
        skipped: list[dict[str, str]] = []
        missing: list[str] = []

        for project_name in requested_names:
            source_dir = source_root / project_name
            if not source_dir.is_dir():
                missing.append(project_name)
                continue
            destination = destination_root / project_name
            if destination.exists():
                skipped.append({"name": project_name, "reason": "already_exists"})
                continue
            shutil.copytree(source_dir, destination, copy_function=_copy_or_link)
            shared.append(project_name)

        return {"shared": shared, "skipped": skipped, "missing": missing}


def delete_profile(profile_id: str, pin: str) -> None:
    global _ACTIVE_PROFILE_ID

    with _STATE_LOCK:
        state = _load_state()
        profile = _require_profile(state, str(profile_id or ""))
        if not _verify_pin(profile, pin):
            raise PermissionError("Invalid PIN")

        slug = str(profile.get("slug") or "")
        state["profiles"] = [p for p in state.get("profiles", []) if str(p.get("id") or "") != profile_id]
        _save_state(state)

        if _ACTIVE_PROFILE_ID == profile_id:
            _ACTIVE_PROFILE_ID = None

        profile_dir = _profiles_root() / slug
        if profile_dir.exists() and profile_dir.is_dir():
            shutil.rmtree(profile_dir)


def get_overview() -> dict:
    return {
        "profiles": list_profiles(),
        "active_profile": get_active_profile(),
        "legacy_projects": list_legacy_projects(),
    }