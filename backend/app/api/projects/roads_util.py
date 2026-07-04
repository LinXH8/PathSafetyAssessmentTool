"""Road-network and planning-area shapefile accessors (lazy, cached).

Provides the cached GeoDataFrame singletons for road sections and planning
areas plus road-name / download-folder resolution helpers. Used by the GIS
query routes and source-folder suggestions."""
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



_ROAD_SECTIONS_GDF: gpd.GeoDataFrame | None = None
_PLANNING_AREAS_GDF: gpd.GeoDataFrame | None = None
_KNOWN_ROAD_NAMES: list[str] | None = None
_QUARTER_SUFFIX_RE = re.compile(r"(?:[_\-\s]+(?:[1-4]Q\d{4}|Q[1-4]\d{4}))(?:__\d+)?$", re.IGNORECASE)


def _get_road_sections_gdf() -> gpd.GeoDataFrame:
    global _ROAD_SECTIONS_GDF
    if _ROAD_SECTIONS_GDF is not None:
        return _ROAD_SECTIONS_GDF

    backend_root = Path(__file__).resolve().parents[3]
    road_shp_candidates = [
        backend_root / "shapefiles" / "planningareas" / "ROADSECTIONLINE.shp",
        backend_root / "shapefiles" / "Road_name" / "ROADSECTIONLINE.shp",
        backend_root / "shapefiles" / "Road_name" / "ROADNETWORKLINE.shp",
    ]
    road_shp = next((candidate for candidate in road_shp_candidates if candidate.exists()), None)
    if road_shp is None:
        raise FileNotFoundError("No road sections shapefile found")

    gdf = gpd.read_file(str(road_shp))
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)

    _ROAD_SECTIONS_GDF = gdf
    return _ROAD_SECTIONS_GDF


def _get_planning_areas_gdf() -> gpd.GeoDataFrame:
    global _PLANNING_AREAS_GDF
    if _PLANNING_AREAS_GDF is not None:
        return _PLANNING_AREAS_GDF

    backend_root = Path(__file__).resolve().parents[3]
    planning_shp = backend_root / "shapefiles" / "planningareas" / "G_MP25_PLNG_AREA_NO_SEA_PL.shp"
    if not planning_shp.exists():
        raise FileNotFoundError("Planning areas shapefile not found")

    gdf = gpd.read_file(str(planning_shp))
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)

    _PLANNING_AREAS_GDF = gdf
    return _PLANNING_AREAS_GDF


def _available_road_names(in_path: Path) -> set:
    """Return the set of road name bases available in the download folder.

    Folder names carry optional suffixes separated by underscores
    (e.g. ``AMK AVE 1_1Q2026``). Singapore road names never contain
    underscores, so the base is everything before the first ``_``,
    uppercased. Checking membership in this set is the correct
    availability test for roads whose names come from a reference
    CSV or shapefile (which only carry the clean road name).
    """
    if not in_path.exists():
        return set()
    result: set = set()
    for entry in in_path.iterdir():
        if entry.is_dir():
            base = entry.name.split("_")[0].strip().upper()
            if base:
                result.add(base)
    return result


def _available_road_folders(in_path: Path) -> dict:
    """Map each road-name base to the actual download folder(s) that provide it.

    Folder names carry optional quarter/segment suffixes
    (e.g. ``TPY Lor 4_1Q2026``) that are absent from the clean road names in the
    reference CSV / shapefile. This returns
    ``{ "TPY LOR 4": ["TPY Lor 4_1Q2026", ...] }`` keyed by the uppercased base
    (everything before the first ``_``) so a road can be resolved to its real,
    createable folder name(s) — possibly several when multiple survey quarters
    have been downloaded.
    """
    result: dict[str, list[str]] = {}
    if not in_path.exists():
        return result
    for entry in sorted(in_path.iterdir(), key=lambda p: p.name):
        if entry.is_dir():
            base = entry.name.split("_")[0].strip().upper()
            if base:
                result.setdefault(base, []).append(entry.name)
    return result


def _pretty_folder_label(folder_name: str) -> str:
    """Render a download folder name for display, turning a trailing quarter
    suffix (``TPY Lor 4_1Q2026``) into a parenthesised label
    (``TPY Lor 4 (1Q2026)``). Folders without a quarter suffix are returned
    unchanged.
    """
    match = _QUARTER_SUFFIX_RE.search(folder_name)
    if not match:
        return folder_name
    base = folder_name[: match.start()].rstrip(" _-")
    suffix = match.group(0).lstrip(" _-")
    return f"{base} ({suffix})" if base and suffix else folder_name


def _get_known_road_names() -> list[str]:
    global _KNOWN_ROAD_NAMES
    if _KNOWN_ROAD_NAMES is not None:
        return _KNOWN_ROAD_NAMES

    known_names: set[str] = set()
    backend_root = Path(__file__).resolve().parents[3]

    ref_csv_candidates = [
        backend_root / "shapefiles" / "road_reference.csv",
        backend_root / "app" / "shapefiles" / "road_reference.csv",
    ]
    ref_csv = next((candidate for candidate in ref_csv_candidates if candidate.exists()), None)

    if ref_csv is not None:
        import csv

        try:
            with open(ref_csv, newline="", encoding="utf-8-sig") as handle:
                reader = csv.DictReader(handle)
                for row in reader:
                    name = str(row.get("road_name", "")).strip()
                    if name:
                        known_names.add(name)
        except Exception as exc:
            current_app.logger.warning("Failed to read road_reference.csv for folder suggestions: %s", exc)

    try:
        road_gdf = _get_road_sections_gdf()
        road_name_col = next(
            (c for c in ("RD_NAM", "RD_NAME", "ROAD_NAME", "NAME", "RD_CD_DESC") if c in road_gdf.columns),
            None,
        )
        if road_name_col is not None:
            for raw_name in road_gdf[road_name_col].dropna().astype(str):
                name = raw_name.strip()
                if name and any(ch.isalnum() for ch in name):
                    known_names.add(name)
    except Exception as exc:
        current_app.logger.warning("Failed to read road shapefile for folder suggestions: %s", exc)

    _KNOWN_ROAD_NAMES = sorted(known_names)
    return _KNOWN_ROAD_NAMES
