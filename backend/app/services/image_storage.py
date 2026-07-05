"""Image materialization and cross-project deduplication helpers.

Extracted from ``project_manager`` (S3.6). The public functions
``materialize_project_image`` and ``deduplicate_project_images`` are re-exported
from ``app.services.project_manager`` to keep the historical import path stable.

NOTE: ``os`` is imported here and used for ``os.link``. Tests monkeypatch
``app.services.project_manager.os.link``; because ``os`` is a process-wide
singleton module object, that patch also affects the ``os.link`` calls made in
this module.
"""
from __future__ import annotations
import os
import shutil
import hashlib
import app.services.global_var as global_var
from pathlib import Path


def materialize_project_image(source_img_path: Path, target_img_path: Path) -> str:
    """Create a project-local image entry without duplicating bytes when possible.

    Prefer a hard link so projects can keep their own stable image names while
    sharing the underlying file data with the source folder. Fall back to a
    normal copy if the filesystem does not allow linking (for example, cross-
    volume moves).
    """
    target_img_path.parent.mkdir(parents=True, exist_ok=True)

    if target_img_path.exists():
        if target_img_path.is_file():
            target_img_path.unlink()
        else:
            raise IsADirectoryError(f"Target image path is not a file: {target_img_path}")

    try:
        os.link(source_img_path, target_img_path)
        return "hardlink"
    except OSError:
        shutil.copy2(source_img_path, target_img_path)
        return "copy"


def _hash_file_sha256(file_path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with open(file_path, "rb") as handle:
        for chunk in iter(lambda: handle.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _next_dedupe_backup_path(target_path: Path) -> Path:
    candidate = target_path.with_name(f"{target_path.name}.dedupe-backup")
    index = 2
    while candidate.exists():
        candidate = target_path.with_name(f"{target_path.name}.dedupe-backup-{index}")
        index += 1
    return candidate


def _replace_with_hardlink(canonical_path: Path, duplicate_path: Path) -> tuple[bool, str | None]:
    backup_path = _next_dedupe_backup_path(duplicate_path)

    try:
        duplicate_path.replace(backup_path)
    except OSError as exc:
        return False, str(exc)

    try:
        os.link(canonical_path, duplicate_path)
    except OSError as exc:
        backup_path.replace(duplicate_path)
        return False, str(exc)

    backup_path.unlink()
    return True, None


def deduplicate_project_images(projects_root: Path, project_names: list[str] | None = None) -> dict:
    root = Path(projects_root).resolve()
    summary = {
        "root": str(root),
        "scanned_projects": 0,
        "scanned_files": 0,
        "duplicates_found": 0,
        "deduplicated_files": 0,
        "already_linked": 0,
        "bytes_reclaimed": 0,
        "missing_projects": [],
        "skipped": [],
    }

    if not root.exists() or not root.is_dir():
        return summary

    requested_names = None
    if project_names is not None:
        requested_names = sorted({str(name or "").strip() for name in project_names if str(name or "").strip()})

    if requested_names is None:
        project_dirs = sorted((child for child in root.iterdir() if child.is_dir()), key=lambda path: path.name.lower())
    else:
        project_dirs = []
        for name in requested_names:
            project_dir = root / name
            if project_dir.is_dir():
                project_dirs.append(project_dir)
            else:
                summary["missing_projects"].append(name)

    summary["scanned_projects"] = len(project_dirs)
    canonical_by_fingerprint: dict[tuple[int, str], Path] = {}

    for project_dir in project_dirs:
        images_dir = project_dir / global_var.PROJECT_IMAGES_FOLDER
        if not images_dir.is_dir():
            continue

        for image_path in sorted((child for child in images_dir.iterdir() if child.is_file()), key=lambda path: path.name.lower()):
            try:
                size = image_path.stat().st_size
                fingerprint = (size, _hash_file_sha256(image_path))
            except OSError as exc:
                summary["skipped"].append({
                    "project": project_dir.name,
                    "file": image_path.name,
                    "reason": str(exc),
                })
                continue

            summary["scanned_files"] += 1
            canonical_path = canonical_by_fingerprint.get(fingerprint)
            if canonical_path is None:
                canonical_by_fingerprint[fingerprint] = image_path
                continue

            summary["duplicates_found"] += 1
            try:
                if image_path.samefile(canonical_path):
                    summary["already_linked"] += 1
                    continue
            except OSError as exc:
                summary["skipped"].append({
                    "project": project_dir.name,
                    "file": image_path.name,
                    "reason": str(exc),
                })
                continue

            relinked, reason = _replace_with_hardlink(canonical_path, image_path)
            if relinked:
                summary["deduplicated_files"] += 1
                summary["bytes_reclaimed"] += size
            else:
                summary["skipped"].append({
                    "project": project_dir.name,
                    "file": image_path.name,
                    "reason": str(reason or "Unknown hard-link error"),
                })

    return summary
