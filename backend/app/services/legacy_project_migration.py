from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path

import app.services.paths as paths


PROJECT_IMAGES_FOLDER = "images"
PROJECT_METADATA_FILENAME = "project_metadata.json"
DEFAULT_CONFIG = {
    "destination_folder": "../data",
    "in_folder": "../in",
}
_REGISTRY_BACKUP_DIRNAME = "_registry_backups"
_QUARTER_SUFFIX_RE = re.compile(r"(?:[_\-\s]*(?:[1-4]Q\d{2,4}|Q[1-4]\d{2,4}))$", re.IGNORECASE)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _backend_root() -> Path:
    return _repo_root() / "backend"


def _load_config() -> dict:
    config_path = _backend_root() / "config.json"
    if not config_path.exists():
        return dict(DEFAULT_CONFIG)

    try:
        with open(config_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception:
        return dict(DEFAULT_CONFIG)

    result = dict(DEFAULT_CONFIG)
    if isinstance(data, dict):
        result.update({k: v for k, v in data.items() if v is not None})
    return result


def _resolve_backend_relative(path_value: str) -> Path:
    raw_path = Path(str(path_value or ""))
    if raw_path.is_absolute():
        return raw_path.resolve()
    return (_backend_root() / raw_path).resolve()


def get_legacy_projects_root() -> Path:
    # Writable root -- follows services/paths.py so it stays outside the install
    # directory in a packaged build (unchanged in a source checkout).
    config = _load_config()
    return paths.resolve_configured_dir(config.get("destination_folder"), paths.projects_dir()).resolve()


def get_input_root() -> Path:
    config = _load_config()
    return paths.resolve_configured_dir(config.get("in_folder"), paths.in_dir()).resolve()


def bootstrap_profiles_storage(repo_root: Path | None = None, dry_run: bool = False) -> dict:
    # An explicit repo_root (tests, migration scripts) is still honoured; the
    # default follows the writable user-data root rather than the install tree.
    if repo_root is None:
        profiles_root = paths.profiles_dir().resolve()
        root = profiles_root.parent
    else:
        root = Path(repo_root).resolve()
        profiles_root = root / "profiles"
    registry_path = profiles_root / "profiles.json"
    backup_root = profiles_root / _REGISTRY_BACKUP_DIRNAME

    created_root = False
    created_registry = False
    blocked_registry_creation = False
    blocked_reason = None
    if not profiles_root.exists():
        created_root = True
        if not dry_run:
            profiles_root.mkdir(parents=True, exist_ok=True)

    if not registry_path.exists():
        existing_profile_dirs = [
            child.name
            for child in profiles_root.iterdir()
            if child.is_dir() and child.name not in {_REGISTRY_BACKUP_DIRNAME, "__pycache__"} and not child.name.startswith(".")
        ] if profiles_root.exists() else []
        has_backups = backup_root.exists() and any(candidate.suffix == ".json" for candidate in backup_root.iterdir())

        if existing_profile_dirs or has_backups:
            blocked_registry_creation = True
            reason_parts = []
            if existing_profile_dirs:
                detail = ", ".join(existing_profile_dirs[:8])
                if len(existing_profile_dirs) > 8:
                    detail += ", ..."
                reason_parts.append(f"existing profile directories: {detail}")
            if has_backups:
                reason_parts.append(f"existing registry backups under {backup_root}")
            blocked_reason = (
                "Refusing to bootstrap an empty profiles registry because local profile storage already exists ("
                + "; ".join(reason_parts)
                + ")."
            )
        else:
            created_registry = True
            if not dry_run:
                profiles_root.mkdir(parents=True, exist_ok=True)
                registry_path.write_text(json.dumps({"version": 1, "profiles": []}, indent=2) + "\n", encoding="utf-8")

    return {
        "profiles_root": str(profiles_root),
        "registry_path": str(registry_path),
        "created_root": created_root,
        "created_registry": created_registry,
        "blocked_registry_creation": blocked_registry_creation,
        "blocked_reason": blocked_reason,
    }


def _hash_file_sha256(file_path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with open(file_path, "rb") as handle:
        for chunk in iter(lambda: handle.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _next_backup_path(target_path: Path) -> Path:
    candidate = target_path.with_name(f"{target_path.name}.migration-backup")
    index = 2
    while candidate.exists():
        candidate = target_path.with_name(f"{target_path.name}.migration-backup-{index}")
        index += 1
    return candidate


def _replace_with_hardlink(source_path: Path, target_path: Path) -> tuple[bool, str | None]:
    backup_path = _next_backup_path(target_path)
    try:
        target_path.replace(backup_path)
    except OSError as exc:
        return False, str(exc)

    try:
        os.link(source_path, target_path)
    except OSError as exc:
        backup_path.replace(target_path)
        return False, str(exc)

    backup_path.unlink()
    return True, None


def _make_image_namespace(source_name: str) -> str:
    namespace = "".join(ch if ch.isalnum() else "_" for ch in str(source_name or "")).strip("_")
    return namespace or "source"


def _normalize_source_folder_key(source_name: str) -> str:
    cleaned = _QUARTER_SUFFIX_RE.sub("", str(source_name or "").strip())
    return "".join(ch for ch in cleaned.lower() if ch.isalnum())


def _build_source_folder_alias_map(in_root: Path) -> dict[str, str]:
    alias_map: dict[str, str] = {}
    if not in_root.exists() or not in_root.is_dir():
        return alias_map

    for child in in_root.iterdir():
        if not child.is_dir():
            continue
        alias_key = _normalize_source_folder_key(child.name)
        if not alias_key:
            continue
        alias_map.setdefault(alias_key, child.name)
    return alias_map


def _load_project_metadata(project_dir: Path) -> dict:
    metadata_path = project_dir / PROJECT_METADATA_FILENAME
    if not metadata_path.exists():
        return {}
    try:
        with open(metadata_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _get_project_source_folders(project_dir: Path) -> list[str]:
    metadata = _load_project_metadata(project_dir)
    raw_sources = metadata.get("source_folders") or []
    cleaned_sources: list[str] = []
    seen: set[str] = set()
    for source in raw_sources:
        source_name = str(source or "").strip()
        if not source_name or source_name in seen:
            continue
        cleaned_sources.append(source_name)
        seen.add(source_name)

    if cleaned_sources:
        return cleaned_sources

    dataset_name = str(metadata.get("dataset") or "").strip()
    if dataset_name and dataset_name != "MULTI_FOLDER_SELECTION":
        return [dataset_name]
    return []


def _strip_project_prefix(project_name: str, image_name: str) -> str:
    prefix = f"{project_name}_"
    if image_name.startswith(prefix):
        return image_name[len(prefix):]
    return image_name


def _resolve_source_image(
    project_name: str,
    image_name: str,
    source_folders: list[str],
    in_root: Path,
) -> tuple[Path | None, str | None]:
    if not source_folders:
        return None, "missing_source_folders"

    stripped_name = _strip_project_prefix(project_name, image_name)
    namespace_map = {_make_image_namespace(source).lower(): source for source in source_folders}

    alias_map = _build_source_folder_alias_map(in_root)

    def resolve_source_folder_name(source_folder_name: str) -> str | None:
        direct_candidate = in_root / source_folder_name
        if direct_candidate.is_dir():
            return source_folder_name
        return alias_map.get(_normalize_source_folder_key(source_folder_name))

    if "__" in stripped_name:
        namespace, original_name = stripped_name.split("__", 1)
        source_folder = namespace_map.get(namespace.lower())
        if source_folder:
            resolved_source_folder = resolve_source_folder_name(source_folder)
            if resolved_source_folder is None:
                return None, "missing_namespaced_source"
            candidate = in_root / resolved_source_folder / original_name
            if candidate.is_file():
                return candidate, None
        return None, "missing_namespaced_source"

    if len(source_folders) == 1:
        resolved_source_folder = resolve_source_folder_name(source_folders[0])
        if resolved_source_folder is None:
            return None, "missing_single_source"
        candidate = in_root / resolved_source_folder / stripped_name
        if candidate.is_file():
            return candidate, None
        return None, "missing_single_source"

    matches = []
    for source_folder in source_folders:
        resolved_source_folder = resolve_source_folder_name(source_folder)
        if resolved_source_folder is not None:
            matches.append(in_root / resolved_source_folder / stripped_name)
    existing = [candidate for candidate in matches if candidate.is_file()]
    if len(existing) == 1:
        return existing[0], None
    if len(existing) > 1:
        return None, "ambiguous_source"
    return None, "missing_multi_source"


def migrate_legacy_project_structure(
    *,
    legacy_root: Path | None = None,
    in_root: Path | None = None,
    project_names: list[str] | None = None,
    dry_run: bool = False,
    bootstrap_profiles: bool = True,
) -> dict:
    resolved_legacy_root = Path(legacy_root or get_legacy_projects_root()).resolve()
    resolved_in_root = Path(in_root or get_input_root()).resolve()

    summary = {
        "legacy_root": str(resolved_legacy_root),
        "in_root": str(resolved_in_root),
        "profiles_bootstrap": bootstrap_profiles_storage(dry_run=dry_run) if bootstrap_profiles else None,
        "dry_run": bool(dry_run),
        "scanned_projects": 0,
        "migrated_projects": 0,
        "scanned_files": 0,
        "relinked_files": 0,
        "already_linked": 0,
        "missing_projects": [],
        "skipped": [],
    }

    if not resolved_legacy_root.exists() or not resolved_legacy_root.is_dir():
        return summary

    requested_names = None
    if project_names is not None:
        requested_names = sorted({str(name or "").strip() for name in project_names if str(name or "").strip()})

    if requested_names is None:
        project_dirs = sorted((child for child in resolved_legacy_root.iterdir() if child.is_dir()), key=lambda path: path.name.lower())
    else:
        project_dirs = []
        for name in requested_names:
            project_dir = resolved_legacy_root / name
            if project_dir.is_dir():
                project_dirs.append(project_dir)
            else:
                summary["missing_projects"].append(name)

    summary["scanned_projects"] = len(project_dirs)

    for project_dir in project_dirs:
        project_name = project_dir.name
        images_dir = project_dir / PROJECT_IMAGES_FOLDER
        if not images_dir.is_dir():
            summary["skipped"].append({"project": project_name, "reason": "missing_images_dir"})
            continue

        source_folders = _get_project_source_folders(project_dir)
        project_relinked = 0

        for image_path in sorted((child for child in images_dir.iterdir() if child.is_file()), key=lambda path: path.name.lower()):
            summary["scanned_files"] += 1
            source_path, reason = _resolve_source_image(project_name, image_path.name, source_folders, resolved_in_root)
            if source_path is None:
                summary["skipped"].append({
                    "project": project_name,
                    "file": image_path.name,
                    "reason": reason,
                })
                continue

            try:
                if image_path.samefile(source_path):
                    summary["already_linked"] += 1
                    continue
            except OSError as exc:
                summary["skipped"].append({
                    "project": project_name,
                    "file": image_path.name,
                    "reason": str(exc),
                })
                continue

            try:
                if image_path.stat().st_size != source_path.stat().st_size:
                    summary["skipped"].append({
                        "project": project_name,
                        "file": image_path.name,
                        "reason": "source_size_mismatch",
                    })
                    continue
                if _hash_file_sha256(image_path) != _hash_file_sha256(source_path):
                    summary["skipped"].append({
                        "project": project_name,
                        "file": image_path.name,
                        "reason": "source_hash_mismatch",
                    })
                    continue
            except OSError as exc:
                summary["skipped"].append({
                    "project": project_name,
                    "file": image_path.name,
                    "reason": str(exc),
                })
                continue

            if dry_run:
                summary["relinked_files"] += 1
                project_relinked += 1
                continue

            relinked, relink_reason = _replace_with_hardlink(source_path, image_path)
            if relinked:
                summary["relinked_files"] += 1
                project_relinked += 1
            else:
                summary["skipped"].append({
                    "project": project_name,
                    "file": image_path.name,
                    "reason": str(relink_reason or "hardlink_failed"),
                })

        if project_relinked > 0:
            summary["migrated_projects"] += 1

    return summary