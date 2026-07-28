"""Source (`in/`) folder management routes: list, preview, summarise, pick/copy/
upload local images, and folder suggestions."""
from __future__ import annotations
import logging
logger = logging.getLogger(__name__)
from flask import (
    Blueprint,
    jsonify,
    request,
    send_from_directory,
    abort,
    send_file,
    make_response,
    current_app,
    Response,
    stream_with_context,
)
import zipfile
import io
import functools
import hashlib
import json
import re
from bisect import bisect_left
from pathlib import Path
import urllib.parse
import traceback
from . import bp
from werkzeug.utils import safe_join
import app.services.global_var as global_var
import pandas as pd
import os
import exifread
from shapely.geometry import Point,LineString,Polygon,box
import geopandas as gpd
import shutil
import datetime
import math
import time
import ipaddress
from app.services.cyclerap_scoring import calculate_cyclerap_score_native
# ---- init guards (thread-safe & error memo) ----
import threading
from werkzeug.exceptions import ServiceUnavailable


# —— Reuse your existing service layer —— #
from app.services.project_manager import project_manager, Project   # If the path is different, change to your real package path
import app.services.serializer as serializer
import app.services.cycleRAP_interface as CRI
import app.services.cycleRAP_VA as cycleRAP_VA

from pathlib import Path
from app.services import prediction as cv_pred
from app.services import gis_mapping as gis
import app.services.global_var as global_var

from ._helpers import fail, get_ctx, ok
from .image_utils import (
    _IMAGE_EXTENSIONS,
    _build_project_geo_data_from_points,
    _get_project_source_folders,
    _exif_date,
    get_image_folder_geo,
    make_image_namespace,
)
from .roads_util import _QUARTER_SUFFIX_RE, _get_known_road_names
from collections import Counter


_SOURCE_FOLDER_METADATA_FILENAME = "psat-folder-summary.json"
_SOURCE_FOLDER_METADATA_VERSION = 2  # bumped: summaries now also carry majority_quarter


def _is_loopback_request() -> bool:
    remote_addr = (request.remote_addr or "").strip()
    if not remote_addr:
        return False

    try:
        return ipaddress.ip_address(remote_addr).is_loopback
    except ValueError:
        return False


def _clean_source_folder_name(raw_name) -> str | None:
    if not isinstance(raw_name, str):
        return None

    clean_name = raw_name.strip()
    if not clean_name or clean_name in {".", ".."}:
        return None
    if any(sep in clean_name for sep in ("/", "\\")):
        return None

    return clean_name


def _path_is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def _build_flat_copy_name(source_file: Path, source_root: Path, destination_dir: Path) -> str:
    relative_parts = source_file.relative_to(source_root).parts
    base_name = relative_parts[-1]
    if not (destination_dir / base_name).exists():
        return base_name

    prefix_parts = [part.strip().replace("/", "_").replace("\\", "_") for part in relative_parts[:-1] if part.strip()]
    if prefix_parts:
        candidate = "__".join(prefix_parts + [base_name])
        if not (destination_dir / candidate).exists():
            return candidate

    stem = Path(base_name).stem
    suffix = Path(base_name).suffix
    safe_stem = "__".join(prefix_parts + [stem]) if prefix_parts else stem
    counter = 2
    while True:
        candidate = f"{safe_stem}__{counter}{suffix}"
        if not (destination_dir / candidate).exists():
            return candidate
        counter += 1


def _iter_source_image_files(source_dir: Path) -> list[Path]:
    if not source_dir.exists() or not source_dir.is_dir():
        return []

    return [
        file_path
        for file_path in sorted(source_dir.rglob("*"))
        if file_path.is_file() and file_path.suffix.lower() in _IMAGE_EXTENSIONS
    ]


def _collect_referenced_filenames(pm, folder_name: str) -> set[str]:
    """Bare on-disk filenames under in/<folder_name>/ that are still referenced
    by some project's geo_data 'Image Reference' column.

    Mirrors the namespace resolution in image_utils._resolve_image_from_in:
    single-source-folder projects store bare filenames; multi-folder projects
    prefix with '{make_image_namespace(folder_name)}__'.
    """
    referenced: set[str] = set()
    namespace_prefix = f"{make_image_namespace(folder_name)}__"

    for proj in pm.projects:
        source_folders = _get_project_source_folders(proj, pm)
        if folder_name not in source_folders:
            continue

        try:
            geo_df = proj.geo_data.df
        except Exception:
            continue
        if geo_df is None or geo_df.empty or "Image Reference" not in geo_df.columns:
            continue

        refs = (r.strip() for r in geo_df["Image Reference"].dropna().astype(str))
        if len(source_folders) == 1:
            referenced.update(r for r in refs if r)
        else:
            for r in refs:
                if r.startswith(namespace_prefix):
                    referenced.add(r[len(namespace_prefix):])

    return referenced


def prune_source_folder(folder_name: str) -> dict:
    """Permanently delete raw images under in/<folder_name>/ that no project
    currently references (see the 10-15m distance-sampling in
    _build_project_geo_data_from_points — most raw survey frames are never
    selected as a project's segment anchor image).

    Safe to call repeatedly / after every project created from this folder:
    only files not referenced by ANY known project are removed.
    """
    ctx = get_ctx()
    pm = ctx["pm"]
    in_root = pm.in_path.resolve()
    source_dir = (in_root / folder_name).resolve()

    result = {"folder_name": folder_name, "pruned": 0, "kept": 0, "bytes_freed": 0, "errors": []}
    if not _path_is_within(source_dir, in_root) or not source_dir.is_dir():
        return result

    image_files = _iter_source_image_files(source_dir)

    # Never prune a folder that has ALREADY been pruned once. After the first prune
    # the folder holds only its segment-anchor frames (~1 per 10-15 m) — there is no
    # dense "dead weight" left to reclaim, so a second pass can only destroy frames
    # some project still relies on. This matters most on deployed machines: the
    # shipped seed folders arrive pre-pruned (summary.pruned == true), and pruning
    # here is profile-scoped (_collect_referenced_filenames sees only the ACTIVE
    # profile's projects). A second profile creating a project would otherwise delete
    # anchors protected only by the first profile's (moved-away) shipped project. The
    # authoritative pre-prune segment_count is already preserved in the summary, so
    # skipping is safe and lossless.
    meta = _load_source_folder_metadata(source_dir)
    if meta and isinstance(meta.get("summary"), dict) and meta["summary"].get("pruned"):
        result["kept"] = len(image_files)
        result["skipped_already_pruned"] = True
        return result

    referenced = _collect_referenced_filenames(pm, folder_name)

    # Ensure an authoritative folder summary (segment_count / distance) computed from
    # the FULL frame set is cached before we decimate the folder. Pruning throws away
    # the dense raw frames the 10 m segmentation relies on, so a summary recomputed
    # afterwards would badly undercount — capture the correct value now and preserve it.
    saved_summary = None
    try:
        _resolve_source_folder_preview(source_dir, in_root, allow_rename=False)
        metadata = _load_source_folder_metadata(source_dir)
        if metadata is not None and isinstance(metadata.get("summary"), dict):
            saved_summary = dict(metadata["summary"])
    except Exception as exc:
        current_app.logger.warning("Failed to snapshot summary before pruning %s: %s", source_dir, exc)

    for image_file in image_files:
        rel = image_file.relative_to(source_dir).as_posix()
        if rel in referenced or image_file.name in referenced:
            result["kept"] += 1
            continue
        try:
            size = image_file.stat().st_size
            image_file.unlink()
            result["pruned"] += 1
            result["bytes_freed"] += size
        except Exception as exc:
            result["errors"].append(f"Failed to delete {rel}: {exc}")
            result["kept"] += 1

    # Re-stamp the cache_key to the now-pruned file set so the preserved (pre-prune)
    # segment_count survives and no later read recomputes it from the thinned frames.
    if result["pruned"] > 0 and saved_summary is not None:
        remaining = _iter_source_image_files(source_dir)
        _restamp_source_folder_metadata(source_dir, remaining, saved_summary, pruned=True)

    return result


def _read_modified_datetime(image_path: Path) -> datetime.datetime | None:
    try:
        return datetime.datetime.fromtimestamp(image_path.stat().st_mtime)
    except OSError:
        return None


def _read_capture_date(image_path: Path) -> datetime.date | None:
    """EXIF capture date if present (survives file transfers), else mtime."""
    exif_date = _exif_date(image_path)
    if exif_date is not None:
        return exif_date
    modified_at = _read_modified_datetime(image_path)
    return modified_at.date() if modified_at is not None else None


def _quarter_key(d: datetime.date) -> tuple[int, int]:
    return (d.year, (d.month - 1) // 3 + 1)


def _format_quarter_label(captured_at: datetime.datetime | None) -> str | None:
    if captured_at is None:
        return None

    quarter = ((captured_at.month - 1) // 3) + 1
    return f"{quarter}Q{captured_at.year}"


def _quarter_sort_key(label: str) -> tuple[int, int, str]:
    match = re.fullmatch(r"([1-4])Q(\d{4})", label)
    if match:
        return (int(match.group(2)), int(match.group(1)), label)

    legacy_match = re.fullmatch(r"Q([1-4])(\d{4})", label)
    if legacy_match:
        return (int(legacy_match.group(2)), int(legacy_match.group(1)), label)

    return (9999, 9999, label)


def _get_source_folder_metadata_path(source_dir: Path) -> Path:
    return source_dir / _SOURCE_FOLDER_METADATA_FILENAME


def _build_source_folder_cache_key(source_dir: Path, image_files: list[Path]) -> str:
    digest = hashlib.sha1()
    for image_file in image_files:
        try:
            stat = image_file.stat()
        except OSError:
            continue

        digest.update(image_file.relative_to(source_dir).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(stat.st_size).encode("ascii"))
        digest.update(b"\0")
        digest.update(str(stat.st_mtime_ns).encode("ascii"))
        digest.update(b"\0")

    return digest.hexdigest()


# In-memory cache of raw EXIF geo-points per source folder, keyed by the same
# content-hash cache_key as the on-disk folder-summary cache (_build_source_folder_cache_key).
# Unlike that cache — which stores one aggregate segment_count for the whole
# folder — this stores the raw per-photo GPS points, so callers can re-clip
# them against an arbitrary polygon (e.g. Map mode's live "Roads Found"
# preview, redrawn repeatedly) without re-parsing EXIF from disk on every
# redraw. Process-local only; cleared on backend reload, same as model state.
_GEO_POINTS_CACHE: dict[str, tuple[str, gpd.GeoDataFrame]] = {}
_GEO_POINTS_CACHE_LOCK = threading.Lock()


def _get_cached_geo_points(source_dir: Path) -> gpd.GeoDataFrame:
    """Raw EXIF geo-points for a source folder, cached in-process and
    invalidated by the same stat-only content hash used for folder summaries."""
    image_files = _iter_source_image_files(source_dir)
    cache_key = _build_source_folder_cache_key(source_dir, image_files)
    cache_id = str(source_dir)

    with _GEO_POINTS_CACHE_LOCK:
        cached = _GEO_POINTS_CACHE.get(cache_id)
        if cached is not None and cached[0] == cache_key:
            return cached[1]

    geo_points = get_image_folder_geo(str(source_dir))

    with _GEO_POINTS_CACHE_LOCK:
        _GEO_POINTS_CACHE[cache_id] = (cache_key, geo_points)

    return geo_points


def _load_source_folder_metadata_any_version(source_dir: Path) -> dict | None:
    """Like _load_source_folder_metadata but ignores the schema ``version`` gate.

    Used only to recover the previous summary for the pruning backstop below,
    which must survive a metadata schema bump (e.g. adding majority_quarter) —
    a pruned folder's authoritative pre-prune segment_count is otherwise
    unrecoverable once the raw frames are gone, so this must not be lost just
    because the cache schema moved on.
    """
    metadata_path = _get_source_folder_metadata_path(source_dir)
    if not metadata_path.exists() or not metadata_path.is_file():
        return None

    try:
        data = json.loads(metadata_path.read_text(encoding="utf-8"))
    except Exception:
        return None

    if not isinstance(data, dict) or not isinstance(data.get("summary"), dict):
        return None

    return data


def _load_source_folder_metadata(source_dir: Path) -> dict | None:
    data = _load_source_folder_metadata_any_version(source_dir)
    if data is None:
        return None
    if data.get("version") != _SOURCE_FOLDER_METADATA_VERSION:
        return None

    return data


def _write_source_folder_metadata(source_dir: Path, cache_key: str, summary: dict) -> None:
    metadata_path = _get_source_folder_metadata_path(source_dir)
    temp_path = metadata_path.with_name(f"{metadata_path.name}.tmp")
    payload = {
        "version": _SOURCE_FOLDER_METADATA_VERSION,
        "generated_at": datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "cache_key": cache_key,
        "summary": summary,
    }
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(metadata_path)


def _restamp_source_folder_metadata(
    source_dir: Path, image_files: list[Path], summary: dict, *, pruned: bool = False
) -> None:
    """Rewrite the folder-summary metadata so its ``cache_key`` matches the CURRENT
    files on disk while **preserving** the (authoritative) summary values.

    This is called after pruning removes raw survey frames. Without it, the stored
    cache_key would no longer match the decimated folder, so the next summary read
    would recompute segment_count by re-sampling the already-thinned anchor frames
    at 10 m — which badly undercounts (the raw ~1-per-2 m frames the count depends
    on are gone). Re-stamping keeps the correct pre-prune segment_count / distance
    and stops any spurious recompute.
    """
    try:
        preserved = dict(summary)
        if pruned:
            preserved["pruned"] = True
        new_key = _build_source_folder_cache_key(source_dir, image_files)
        _write_source_folder_metadata(source_dir, new_key, preserved)
    except Exception as exc:
        current_app.logger.warning("Failed to re-stamp source folder metadata for %s: %s", source_dir, exc)


def _build_source_folder_summary(source_dir: Path, image_files: list[Path]) -> dict:
    modified_dates = [
        modified_at
        for modified_at in (_read_modified_datetime(image_file) for image_file in image_files)
        if modified_at is not None
    ]

    geotagged_image_count = 0
    segment_count = 0
    segment_error = None
    total_distance_km = None

    try:
        geo_points = get_image_folder_geo(str(source_dir))
        geotagged_image_count = len(geo_points)
        if geotagged_image_count > 0:
            segments_gdf = _build_project_geo_data_from_points(geo_points, source_dir.name)
            segment_count = len(segments_gdf)
            # Total surveyed distance — reproject to SVY21 (Singapore metric CRS)
            # for an accurate length in metres, then report km.
            try:
                metric = segments_gdf.to_crs(3414)
                total_distance_km = round(float(metric.length.sum()) / 1000.0, 2)
            except Exception:
                total_distance_km = None
    except Exception as exc:
        segment_error = str(exc)

    quarter_labels = sorted({
        quarter_label
        for quarter_label in (_format_quarter_label(modified_at) for modified_at in modified_dates)
        if quarter_label is not None
    }, key=_quarter_sort_key)
    survey_quarter = quarter_labels[0] if len(quarter_labels) == 1 else None

    # Majority-vote quarter (EXIF capture date, falling back to mtime): tolerant of a
    # few outlier images and of file-transfer mtime noise, unlike survey_quarter
    # above which requires every image to agree. Used for display only (e.g. Map
    # mode's Quarter column for folders lacking a quarter-suffixed name) — never
    # drives the auto-rename decision, which stays keyed off survey_quarter.
    capture_dates = [
        capture_date
        for capture_date in (_read_capture_date(image_file) for image_file in image_files)
        if capture_date is not None
    ]
    majority_quarter = None
    if capture_dates:
        (year, quarter), _count = Counter(_quarter_key(d) for d in capture_dates).most_common(1)[0]
        majority_quarter = f"{quarter}Q{year}"

    return {
        "folder_name": source_dir.name,
        "image_count": len(image_files),
        "geotagged_image_count": geotagged_image_count,
        "segment_count": segment_count,
        "total_distance_km": total_distance_km,
        "segment_error": segment_error,
        "earliest_modified_at": min(modified_dates).isoformat() if modified_dates else None,
        "latest_modified_at": max(modified_dates).isoformat() if modified_dates else None,
        "survey_quarter": survey_quarter,
        "survey_quarters": quarter_labels,
        "majority_quarter": majority_quarter,
    }


def _folder_name_has_quarter_suffix(folder_name: str) -> bool:
    return bool(_QUARTER_SUFFIX_RE.search(folder_name.strip()))


def _get_unique_source_folder_target(in_root: Path, desired_name: str, current_dir: Path | None = None) -> Path:
    candidate_name = desired_name
    counter = 2

    while True:
        candidate_dir = in_root / candidate_name
        if current_dir is not None and candidate_dir == current_dir:
            return candidate_dir
        if not candidate_dir.exists():
            return candidate_dir

        candidate_name = f"{desired_name}__{counter}"
        counter += 1


def _maybe_auto_rename_source_folder(source_dir: Path, in_root: Path, summary: dict) -> tuple[Path, str | None]:
    survey_quarter = str(summary.get("survey_quarter") or "").strip()
    if not survey_quarter:
        return source_dir, None
    if _folder_name_has_quarter_suffix(source_dir.name):
        return source_dir, None

    target_dir = _get_unique_source_folder_target(in_root, f"{source_dir.name}_{survey_quarter}", source_dir)
    if target_dir == source_dir:
        return source_dir, None

    previous_name = source_dir.name
    source_dir.rename(target_dir)
    summary["folder_name"] = target_dir.name
    return target_dir, previous_name


def _resolve_source_folder_preview(source_dir: Path, in_root: Path, allow_rename: bool = True) -> dict:
    image_files = _iter_source_image_files(source_dir)
    cache_key = _build_source_folder_cache_key(source_dir, image_files)
    metadata = _load_source_folder_metadata(source_dir)

    cached = False
    summary = None
    restamped_pruned = False
    if metadata is not None and metadata.get("cache_key") == cache_key:
        cached_summary = metadata.get("summary")
        if isinstance(cached_summary, dict):
            summary = dict(cached_summary)
            cached = True

    if summary is None:
        fresh = _build_source_folder_summary(source_dir, image_files)
        # Version-agnostic on purpose: a metadata schema bump (e.g. adding
        # majority_quarter) must not defeat this backstop for folders that were
        # pruned under an older schema version — their pre-prune segment_count
        # is otherwise unrecoverable once the raw frames are gone.
        old_metadata = _load_source_folder_metadata_any_version(source_dir)
        old = old_metadata.get("summary") if old_metadata is not None else None
        # Backstop for folders whose raw frames were pruned after a project was
        # created from them (cache_key no longer matches the thinned folder). The
        # fresh recompute would re-sample the ~1-per-segment anchor frames at 10 m
        # and undercount, so when frames have clearly been removed since the last
        # summary we keep the authoritative pre-prune segment_count / distance and
        # only refresh the volatile file counts.
        if (
            isinstance(old, dict)
            and isinstance(old.get("segment_count"), int)
            and (fresh.get("geotagged_image_count") or 0) < (old.get("geotagged_image_count") or 0)
        ):
            summary = dict(old)
            summary["image_count"] = fresh.get("image_count")
            summary["geotagged_image_count"] = fresh.get("geotagged_image_count")
            summary["pruned"] = True
            cached = True
            restamped_pruned = True
        else:
            summary = fresh

    summary["folder_name"] = source_dir.name
    renamed_from = None
    if allow_rename:
        # The bulk auto-load path passes allow_rename=False so browsing the Create
        # page never silently renames folders on disk under the user.
        try:
            source_dir, renamed_from = _maybe_auto_rename_source_folder(source_dir, in_root, summary)
        except Exception as exc:
            logger.warning("Failed to auto-rename source folder %s: %s", source_dir, exc)

    summary["folder_name"] = source_dir.name

    if not cached or renamed_from is not None or restamped_pruned:
        # restamped_pruned writes the freshly-computed (pruned) cache_key so the
        # preserved count becomes a cache hit next time instead of re-running EXIF.
        try:
            _write_source_folder_metadata(source_dir, cache_key, summary)
        except Exception as exc:
            logger.warning("Failed to write source folder metadata for %s: %s", source_dir, exc)

    result = dict(summary)
    result["cached"] = cached and renamed_from is None
    result["mixed_quarters"] = len(result.get("survey_quarters") or []) > 1
    result["renamed_from"] = renamed_from
    return result


def _peek_cached_summary(source_dir: Path) -> dict | None:
    """Cache-only, non-blocking read: validates the on-disk summary against the
    current file listing's content-hash key (stats every file, never opens/reads
    any of them) and returns it if still fresh, else None. Cheap enough to run
    synchronously on a request thread."""
    image_files = _iter_source_image_files(source_dir)
    cache_key = _build_source_folder_cache_key(source_dir, image_files)
    metadata = _load_source_folder_metadata(source_dir)
    if metadata is None or metadata.get("cache_key") != cache_key:
        return None
    summary = metadata.get("summary")
    return dict(summary) if isinstance(summary, dict) else None


@bp.get("/folders")
def list_input_folders():
    """
    List available subfolders under the input root (folders only)
    GET /api/projects/folders
    Response: { items: [ "FolderA", "FolderB", ... ] }
    """
    try:
        ctx = get_ctx()
    except Exception as exc:
        return jsonify({"error": f"Backend initialisation failed: {exc}"}), 500
    pm = ctx["pm"]
    in_path: Path = pm.in_path

    if not in_path.exists():
        return ok({"items": []})

    items = [f for f in os.listdir(in_path) if (in_path / f).is_dir()]
    items.sort()
    return ok({"items": items})


@bp.get("/folders/preview")
def preview_input_folder():
    """
    Return a folder summary derived from image file modified timestamps.
    """
    ctx = get_ctx()
    pm = ctx["pm"]

    folder_name = _clean_source_folder_name(request.args.get("folder_name"))
    if not folder_name:
        return fail("folder_name is required", 400)

    in_root = pm.in_path.resolve()
    source_dir = (in_root / folder_name).resolve()
    if not _path_is_within(source_dir, in_root):
        return fail("Invalid folder_name", 400)
    if not source_dir.exists() or not source_dir.is_dir():
        return fail("Source folder not found", 404)

    # skip_rename=1 lets the Create page's bulk auto-load compute stats without
    # triggering the quarter-suffix auto-rename (which would move folders on disk
    # under the browsing user).
    allow_rename = str(request.args.get("skip_rename") or "").strip().lower() not in ("1", "true", "yes")
    return ok(_resolve_source_folder_preview(source_dir, in_root, allow_rename=allow_rename))


@bp.get("/folders/summaries")
def summarise_input_folders():
    """
    Fast, cache-only bulk summary for every source folder — used to auto-populate
    the Create page table without computing anything heavy.

    For each folder we return its previously-cached summary if present (a plain
    JSON read, no EXIF/geo work), otherwise a lightweight stub with
    ``cached: false`` so the frontend knows to lazily fetch a full preview for it.
    This keeps the endpoint O(number-of-folders) file reads even when hundreds of
    uncached folders exist.

    GET /api/projects/folders/summaries
    Response: { items: [ { folder_name, segment_count, survey_quarter, ...,
                           cached } ] }
    """
    try:
        ctx = get_ctx()
    except Exception as exc:
        return jsonify({"error": f"Backend initialisation failed: {exc}"}), 500
    pm = ctx["pm"]
    in_path: Path = pm.in_path

    if not in_path.exists():
        return ok({"items": []})

    items: list[dict] = []
    for entry in sorted(os.listdir(in_path)):
        source_dir = in_path / entry
        if not source_dir.is_dir():
            continue

        metadata = _load_source_folder_metadata(source_dir)
        summary = metadata.get("summary") if metadata is not None else None
        if isinstance(summary, dict):
            result = dict(summary)
            result["folder_name"] = entry
            result.setdefault("survey_quarters", [])
            result["mixed_quarters"] = len(result.get("survey_quarters") or []) > 1
            result["cached"] = True
        else:
            result = {
                "folder_name": entry,
                "image_count": None,
                "geotagged_image_count": None,
                "segment_count": None,
                "total_distance_km": None,
                "segment_error": None,
                "earliest_modified_at": None,
                "latest_modified_at": None,
                "survey_quarter": None,
                "survey_quarters": [],
                "mixed_quarters": False,
                "cached": False,
            }
        result["renamed_from"] = None
        items.append(result)

    return ok({"items": items})


@bp.get("/folders/image")
def get_input_folder_image():
    """
    Return an image file under a source folder in /in for preview purposes.
    """
    ctx = get_ctx()
    pm = ctx["pm"]

    folder_name = _clean_source_folder_name(request.args.get("folder_name"))
    relative_path = str(request.args.get("relative_path") or "").strip()
    if not folder_name or not relative_path:
        abort(400, description="folder_name and relative_path are required")

    in_root = pm.in_path.resolve()
    source_dir = (in_root / folder_name).resolve()
    if not _path_is_within(source_dir, in_root):
        abort(400, description="Invalid image path")
    if not source_dir.exists() or not source_dir.is_dir():
        abort(404, description="Source folder not found")

    safe_path = safe_join(str(source_dir), relative_path)
    if safe_path is None:
        abort(400, description="Invalid image path")

    file_path = Path(safe_path).resolve()
    if not _path_is_within(file_path, source_dir):
        abort(400, description="Invalid image path")
    if not file_path.exists() or not file_path.is_file():
        abort(404, description="Image not found")

    resp = send_from_directory(str(source_dir), file_path.relative_to(source_dir).as_posix(), conditional=True)
    resp.headers["Cache-Control"] = "public, max-age=3600"
    return resp


@bp.get("/folders/suggestions")
def list_input_folder_suggestions():
    """
    Return searchable destination folder suggestions for source imports.
    Includes both existing input folders and known road names from reference data.
    """
    ctx = get_ctx()
    pm = ctx["pm"]
    in_path: Path = pm.in_path

    existing_folders = set()
    if in_path.exists():
        existing_folders = {
            item.name
            for item in in_path.iterdir()
            if item.is_dir()
        }
    suggestion_names = existing_folders | set(_get_known_road_names())

    items = [
        {"name": name, "exists": name in existing_folders}
        for name in suggestion_names
    ]
    items.sort(key=lambda item: (not item["exists"], item["name"].lower()))
    return ok({"items": items})


@bp.post("/folders/pick-local")
def pick_local_source_folder():
    """
    Open a native folder picker on the same machine as the backend.
    Local-only by design so deployed instances do not expose filesystem browsing.
    """
    if not _is_loopback_request():
        return fail("Local folder browsing is only available from the same machine as the server", 403)

    root = None
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected_path = filedialog.askdirectory(title="Select image folder to import")
    except Exception as exc:
        current_app.logger.exception("Failed to open local folder picker")
        return fail(f"Local folder picker is unavailable in this environment: {exc}", 500)
    finally:
        if root is not None:
            try:
                root.destroy()
            except Exception:
                pass

    if not selected_path:
        return ok({"path": None, "suggested_folder_name": None})

    return ok({
        "path": selected_path,
        "suggested_folder_name": Path(selected_path).name,
    })


@bp.post("/folders/copy-local")
def copy_images_to_source_folder():
    """
    Copy image files from a local folder on the backend machine into a source folder under /in.
    Local-only by design so deployed instances do not expose arbitrary filesystem reads.
    """
    if not _is_loopback_request():
        return fail("Local folder copy is only available from the same machine as the server", 403)

    ctx = get_ctx()
    pm = ctx["pm"]
    data = request.get_json(silent=True) or {}

    folder_name = _clean_source_folder_name(data.get("folder_name"))
    if not folder_name:
        return fail("Destination folder name is required", 400)

    source_path = str(data.get("source_path") or "").strip()
    if not source_path:
        return fail("Source folder path is required", 400)

    try:
        source_dir = Path(source_path).expanduser().resolve()
    except Exception:
        return fail("Source folder path is invalid", 400)

    if not source_dir.exists() or not source_dir.is_dir():
        return fail("Source folder does not exist or is not a directory", 400)

    in_root = pm.in_path.resolve()
    destination_dir = (in_root / folder_name).resolve()
    if not _path_is_within(destination_dir, in_root):
        return fail("Invalid destination folder name", 400)

    if source_dir == destination_dir or _path_is_within(source_dir, destination_dir) or _path_is_within(destination_dir, source_dir):
        return fail("Source and destination folders must not overlap", 400)

    image_files = _iter_source_image_files(source_dir)

    if not image_files:
        return fail("No image files were found in the selected folder", 400)

    destination_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    errors: list[str] = []

    for image_file in image_files:
        try:
            destination_name = _build_flat_copy_name(image_file, source_dir, destination_dir)
            shutil.copy2(image_file, destination_dir / destination_name)
            count += 1
        except Exception as exc:
            rel_path = image_file.relative_to(source_dir)
            errors.append(f"Failed to copy {rel_path}: {exc}")

    preview = _resolve_source_folder_preview(destination_dir, in_root)

    return ok({
        "count": count,
        "errors": errors,
        "folder_name": preview["folder_name"],
        "renamed_from": preview["renamed_from"],
        "preview": preview,
        "message": f"Copied {count} image(s) into folder '{preview['folder_name']}'",
    })

@bp.post("/folders/upload-images")
def upload_images_to_source_folder():
    """
    Upload images to a source folder in the /in directory.
    POST /api/projects/folders/upload-images
    """
    ctx = get_ctx()
    pm = ctx["pm"]

    try:
        # Get folder name from request
        folder_name = request.form.get('folder_name')
        if not folder_name or not folder_name.strip():
            return fail("Folder name is required", 400)

        folder_name = folder_name.strip()

        # Get the source folder path (in directory)
        source_dir: Path = pm.in_path / folder_name
        source_dir.mkdir(parents=True, exist_ok=True)

        # Get uploaded files
        if 'images' not in request.files:
            return fail("No image files provided", 400)

        uploaded_files = request.files.getlist('images')
        if not uploaded_files:
            return fail("No image files provided", 400)

        count = 0
        errors = []

        # Allowed image extensions
        allowed_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'}

        for file in uploaded_files:
            if file.filename == '':
                errors.append("Empty filename")
                continue

            # Validate file extension
            file_ext = Path(file.filename).suffix.lower()
            if file_ext not in allowed_extensions:
                errors.append(f"Invalid file type: {file.filename}")
                continue

            try:
                # To prevent directory traversal attacks, resolve relative paths securely
                # file.filename could be "folder/img.jpg" or just "img.jpg"
                clean_path = Path(file.filename)
                
                # Check for malicious paths (e.g. ones with '..')
                if '..' in clean_path.parts or clean_path.is_absolute():
                    errors.append(f"Invalid file path: {file.filename}")
                    continue

                # Save file to source folder, preserving any subdirectories
                file_path = source_dir / clean_path
                file_path.parent.mkdir(parents=True, exist_ok=True)
                file.save(str(file_path))
                count += 1
            except Exception as e:
                errors.append(f"Failed to save {file.filename}: {str(e)}")

        return ok({
            "count": count,
            "errors": errors,
            "message": f"Uploaded {count} image(s) to folder '{folder_name}'"
        })

    except Exception as e:
        traceback.print_exc()
        return fail(f"Error uploading images: {e}", 500)
