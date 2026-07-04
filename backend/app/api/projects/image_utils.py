"""Image resolution, namespacing and geo-data helpers for the projects blueprint.

Resolves stored/`in/` image references, builds project geo-data from image EXIF
points, migrates legacy image layouts, and maps source folders to image
namespaces. Shared by crud, images, source-folder and autocode routes."""
from __future__ import annotations
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





def _display_source_name_from_namespace(namespace: str) -> str:
    return re.sub(r"\s+", " ", namespace.replace("_", " ").strip()).title()


def _build_source_namespace_map(in_path: Path) -> dict[str, str]:
    namespace_map: dict[str, str] = {}
    if not in_path.exists():
        return namespace_map

    for child_name in os.listdir(in_path):
        child_path = in_path / child_name
        if not child_path.is_dir():
            continue
        namespace_map[make_image_namespace(child_name).lower()] = child_name
    return namespace_map


def _get_project_source_folders(proj: Project, pm) -> list[str]:
    metadata_sources = getattr(proj.metadata, "source_folders", None) or []
    cleaned_sources: list[str] = []
    seen_sources: set[str] = set()
    for source in metadata_sources:
        source_name = str(source or "").strip()
        if not source_name or source_name in seen_sources:
            continue
        cleaned_sources.append(source_name)
        seen_sources.add(source_name)
    if cleaned_sources:
        return cleaned_sources

    dataset_name = str(getattr(proj.metadata, "dataset", "") or "").strip()
    if dataset_name and dataset_name != "MULTI_FOLDER_SELECTION":
        return [dataset_name]

    try:
        geo_df = proj.geo_data.df
    except Exception:
        geo_df = None

    if geo_df is None or geo_df.empty or "Image Reference" not in geo_df.columns:
        return []

    namespace_map = _build_source_namespace_map(pm.in_path)
    project_prefix = f"{proj.metadata.project_name}_"
    derived_sources: list[str] = []
    seen_sources.clear()

    for image_ref in geo_df["Image Reference"].dropna().astype(str):
        normalized_ref = image_ref.strip()
        if not normalized_ref:
            continue
        if normalized_ref.startswith(project_prefix):
            normalized_ref = normalized_ref[len(project_prefix):]
        if "__" not in normalized_ref:
            continue

        namespace = normalized_ref.split("__", 1)[0].strip("_")
        if not namespace:
            continue

        source_name = namespace_map.get(namespace.lower()) or _display_source_name_from_namespace(namespace)
        if source_name in seen_sources:
            continue
        derived_sources.append(source_name)
        seen_sources.add(source_name)

    return derived_sources

_IMAGE_DATE_RE = re.compile(r'_(\d{8})[_.]')
_IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp', '.webp'}
# EXIF tag IDs for capture date
_EXIF_DATE_TAGS = (36867, 36868, 306)  # DateTimeOriginal, DateTimeDigitized, DateTime


def _exif_date(path: Path) -> "datetime.date | None":
    """Return the capture date from image EXIF, or None if unavailable."""
    try:
        from PIL import Image
        with Image.open(path) as img:
            exif = img._getexif()
            if exif:
                for tag in _EXIF_DATE_TAGS:
                    val = exif.get(tag)
                    if val and len(val) >= 10:
                        try:
                            return datetime.datetime.strptime(val[:10], "%Y:%m:%d").date()
                        except ValueError:
                            pass
    except Exception:
        pass
    return None


def _get_image_date_range(proj: "Project", pm=None) -> "dict | None":
    """Return {"earliest": "YYYY-MM-DD", "latest": "YYYY-MM-DD"} from actual image files.

    Priority order per image file:
    1. EXIF DateTimeOriginal / DateTimeDigitized / DateTime
    2. File modification time (mtime) fallback

    For newer projects without an images/ folder, resolves files from in/ via geo_data
    Image Reference column (requires pm).
    """
    dates: list[datetime.date] = []

    images_dir = proj.project_path / "images"
    if images_dir.is_dir():
        for f in images_dir.iterdir():
            if not f.is_file() or f.suffix.lower() not in _IMAGE_EXTENSIONS:
                continue
            d = _exif_date(f)
            if d is None:
                try:
                    d = datetime.datetime.fromtimestamp(f.stat().st_mtime).date()
                except Exception:
                    pass
            if d:
                dates.append(d)
    elif pm is not None:
        # Newer projects: images live in in/<source_folder>/, referenced from geo_data
        try:
            geo_df = proj.geo_data.df
            if geo_df is not None and "Image Reference" in geo_df.columns:
                seen: set[str] = set()
                for ref in geo_df["Image Reference"].dropna().astype(str):
                    ref = ref.strip()
                    if not ref or ref in seen:
                        continue
                    seen.add(ref)
                    file_path = _resolve_image_from_in(pm, proj.metadata.project_name, ref)
                    if file_path is None or not file_path.is_file():
                        continue
                    d = _exif_date(file_path)
                    if d is None:
                        try:
                            d = datetime.datetime.fromtimestamp(file_path.stat().st_mtime).date()
                        except Exception:
                            pass
                    if d:
                        dates.append(d)
        except Exception:
            pass

    if not dates:
        return None
    # Group by calendar quarter; use the quarter with the most images
    from collections import Counter
    def _qkey(d: datetime.date) -> tuple:
        return (d.year, (d.month - 1) // 3 + 1)
    quarter_counts: Counter = Counter(_qkey(d) for d in dates)
    dominant = quarter_counts.most_common(1)[0][0]
    dominant_dates = [d for d in dates if _qkey(d) == dominant]
    return {"earliest": min(dominant_dates).isoformat(), "latest": max(dominant_dates).isoformat()}

def _rmtree_robust(path: Path) -> bool:
    """Delete a directory tree, working around Windows file-lock races.

    Tries shutil.rmtree first; on failure deletes files one-by-one then removes
    the (hopefully now-empty) directory. Returns True when the directory is gone.
    """
    if not path.is_dir():
        return True
    try:
        shutil.rmtree(str(path))
        return not path.exists()
    except Exception:
        pass
    # File-by-file fallback (handles Windows thumbnail/AV lock races)
    for item in sorted(path.rglob("*"), reverse=True):
        try:
            if item.is_file() or item.is_symlink():
                item.unlink()
            elif item.is_dir():
                item.rmdir()
        except Exception:
            pass
    try:
        path.rmdir()
    except Exception:
        pass
    return not path.exists()


def _migrate_legacy_images(pm, project_name: str, proj) -> bool:
    """Convert a legacy project that stores copies in images/ to reference in/ directly.

    Strips the project-title prefix from every Image Reference in geo_data.gpkg,
    verifies each stripped name resolves to a file under in/, then deletes images/.
    Runs quietly — prints to stdout so Flask terminal shows progress.
    """
    try:
        images_dir = proj.project_path / global_var.PROJECT_IMAGES_FOLDER
        if not images_dir.is_dir():
            return False

        source_folders = getattr(proj.metadata, "source_folders", None) or []
        if not source_folders:
            print(f"[migrate] '{project_name}': no source_folders in metadata — skipping")
            return False

        missing = [sf for sf in source_folders if not (pm.in_path / sf).is_dir()]
        if missing:
            print(
                f"[migrate] '{project_name}': source folder(s) not present in in/ — skipping: {missing}",
            )
            return False

        geo_df = proj.geo_data.df
        if geo_df.empty or "Image Reference" not in geo_df.columns:
            print(f"[migrate] '{project_name}': geo_data missing Image Reference column — skipping")
            return False

        prefix = project_name + "_"
        ns_map = {make_image_namespace(sf): sf for sf in source_folders}

        def _strip_and_resolve(img_ref: str):
            """Return (new_canonical_ref, in_path) or None.

            Tries progressively more aggressive prefix stripping:
            1. Strip project-name prefix (legacy copy convention)
            2. Strip source-folder namespace prefix (derived from metadata, not project name)
            For multi-folder projects the returned ref is in namespace__filename form.
            """
            working = img_ref[len(prefix):] if img_ref.startswith(prefix) else img_ref
            # Build candidate bare names in priority order: with namespace, then without.
            bare_candidates: list[str] = [working]
            if "__" in working:
                bare_candidates.append(working.split("__", 1)[1])

            if len(source_folders) == 1:
                sf = source_folders[0]
                for bare in bare_candidates:
                    candidate = pm.in_path / sf / bare
                    if candidate.is_file():
                        return bare, candidate
            else:
                for bare in bare_candidates:
                    if "__" in bare:
                        ns, orig = bare.split("__", 1)
                        if ns in ns_map:
                            candidate = pm.in_path / ns_map[ns] / orig
                            if candidate.is_file():
                                return f"{ns}__{orig}", candidate
                    for sf in source_folders:
                        candidate = pm.in_path / sf / bare
                        if candidate.is_file():
                            return f"{make_image_namespace(sf)}__{bare}", candidate
            return None

        img_refs = [
            r for r in geo_df["Image Reference"].tolist()
            if isinstance(r, str) and r.strip()
        ]
        if not img_refs:
            print(f"[migrate] '{project_name}': no image refs in geo_data — skipping")
            return False

        print(f"[migrate] '{project_name}': checking {len(img_refs)} image refs against in/...")

        new_ref_map: dict[str, str] = {}
        for img_ref in img_refs:
            result = _strip_and_resolve(img_ref)
            if result is None:
                print(f"[migrate] '{project_name}': '{img_ref}' not found in in/ — skipping migration")
                return False
            new_ref_map[img_ref] = result[0]

        # All images confirmed in in/ — rewrite geo_data.gpkg
        proj.geo_data.df["Image Reference"] = proj.geo_data.df["Image Reference"].apply(
            lambda r: new_ref_map.get(str(r), r) if pd.notna(r) else r
        )
        # Write to a temp file first, then replace, to avoid Windows GDAL file-lock on the
        # existing geo_data.gpkg (SQLite connections may linger after gpd.read_file).
        tmp_gpkg = proj.project_path / "_geo_data_migrating.gpkg"
        try:
            proj.geo_data.df.to_file(str(tmp_gpkg), driver="GPKG", index=False)
            gpkg_path = proj.project_path / "geo_data.gpkg"
            if gpkg_path.exists():
                gpkg_path.unlink()
            tmp_gpkg.rename(gpkg_path)
        except Exception as write_exc:
            if tmp_gpkg.exists():
                tmp_gpkg.unlink(missing_ok=True)
            raise write_exc
        print(f"[migrate] '{project_name}': geo_data.gpkg updated ({len(new_ref_map)} refs)")

        # Delete the now-redundant images/ folder
        deleted = _rmtree_robust(images_dir)
        if deleted:
            print(f"[migrate] '{project_name}': images/ deleted. Migration complete.")
        else:
            print(f"[migrate] '{project_name}': images/ could not be fully deleted (file lock?). Will retry next open.")
        return True

    except Exception as exc:
        print(f"[migrate] '{project_name}': migration error: {exc}")
        return False

#-----------------------------------------------------------------------------------

def dms_to_decimal(dms, ref):
    deg = dms[0].num / dms[0].den
    minute = dms[1].num / dms[1].den
    sec = dms[2].num / dms[2].den
    dec = deg + minute/60 + sec/3600
    return -dec if ref in ['S','W'] else dec

def get_image_folder_geo(folder_path):
    records = []
    for fname in sorted(os.listdir(folder_path)):
        if not fname.lower().endswith(('.jpg', '.jpeg')):
            continue
        img_path = os.path.join(folder_path, fname)
        with open(img_path, 'rb') as f:
            tags = exifread.process_file(f, details=False)

        # Required GPS tags
        if {'GPS GPSLatitude', 'GPS GPSLongitude',
            'GPS GPSLatitudeRef', 'GPS GPSLongitudeRef'}.issubset(tags):
            
            lat = dms_to_decimal(tags['GPS GPSLatitude'].values,
                                tags['GPS GPSLatitudeRef'].printable)
            lon = dms_to_decimal(tags['GPS GPSLongitude'].values,
                                tags['GPS GPSLongitudeRef'].printable)
            
            records.append({
                'latitude':  lat,
                'longitude': lon,
                'filename':  fname
            })

    df = pd.DataFrame(records)
    df['geometry'] = [Point(xy) for xy in zip(df.longitude, df.latitude)]
    return gpd.GeoDataFrame(df, geometry='geometry', crs="EPSG:4326")


def _build_project_geo_data_from_points(
    geo_points: gpd.GeoDataFrame,
    source_name: str,
    selection_polygon: Polygon | None = None,
):
    df = geo_points.copy()
    if df.empty:
        raise ValueError(f"No geotagged images found in folder '{source_name}'")

    if selection_polygon is not None:
        df = df[df.geometry.apply(selection_polygon.covers)].reset_index(drop=True)
        if df.empty:
            return gpd.GeoDataFrame(columns=["LATITUDE", "LONGITUDE", "FILENAME", "geometry"], geometry="geometry", crs="EPSG:4326")

    df = df.rename(columns={"latitude": "LATITUDE", "longitude": "LONGITUDE", "filename": "FILENAME"})
    df = cycleRAP_VA.geoCode(df)
    df = cycleRAP_VA.get_geo_points_by_distance(df, min_distance=10)
    if "geometry" not in df.columns:
        raise ValueError(f"Missing 'geometry' after geocoding for folder '{source_name}'")

    gdf = gpd.GeoDataFrame(df, geometry="geometry", crs="EPSG:4326")
    return cycleRAP_VA.convert_points_to_linestrings(gdf)

def apply_image_namespaces(filename_df, filename_prefix=None):
    """Apply source-folder namespace prefix to FILENAME for multi-folder projects.
    Does not copy any files — images remain in in/ and are resolved at serve time.
    """
    if filename_prefix is None:
        return filename_df
    result_df = filename_df.copy()
    result_df["FILENAME"] = result_df["FILENAME"].apply(
        lambda f: f"{filename_prefix}__{f}"
    )
    return result_df

def build_project_geo_data(src_dir: Path, selection_polygon: Polygon | None = None):
    geo_points = get_image_folder_geo(str(src_dir))
    return _build_project_geo_data_from_points(geo_points, src_dir.name, selection_polygon)

def make_image_namespace(source_name: str) -> str:
    namespace = "".join(ch if ch.isalnum() else "_" for ch in source_name).strip("_")
    return namespace or "source"


def _resolve_image_from_in(pm, project_name: str, filename: str) -> "Path | None":
    """Resolve an image filename to its physical path under in/.

    For single-folder projects the filename is the bare original name.
    For multi-folder projects the filename is '{namespace}__{original}'.
    Namespace is produced by make_image_namespace(source_folder_name).
    Returns None when the image cannot be located.
    """
    try:
        proj = pm.project(project_name)
        source_folders = getattr(proj.metadata, "source_folders", None) or []
        if not source_folders:
            return None

        if len(source_folders) == 1:
            candidate = pm.in_path / source_folders[0] / filename
            if candidate.is_file():
                return candidate
        else:
            if "__" in filename:
                namespace, original = filename.split("__", 1)
                ns_map = {make_image_namespace(sf): sf for sf in source_folders}
                if namespace in ns_map:
                    candidate = pm.in_path / ns_map[namespace] / original
                    if candidate.is_file():
                        return candidate
            # Fallback: try all source folders with the bare filename
            for sf in source_folders:
                candidate = pm.in_path / sf / filename
                if candidate.is_file():
                    return candidate
    except Exception:
        pass
    return None
