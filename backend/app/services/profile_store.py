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
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
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


def _active_state_path() -> Path:
    return _profiles_root() / "active_profile.json"


def _read_persisted_active_id() -> str | None:
    """Read the persisted active profile id from disk.

    The active profile must survive Flask's auto-reloader (use_reloader=True),
    which resets all in-memory module globals on every .py change. Persisting it
    to disk means the next request after a reload still resolves the correct
    profile-projects root instead of falling back to the empty legacy directory.
    """
    path = _active_state_path()
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        active_id = str(data.get("active_profile_id") or "").strip()
        return active_id or None
    except Exception:
        return None


def _write_persisted_active_id(active_id: str | None) -> None:
    path = _active_state_path()
    try:
        if not active_id:
            if path.exists():
                path.unlink()
            return
        _write_state_file(path, {"active_profile_id": active_id})
    except Exception as exc:
        print(f"[Profiles] Failed to persist active profile id: {exc}", flush=True)


def _set_active_profile_id(active_id: str | None) -> None:
    """Set the active profile both in memory and on disk."""
    global _ACTIVE_PROFILE_ID
    _ACTIVE_PROFILE_ID = active_id or None
    _write_persisted_active_id(_ACTIVE_PROFILE_ID)


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
        # Backward-compat: legacy profiles stored a single "name" field that held
        # the LTA email and doubled as the display label. Split it into a public
        # username + a private recovery email so existing accounts keep working
        # and immediately gain PIN recovery (both seeded from the old name).
        legacy_name = str(profile.get("name") or "").strip()
        if not str(profile.get("username") or "").strip():
            profile["username"] = legacy_name
        if not str(profile.get("email") or "").strip():
            profile["email"] = legacy_name
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
    raise ValueError("Username is required")


def _clean_email(email: str | None, *, required: bool = True) -> str:
    clean_email = str(email or "").strip()
    if not clean_email:
        if required:
            raise ValueError("Email is required")
        return ""
    if not _EMAIL_RE.fullmatch(clean_email):
        raise ValueError("Enter a valid email address")
    return clean_email


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


def _verify_email(profile: dict, email: str) -> bool:
    expected = str(profile.get("email") or "").strip().casefold()
    actual = str(email or "").strip().casefold()
    if not expected:
        return False
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
    username = str(profile.get("username") or profile.get("name") or "")
    return {
        "id": str(profile.get("id") or ""),
        # `name` mirrors `username` for backward compatibility with older clients.
        "name": str(profile.get("name") or username),
        "username": username,
        "slug": str(profile.get("slug") or ""),
        "division": _clean_division(profile.get("division"), allow_default=True),
        "created_at": str(profile.get("created_at") or ""),
        "last_active_at": str(profile.get("last_active_at") or "") or None,
        "project_count": _count_projects(profile),
        "has_pin": True,
        # The recovery email itself stays private (never serialized); we only
        # expose whether one is on file so the UI can offer PIN recovery.
        "has_email": bool(str(profile.get("email") or "").strip()),
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


def _serialize_profiles_from_state(state: dict) -> list[dict]:
    """Serialize + sort every profile in an already-loaded state.

    Split out so callers that already hold `state` (e.g. `get_overview`) don't
    re-read the registry from disk.
    """
    profiles = [_serialize_profile(profile) for profile in state.get("profiles", [])]
    return sorted(profiles, key=lambda profile: profile["name"].lower())


def list_profiles() -> list[dict]:
    with _STATE_LOCK:
        return _serialize_profiles_from_state(_load_state())


def list_legacy_projects() -> list[str]:
    legacy_root = _legacy_projects_root()
    if not legacy_root.exists():
        return []
    return sorted(child.name for child in legacy_root.iterdir() if child.is_dir())


def create_profile(username: str, email: str, pin: str, division: str) -> dict:
    clean_name = _clean_profile_name(username)
    clean_email = _clean_email(email)
    if not _PIN_RE.fullmatch(str(pin or "")):
        raise ValueError("PIN must be 4 to 12 digits")
    clean_division = _clean_division(division)

    with _STATE_LOCK:
        state = _load_state()
        _ensure_unique_profile_name(state.get("profiles", []), clean_name)

        pin_hash, pin_salt = _hash_pin(pin)
        profile = {
            "id": secrets.token_hex(8),
            # `name` mirrors `username` so older clients keep working.
            "name": clean_name,
            "username": clean_name,
            "email": clean_email,
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


def _adopt_persisted_active_id(state: dict, persisted: str) -> str | None:
    """Validate a disk-persisted active id against an already-loaded `state`.

    Caches it in memory when it names a real profile, or clears it (memory +
    disk) when the profile is gone. Caller must hold `_STATE_LOCK`.
    """
    global _ACTIVE_PROFILE_ID
    if _find_profile(state, persisted) is None:
        _write_persisted_active_id(None)
        return None
    _ACTIVE_PROFILE_ID = persisted
    return _ACTIVE_PROFILE_ID


def _resolve_active_id(state: dict) -> str | None:
    """Return the active profile id, restoring from disk against `state` when the
    in-memory global was reset (fresh process / Flask reload). Caller must hold
    `_STATE_LOCK`."""
    if _ACTIVE_PROFILE_ID is not None:
        return _ACTIVE_PROFILE_ID
    persisted = _read_persisted_active_id()
    if not persisted:
        return None
    return _adopt_persisted_active_id(state, persisted)


def get_active_profile_id() -> str | None:
    if _ACTIVE_PROFILE_ID is not None:
        return _ACTIVE_PROFILE_ID

    # In-memory global was reset (fresh process / Flask reload). Only pay for a
    # registry read when there is a persisted id to validate.
    persisted = _read_persisted_active_id()
    if not persisted:
        return None

    with _STATE_LOCK:
        return _adopt_persisted_active_id(_load_state(), persisted)


def _active_profile_from_state(state: dict) -> dict | None:
    """Serialize the active profile from an already-loaded `state` (no extra read)."""
    profile_id = _resolve_active_id(state)
    if profile_id is None:
        return None
    profile = _find_profile(state, profile_id)
    return _serialize_profile(profile) if profile is not None else None


def get_active_profile() -> dict | None:
    with _STATE_LOCK:
        return _active_profile_from_state(_load_state())


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
        _set_active_profile_id(str(profile.get("id") or ""))
        return _serialize_profile(profile)


def logout_profile() -> None:
    _set_active_profile_id(None)


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


def update_profile(
    profile_id: str,
    current_pin: str,
    username: str,
    division: str,
    email: str | None = None,
) -> dict:
    clean_name = _clean_profile_name(username)
    clean_division = _clean_division(division)
    # `email` is optional on update: omit (None) to leave the recovery email
    # untouched; pass a non-empty value to change it (validated for format).
    clean_email = _clean_email(email, required=False) if email is not None else None

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
        profile["username"] = clean_name
        profile["division"] = clean_division
        if clean_email:
            profile["email"] = clean_email
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


def recover_profile_pin(profile_id: str, email: str, new_pin: str) -> dict:
    """Reset a forgotten PIN after verifying the profile's private recovery email.

    Unlike ``reset_profile_pin`` (which requires the current PIN), this proves
    identity via the registered private email, then sets a new PIN directly.
    """
    if not _PIN_RE.fullmatch(str(new_pin or "")):
        raise ValueError("PIN must be 4 to 12 digits")

    with _STATE_LOCK:
        state = _load_state()
        profile = _require_profile(state, str(profile_id or ""))
        if not _verify_email(profile, email):
            raise PermissionError("Email does not match the one on record")

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
            _set_active_profile_id(None)

        profile_dir = _profiles_root() / slug
        if profile_dir.exists() and profile_dir.is_dir():
            shutil.rmtree(profile_dir)


def get_overview() -> dict:
    # Load the registry once and derive both the profile list and the active
    # profile from it, instead of each accessor re-reading + re-parsing the file.
    with _STATE_LOCK:
        state = _load_state()
        profiles = _serialize_profiles_from_state(state)
        active_profile = _active_profile_from_state(state)
    # `list_legacy_projects` scans a different directory (no registry read), so it
    # stays outside the lock to keep the critical section small.
    return {
        "profiles": profiles,
        "active_profile": active_profile,
        "legacy_projects": list_legacy_projects(),
    }