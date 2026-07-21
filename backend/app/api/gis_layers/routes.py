"""
GIS Layers Blueprint  (url_prefix: /api/shapefiles)

Serves the shapefiles stored in backend/shapefiles/ to the frontend GIS
Layers page.  The URL prefix is kept as /api/shapefiles so no frontend
changes are needed; only the Python module was renamed to gis_layers to
avoid being swallowed by the backend/.gitignore rule that ignores any
folder named 'shapefiles'.

Endpoints
---------
GET  /api/shapefiles                      – list all shapefiles with metadata
GET  /api/shapefiles/categories           – list category subdirectories
POST /api/shapefiles/geojson              – return GeoJSON for one shapefile
POST /api/shapefiles/upload               – upload new shapefile(s)
POST /api/shapefiles/validate             – validate a shapefile ZIP
POST /api/shapefiles/validate-replacement – check replacement compatibility
PUT  /api/shapefiles/replace              – move uploaded file over existing
DELETE /api/shapefiles/<path>             – delete a shapefile + companions
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
from typing import List

import geopandas as gpd
import fiona
from pyproj import Transformer, CRS
from shapely.geometry import shape, mapping
from flask import Blueprint, jsonify, request
from werkzeug.utils import secure_filename

from app.services.shapefile_validator import ShapefileValidator
from app.services.gis_layer_definition import get_layer_definition
import app.services.paths as paths

bp = Blueprint("gis_layers", __name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

import xml.etree.ElementTree as ET

def _shp_root() -> Path:
    """Absolute path to the BUNDLED backend/shapefiles/.

    Updater-owned and read-only in a packaged install -- see _shp_write_root()
    for where user uploads go.
    """
    return paths.bundled_shapefiles_dir().resolve()


def _shp_write_root() -> Path:
    """Where every write lands: uploads and the .psat_* state files.

    Identical to _shp_root() in a source checkout; a separate user-data dir in a
    packaged install so uploads survive updates and don't need a writable
    install tree.
    """
    root = paths.user_shapefiles_dir()
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    return root.resolve()


def _shp_roots() -> List[Path]:
    """Every root to search for layers, highest precedence first.

    User uploads shadow a bundled layer of the same relative path.
    """
    write_root = _shp_write_root()
    bundled = _shp_root()
    return [write_root] if write_root == bundled else [write_root, bundled]


def _resolve_existing(rel: str) -> Path | None:
    """Find an existing layer file by relative path across all roots."""
    for root in _shp_roots():
        candidate = (root / rel)
        try:
            resolved = candidate.resolve()
            resolved.relative_to(root)
        except (ValueError, OSError):
            continue
        if resolved.exists():
            return resolved
    return None


def _is_bundled_path(p: Path) -> bool:
    """True if p lives in the read-only, updater-owned bundled tree."""
    if _shp_write_root() == _shp_root():
        return False
    try:
        Path(p).resolve().relative_to(_shp_root())
        return True
    except (ValueError, OSError):
        return False


def _bundled_guard(abs_path: Path, action: str):
    """Refuse to mutate a built-in layer; return a response tuple, or None if OK.

    Built-in layers live in the updater-owned tree: the install dir may be
    read-only, and even where it isn't, the next shapefile update would silently
    undo the change. Failing loudly beats either outcome.
    """
    if not _is_bundled_path(abs_path):
        return None
    return jsonify({
        "error": (
            f"Cannot {action} a built-in GIS layer. Built-in layers ship with PSAT "
            "and are replaced by app updates. Upload your own copy instead."
        )
    }), 409


# Subdirectories of backend/shapefiles/ that hold data for OTHER features, not GIS
# layers to list here. ``gradient_profiles`` alone holds ~1300 cached ``.json`` road
# gradient profiles (see routes.py::_load_gradient_profile_catalog) — since ``.json``
# is one of the extensions list_shapefiles() treats as a candidate GIS file, every one
# of those was being opened with fiona (geometry-type probe) + XML-metadata-checked on
# every page load, which is what made /gis-layers slow to load.
_NON_LAYER_DIRS = {"gradient_profiles"}

# In-memory cache of the GET /api/shapefiles response body. list_shapefiles() is hit
# repeatedly (every /gis-layers mount, React StrictMode double-invoke in dev, etc.) and
# the underlying scan is expensive (fiona.open() per file), so the result is cached
# until one of the mutating endpoints below (upload/replace/delete/rename/revert/metadata)
# invalidates it. Safe because those endpoints are the only supported way to change
# backend/shapefiles/ layer content.
_LIST_CACHE: list | None = None


def _invalidate_list_cache() -> None:
    global _LIST_CACHE
    _LIST_CACHE = None


def _dir_size_index(parent: Path) -> dict:
    """One scandir call per directory: {lowercased filename: size in bytes}.

    Used to sum a shapefile's companion-file sizes without doing an exists()+stat()
    syscall pair per companion extension (20 extensions x every .shp file adds up).
    """
    idx: dict = {}
    try:
        with os.scandir(parent) as it:
            for entry in it:
                if entry.is_file():
                    idx[entry.name.lower()] = entry.stat().st_size
    except OSError:
        pass
    return idx

# ── Metadata about each shapefile category ──────────────────────────────
# Maps the folder/category name to its creation year and data source.
# Edit this dictionary to keep the information up to date.
LAYER_METADATA = {
    "AMGbeforeCount":       {"year": "2025", "source": "LTA – Active Mobility Group"},
    "AMGsensorCount":       {"year": "2025", "source": "LTA – Active Mobility Group"},
    "CyclingPath_Jul2024":  {"year": "2024", "source": "LTA / URA – Cycling Path Network"},
    "FootPath_Mar2025":     {"year": "2025", "source": "LTA / NParks – Footpath Network"},
    "LanduseRecre2026":     {"year": "2026", "source": "URA – Master Plan Land Use (Recreation)"},
    "LanduseRural2026":     {"year": "2026", "source": "URA – Master Plan Land Use (Rural)"},
    "LinkID_Shape_File":    {"year": "2024", "source": "ERP2 data"},
    "Mrt_exit":             {"year": "2024", "source": "Geospace"},
    "Planning_area":        {"year": "2024", "source": "URA – Planning Area Boundaries"},
    "Road_name":            {"year": "2024", "source": "LTA – Road Name Layer"},
    "Speed_limit":          {"year": "2024", "source": "Geospace"},
    "area_type":            {"year": "2024", "source": "URA – Area Type Classification"},
    "bus_lane":             {"year": "2024", "source": "Geospace lane marking, extracted Type:A1, A6, A7, L, Q, Q1, Q2, Y"},
    "bus_stop":             {"year": "2024", "source": "Geospace"},
    "bus_shelter":          {"year": "2024", "source": "Geospace"},
    "kerb_line":            {"year": "2024", "source": "LTA – Kerb Line Layer"},
    "parking_lot":          {"year": "2024", "source": "Geospace"},
    "HDB_carpark_lots":     {"year": "2024", "source": "Geospace"},
    "URA_parking_lot":      {"year": "2024", "source": "Geospace"},
    "landuse":              {"year": "2024", "source": "Geospace"},
    "Dgp":                  {"year": "2024", "source": "Geospace"},
    "Road_network_line":    {"year": "2024", "source": "Geospace"},
    "path":                 {"year": "2024", "source": "LTA – Path Centreline Network"},
    "footpath_centreline":  {"year": "2024", "source": "LTA – Footpath Centreline"},
    "shared_path_centreline": {"year": "2024", "source": "LTA – Shared Path Centreline"},
    "cycling_path_centreline": {"year": "2024", "source": "LTA – Cycling Path Centreline"},
    "roadcrossinglayer":    {"year": "2024", "source": "Geospace"},
    "pedestrian_crossing":  {"year": "2024", "source": "Geospace"},
    "LIDAR_scan":           {"year": "2024", "source": "Surveys & Lands Div"},
    "Defects":              {"year": "2024", "source": "PATH"},
}

def _extract_xml_yearStr(shp_path: Path) -> str | None:
    """Attempt to parse `<CreaDate>`, `<ModDate>`, `<SyncDate>`, or `<pubDate>` from native XML metadata."""
    xml_path = shp_path.with_suffix('.shp.xml')
    if not xml_path.exists():
        xml_path = shp_path.with_suffix('.xml')
    
    if xml_path.exists():
        try:
            tree = ET.parse(str(xml_path))
            root = tree.getroot()
            for tag in ['.//CreaDate', './/ModDate', './/SyncDate', './/pubDate']:
                elem = root.find(tag)
                if elem is not None and elem.text and len(elem.text) >= 4:
                    return elem.text[:4] # Format usually 'YYYYMMDD'
        except Exception:
            pass
    return None



def _temp_root() -> Path:
    """Writable temp area for uploads, OUTSIDE the backend/ project tree.

    Critically this must NOT live under backend/. The dev server runs with the
    auto-reloader, and when watchdog is installed Werkzeug watches the backend
    project root recursively for ``*.py``/``*.pyc``/``*.zip`` changes. Extracting
    an uploaded shapefile ``.zip`` into ``backend/temp_uploads/`` therefore fired
    a reload MID-REQUEST, which reset the connection — the shapefile import in
    Create Project failed with a network/error toast for exactly this reason.
    Using the OS temp dir keeps upload churn out of the watched tree entirely.
    """
    p = Path(tempfile.gettempdir()) / "psat_uploads"
    p.mkdir(exist_ok=True)
    return p


def _safe_relative(rel: str) -> Path | None:
    """
    Resolve a relative path string against the shapefile roots.
    Returns None (and should result in a 400) if the resolved path escapes
    every shapefiles directory.

    Searches the user (writable) root first, then the bundled one, so a user
    upload shadows a bundled layer of the same name. A path that does not exist
    in either resolves against the WRITE root, which is where new files belong.
    """
    existing = _resolve_existing(rel)
    if existing is not None:
        return existing

    root = _shp_write_root()
    try:
        resolved = (root / rel).resolve()
        resolved.relative_to(root)  # raises ValueError if outside root
        return resolved
    except (ValueError, Exception):
        return None


def _companion_extensions() -> List[str]:
    return [".shp", ".shx", ".dbf", ".prj", ".cpg", ".sbn", ".sbx",
            ".fbn", ".fbx", ".ain", ".aih", ".ixs", ".mxs", ".atx",
            ".xml", ".qmd", ".geojson", ".json", ".kml", ".kmz", ".gml", ".gpx"]


def _originals_path() -> Path:
    return _shp_write_root() / ".psat_originals.json"

def _load_originals() -> dict:
    p = _originals_path()
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


# ── User-defined metadata overrides (Required Columns / Affects) ───────
# Lets users correct or set the "Required Columns" / "Affects" labels shown
# in the GIS Layers list for layers that don't match a known LayerDefinition
# (e.g. a newly uploaded layer that isn't part of the autocoding pipeline).
# This is display metadata only — it does not change what columns the
# scoring engine actually reads.
KNOWN_AFFECT_PARAMETER_GROUPS = {
    "For Auto Coding": [
        "Facility Width",
        "Curvature",
        "Grade",
        "Road Operating Speed",
        "Road Speed Limit",
        "Number of Lanes – Adjacent Road",
        "Pedestrian Crossing",
        "Crossing Facility",
        "Crossing Type",
        "Peak Pedestrian Flow",
        "Peak Bicycle Traffic Flow",
        "Heavy Vehicle Flow",
        "Adjacent Vehicle Parking",
        "Area Type (Urban)",
        "Area Type (Rural)",
        "Area Type (Recreational)",
        "Area Type (Industrial)",
        "Land Use Type",
        "Loose/Slippery Surface",
        "Major Surface Deformation",
        "Intersection or Road Crossing",
    ],
    "For Area Based Reports": [
        "Road Name Reference",
        "Road Network Node Reference",
        "Area-based Reporting",
    ],
    "For Analysis": [
        "User Counts (Pedestrian/Cyclist)",
    ],
}

# Flattened view — used wherever a plain list of known parameter names is needed.
KNOWN_AFFECT_PARAMETERS = [p for group in KNOWN_AFFECT_PARAMETER_GROUPS.values() for p in group]


def _metadata_overrides_path() -> Path:
    return _shp_write_root() / ".psat_layer_metadata.json"


def _load_metadata_overrides() -> dict:
    p = _metadata_overrides_path()
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save_metadata_overrides(data: dict) -> None:
    _metadata_overrides_path().write_text(json.dumps(data, indent=2), encoding="utf-8")


# ── User-created layer tracking ─────────────────────────────────────────
# Layers uploaded through POST /api/shapefiles/upload are recorded here so
# that only newly-added layers (not the built-in/pre-existing shapefiles)
# can have their Required Columns / Affects metadata edited afterwards.
def _user_created_path() -> Path:
    return _shp_write_root() / ".psat_user_created.json"


def _load_user_created() -> set:
    p = _user_created_path()
    if p.exists():
        try:
            return set(json.loads(p.read_text(encoding="utf-8")))
        except Exception:
            return set()
    return set()


def _save_user_created(paths: set) -> None:
    _user_created_path().write_text(json.dumps(sorted(paths), indent=2), encoding="utf-8")


def _detect_geom_type(shp_path: Path) -> str | None:
    """Read the geometry type from a spatial file's schema without loading all features."""
    try:
        with fiona.open(str(shp_path)) as f:
            raw = (f.schema.get("geometry") or "").replace("3D ", "").strip()
            if "Polygon" in raw:
                return "Polygon"
            if "Line" in raw:
                return "LineString"
            if "Point" in raw:
                return "Point"
    except Exception:
        pass
    return None

def _save_originals(data: dict) -> None:
    _originals_path().write_text(json.dumps(data, indent=2), encoding="utf-8")


def _file_info(
    shp_path: Path,
    root: Path,
    overrides: dict | None = None,
    dir_cache: dict | None = None,
    user_created: set | None = None,
) -> dict:
    """Build a ShapefileInfo dict for one GIS file.

    ``overrides`` (the parsed `.psat_layer_metadata.json`) and ``dir_cache`` (a
    per-directory filename→size index, see `_dir_size_index`) may be preloaded and
    shared across many calls by the caller (`list_shapefiles`) to avoid re-reading the
    same override file and re-stat'ing the same directory once per shapefile. Both
    default to None so single-shot callers (`set_layer_metadata`) still work standalone.
    """
    rel = shp_path.relative_to(root)
    category = rel.parts[0] if len(rel.parts) > 1 else "uncategorised"
    stat = shp_path.stat()

    # For shapefiles (.shp) sum all companion files; for others just use file size
    if shp_path.suffix.lower() == ".shp":
        if dir_cache is not None:
            idx = dir_cache.get(shp_path.parent)
            if idx is None:
                idx = _dir_size_index(shp_path.parent)
                dir_cache[shp_path.parent] = idx
        else:
            idx = _dir_size_index(shp_path.parent)
        stem_lower = shp_path.stem.lower()
        total_size = sum(idx.get(stem_lower + ext, 0) for ext in _companion_extensions())
    else:
        total_size = stat.st_size
    
    # Grab metadata fallbacks from predefined mappings based on category
    layer_meta = LAYER_METADATA.get(category, {})
    fallback_source = layer_meta.get("source", category.replace("_", " ").title())
    fallback_year = layer_meta.get("year", None)

    # 1. Native XML exact metadata year takes priority
    xml_year = _extract_xml_yearStr(shp_path)
    if xml_year:
        year = xml_year
    elif fallback_year:
        # 2. Existing internal mapping fallback year
        year = fallback_year
    else:
        # 3. File upload/mtime fallback year
        year = str(datetime.fromtimestamp(stat.st_mtime).year)
    
    # Resolve detailed layer definition
    # Use category as the key, but handle the 'path' subfolder specifically
    ld_key = category
    if category == "path":
        fname_lower = shp_path.name.lower()
        if "cycling" in fname_lower:
            ld_key = "cycling_path"
        elif "shared" in fname_lower:
            ld_key = "shared_path"
        elif "foot" in fname_lower:
            ld_key = "footpath"
    elif category == "area_type":
        fname_lower = shp_path.name.lower()
        if "central" in fname_lower:
            ld_key = "Centralmb2025"
    elif category == "LinkID_Shape_File":
        fname_lower = shp_path.name.lower()
        if "node" in fname_lower:
            ld_key = "LinkID_Node"
    elif category == "CyclingPath_Jul2024":
        fname_lower = shp_path.name.lower()
        if "gazette" in fname_lower:
            ld_key = "CyclingPathGazette"
    elif category == "parking_lot":
        fname_lower = shp_path.name.lower()
        if "hdb" in fname_lower:
            ld_key = "HDB_CAR_PARK_LOTS"
    elif category == "bus_stop":
        fname_lower = shp_path.name.lower()
        if "shelter" in fname_lower:
            ld_key = "BusShelter"
    
    ld = get_layer_definition(ld_key)
    req_cols = ", ".join(ld.required_columns) if ld and ld.required_columns else "None"
    affects = ld.description if ld else "Unknown"

    # A user-set override (via /api/shapefiles/metadata) always wins over the
    # guessed/hardcoded values above — needed for layers that don't fit any
    # known LayerDefinition.
    override = (overrides if overrides is not None else _load_metadata_overrides()).get(rel.as_posix())
    is_custom_metadata = False
    if override:
        req_cols = override.get("required_columns") or req_cols
        affects = override.get("affects") or affects
        is_custom_metadata = True
    
    # Detect geometry type from the actual file first (reads schema only, not all features)
    geom_type_str = _detect_geom_type(shp_path)
    if geom_type_str is None:
        # Fall back to layer definition if file detection fails
        if ld and ld.geometry_types:
            raw = ld.geometry_types[0]
            if "Polygon" in raw:
                geom_type_str = "Polygon"
            elif "Line" in raw:
                geom_type_str = "LineString"
            elif "Point" in raw:
                geom_type_str = "Point"
            else:
                geom_type_str = raw
        else:
            geom_type_str = "Unknown"

    # Use stem for display name, replacing underscores with spaces
    display_name = shp_path.stem.replace("_", " ").title()

    return {
        "name": display_name,
        "filename": shp_path.name,
        "base_name": shp_path.stem,
        "path": rel.as_posix(),
        "category": category,
        "size": total_size,
        "type": "Shapefile" if shp_path.suffix.lower() == ".shp" else shp_path.suffix.lstrip(".").upper(),
        "geom_type": geom_type_str,
        "year": year,
        "source": fallback_source,
        "required_columns": req_cols,
        "affects": affects,
        "is_custom_metadata": is_custom_metadata,
        "user_created": rel.as_posix() in (user_created if user_created is not None else _load_user_created()),
    }


# ---------------------------------------------------------------------------
# GET /api/shapefiles
# ---------------------------------------------------------------------------

@bp.get("")
def list_shapefiles():
    """Return metadata for every .shp file found under backend/shapefiles/."""
    global _LIST_CACHE
    if _LIST_CACHE is not None:
        return jsonify(_LIST_CACHE)

    roots = [r for r in _shp_roots() if r.exists()]
    if not roots:
        return jsonify([])

    originals = _load_originals()
    overrides = _load_metadata_overrides()
    user_created = _load_user_created()
    dir_cache: dict = {}
    changed = False
    results = []
    seen_rel: set = set()

    gis_exts = [".shp", ".geojson", ".kml", ".kmz", ".gml", ".gpx", ".json"]
    # Roots are ordered highest-precedence first, so a user upload shadows a
    # bundled layer with the same relative path.
    for root in roots:
        for p in root.rglob("*"):
            if not p.is_file():
                continue
            if p.suffix.lower() not in gis_exts:
                continue
            rel_parts = p.relative_to(root).parts
            if any(part.startswith("temp") or part in _NON_LAYER_DIRS for part in rel_parts):
                continue
            if p.name.startswith("."):
                continue

            info = _file_info(p, root, overrides=overrides, dir_cache=dir_cache, user_created=user_created)
            rel_posix = info["path"]
            if rel_posix in seen_rel:
                continue
            seen_rel.add(rel_posix)
            if rel_posix not in originals:
                originals[rel_posix] = p.stem
                changed = True
            orig_stem = originals[rel_posix]
            info["original_name"] = orig_stem.replace("_", " ").title()
            info["is_renamed"] = (orig_stem != p.stem)
            results.append(info)

    if changed:
        _save_originals(originals)

    _LIST_CACHE = results
    return jsonify(results)


# ---------------------------------------------------------------------------
# GET /api/shapefiles/categories
# ---------------------------------------------------------------------------

@bp.get("/categories")
def list_categories():
    """Return one entry per immediate subdirectory of backend/shapefiles/."""
    # Merge categories across the user and bundled roots; a category present in
    # both reports the combined shapefile count.
    counts: dict = {}
    for root in _shp_roots():
        if not root.exists():
            continue
        for d in root.iterdir():
            if not d.is_dir() or d.name.startswith("temp") or d.name in _NON_LAYER_DIRS:
                continue
            counts[d.name] = counts.get(d.name, 0) + sum(1 for _ in d.glob("*.shp"))

    cats = [
        {"name": name, "shapefile_count": count, "path": name}
        for name, count in sorted(counts.items())
    ]
    return jsonify(cats)


# ---------------------------------------------------------------------------
# POST /api/shapefiles/geojson
# ---------------------------------------------------------------------------

def _read_shapefile_as_geojson(full_path, max_features=5000):
    features = []
    with fiona.open(full_path) as src:
        src_crs = CRS(src.crs) if src.crs else None
        transformer = None
        if src_crs and src_crs.to_epsg() != 4326:
            transformer = Transformer.from_crs(src_crs, CRS.from_epsg(4326), always_xy=True)

        count = 0
        for feat in src:
            if count >= max_features:
                break
            geom = shape(feat["geometry"])
            if transformer:
                from shapely.ops import transform
                geom = transform(transformer.transform, geom)

            props = {}
            for k, v in (feat.get("properties") or {}).items():
                if v is None:
                    props[k] = None
                elif isinstance(v, (int, float, str, bool)):
                    if isinstance(v, float) and (v != v or v == float("inf") or v == float("-inf")):
                        props[k] = None
                    else:
                        props[k] = v
                else:
                    props[k] = str(v)

            features.append({
                "type": "Feature",
                "geometry": mapping(geom),
                "properties": props,
            })
            count += 1
    return {
        "type": "FeatureCollection",
        "features": features,
    }


@bp.post("/geojson")
def get_geojson():
    """
    Read a shapefile and return its features as GeoJSON (WGS84).

    Body: { "path": "relative/path.shp", "max_features": 10000 }
    """
    body = request.get_json(force=True, silent=True) or {}
    rel = body.get("path", "")
    max_features = int(body.get("max_features", 10000))

    if not rel:
        return jsonify({"error": "path is required"}), 400

    if Path(rel).name.startswith("._"):
        return jsonify({"error": "Not a valid shapefile"}), 400

    abs_path = _safe_relative(rel)
    if abs_path is None or not abs_path.exists():
        return jsonify({"error": f"Shapefile not found: {rel}"}), 404

    try:
        geojson = _read_shapefile_as_geojson(str(abs_path), max_features)
        return jsonify(geojson)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------------------------------
# POST /api/shapefiles/validate
# ---------------------------------------------------------------------------

@bp.post("/validate")
def validate_shapefile():
    """
    Validate an uploaded ZIP containing a shapefile.

    Form field: file  (ZIP archive)
    """
    uploaded = request.files.get("file")
    if not uploaded:
        return jsonify({"valid": False, "error": "No file uploaded"}), 400

    tmp_dir = Path(tempfile.mkdtemp(dir=_temp_root()))
    try:
        zip_path = tmp_dir / uploaded.filename
        uploaded.save(str(zip_path))

        if not zipfile.is_zipfile(str(zip_path)):
            return jsonify({"valid": False, "error": "File is not a valid ZIP archive"}), 400

        with zipfile.ZipFile(str(zip_path)) as zf:
            zf.extractall(str(tmp_dir))

        shp_files = list(tmp_dir.rglob("*.shp"))
        if not shp_files:
            return jsonify({"valid": False, "error": "No .shp file found in ZIP"}), 400

        results = []
        for shp in shp_files:
            missing = [
                ext for ext in [".shx", ".dbf"]
                if not shp.with_suffix(ext).exists()
            ]
            meta: dict = {}
            valid_shp = not missing
            if valid_shp:
                try:
                    gdf = gpd.read_file(str(shp))
                    bounds = gdf.total_bounds
                    meta = {
                        "feature_count": len(gdf),
                        "crs": str(gdf.crs) if gdf.crs else "None",
                        "bounds": {
                            "minx": float(bounds[0]), "miny": float(bounds[1]),
                            "maxx": float(bounds[2]), "maxy": float(bounds[3]),
                        },
                        "columns": [c for c in gdf.columns if c != "geometry"],
                        "geometry_type": list(gdf.geometry.geom_type.unique()),
                    }
                except Exception as e:
                    valid_shp = False
                    missing.append(f"read error: {e}")

            results.append({
                "name": shp.name,
                "valid": valid_shp,
                "missing_files": missing,
                "present_files": [shp.name],
                "metadata": meta,
            })

        all_valid = all(r["valid"] for r in results)
        return jsonify({"valid": all_valid, "shapefiles": results})

    finally:
        shutil.rmtree(str(tmp_dir), ignore_errors=True)


# ---------------------------------------------------------------------------
# POST /api/shapefiles/validate-replacement
# ---------------------------------------------------------------------------

@bp.post("/validate-replacement")
def validate_replacement():
    """
    Check whether an uploaded shapefile is compatible with the one it would replace.

    Body: { "new_file_path": "...", "target_file_path": "...", "layer_name": "..." }
    Paths are relative to backend/shapefiles/.
    """
    body = request.get_json(force=True, silent=True) or {}
    new_rel = body.get("new_file_path", "")
    target_rel = body.get("target_file_path", "")
    layer_name = body.get("layer_name")

    if not new_rel or not target_rel:
        return jsonify({"valid": False, "errors": ["new_file_path and target_file_path are required"]}), 400

    new_abs = _safe_relative(new_rel)
    target_abs = _safe_relative(target_rel)

    if new_abs is None or not new_abs.exists():
        return jsonify({"valid": False, "errors": [f"New file not found: {new_rel}"]}), 404
    if target_abs is None or not target_abs.exists():
        return jsonify({"valid": False, "errors": [f"Target file not found: {target_rel}"]}), 404

    result = ShapefileValidator.validate_replacement(
        str(new_abs), str(target_abs), layer_name
    )
    return jsonify(result)


# ---------------------------------------------------------------------------
# POST /api/shapefiles/preview-upload
# ---------------------------------------------------------------------------

@bp.post("/preview-upload")
def preview_upload():
    """
    Accept uploaded shapefile files, parse to GeoJSON, and return.
    Nothing is saved permanently — temp files are deleted immediately.
    """
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "No files received"}), 400

    uploaded_names = [f.filename for f in files if f.filename]

    tmp_dir = Path(tempfile.mkdtemp(dir=_temp_root()))
    try:
        for f in files:
            safe_name = secure_filename(f.filename) or "upload_file"
            tmp_path = tmp_dir / safe_name
            f.save(str(tmp_path))

            if tmp_path.suffix.lower() == ".zip":
                try:
                    with zipfile.ZipFile(str(tmp_path)) as zf:
                        zf.extractall(str(tmp_dir))
                except zipfile.BadZipFile:
                    return jsonify({"error": f"'{f.filename}' is not a valid .zip archive. Re-export or re-zip the shapefile and try again."}), 400

        shp_files = list(tmp_dir.rglob("*.shp"))
        if not shp_files:
            names = ", ".join(uploaded_names) if uploaded_names else "the upload"
            return jsonify({"error": f"No .shp file was found in {names}. A shapefile needs a .shp file (plus its .dbf and .shx companions). Upload a .zip containing all parts, or select the .shp together with its companion files."}), 400

        # A .shp is unreadable without its .shx (index) and .dbf (attributes).
        # Detect this up-front so the user gets an actionable message instead of
        # a cryptic fiona/GDAL error.
        shp = shp_files[0]
        missing = [ext for ext in (".shx", ".dbf") if not shp.with_suffix(ext).exists()]
        if missing:
            missing_str = ", ".join(missing)
            return jsonify({"error": f"'{shp.name}' is missing its companion file(s): {missing_str}. Upload the whole shapefile set (.shp, .shx, .dbf, .prj) together — a single .shp cannot be read on its own. Zipping the folder is the most reliable way."}), 400

        geojson = _read_shapefile_as_geojson(str(shp), max_features=5000)
    except Exception as e:
        import traceback
        detail = str(e).strip() or e.__class__.__name__
        return jsonify({
            "error": f"Could not read the shapefile: {detail}. Check that the .shp, .shx, .dbf and .prj files are all present and not corrupted.",
            "traceback": traceback.format_exc(),
        }), 500
    finally:
        shutil.rmtree(str(tmp_dir), ignore_errors=True)

    return jsonify(geojson)


# ---------------------------------------------------------------------------
# POST /api/shapefiles/upload
# ---------------------------------------------------------------------------

@bp.post("/upload")
def upload_shapefiles():
    """
    Upload one or more shapefiles (or a ZIP) into a category subdirectory.

    Form fields:
        files    – one or more files (.shp + companions, or a .zip)
        category – destination subdirectory name (default: "uncategorised")
    """
    files = request.files.getlist("files")
    if not files:
        return jsonify({"uploaded": [], "errors": ["No files received"], "count": 0}), 400

    category = request.form.get("category", "uncategorised").strip().replace("..", "")
    dest_dir = _shp_write_root() / category
    dest_dir.mkdir(parents=True, exist_ok=True)

    uploaded, errors = [], []
    tmp_dir = Path(tempfile.mkdtemp(dir=_temp_root()))

    try:
        for f in files:
            safe_name = secure_filename(f.filename) or "upload_file"
            tmp_path = tmp_dir / safe_name
            f.save(str(tmp_path))

            if tmp_path.suffix.lower() == ".zip":
                # Extract ZIP
                try:
                    with zipfile.ZipFile(str(tmp_path)) as zf:
                        zf.extractall(str(dest_dir))
                    for shp in dest_dir.rglob("*.shp"):
                        uploaded.append({"name": shp.stem, "category": category, "path": shp.relative_to(_shp_root()).as_posix()})
                except Exception as e:
                    errors.append(f"{f.filename}: {e}")
            else:
                dest = dest_dir / safe_name
                shutil.copy2(str(tmp_path), str(dest))
                if tmp_path.suffix.lower() in [".shp", ".geojson", ".kml", ".kmz", ".gml", ".gpx", ".json"]:
                    uploaded.append({"name": tmp_path.stem, "category": category, "path": (category + "/" + safe_name)})
    finally:
        shutil.rmtree(str(tmp_dir), ignore_errors=True)

    if uploaded:
        user_created = _load_user_created()
        user_created.update(item["path"] for item in uploaded)
        _save_user_created(user_created)
        _invalidate_list_cache()
    return jsonify({"uploaded": uploaded, "errors": errors, "count": len(uploaded)})


# ---------------------------------------------------------------------------
# PUT /api/shapefiles/replace
# ---------------------------------------------------------------------------

@bp.put("/replace")
def replace_shapefiles():
    """
    Replace existing shapefiles with previously uploaded ones.

    Body: { "replacements": [{ "uploaded_path": "...", "target_path": "..." }] }
    Both paths are relative to backend/shapefiles/.
    """
    body = request.get_json(force=True, silent=True) or {}
    replacements = body.get("replacements", [])
    if not replacements:
        return jsonify({"replaced": [], "errors": ["No replacements specified"], "count": 0}), 400

    replaced, errors = [], []

    for item in replacements:
        src_rel = item.get("uploaded_path", "")
        tgt_rel = item.get("target_path", "")

        src_abs = _safe_relative(src_rel)
        tgt_abs = _safe_relative(tgt_rel)

        if src_abs is None or not src_abs.exists():
            errors.append(f"Source not found: {src_rel}")
            continue
        if tgt_abs is None:
            errors.append(f"Invalid target path: {tgt_rel}")
            continue
        if _is_bundled_path(tgt_abs):
            errors.append(
                f"Cannot replace built-in layer '{tgt_rel}' — built-in layers are "
                "replaced by app updates. Upload it as a new layer instead."
            )
            continue

        try:
            # Back up the existing file before overwriting
            backup = tgt_abs.with_suffix(tgt_abs.suffix + ".bak")
            if tgt_abs.exists():
                shutil.copy2(str(tgt_abs), str(backup))

            # Copy all companion files that exist alongside the source
            stem = src_abs.stem
            for ext in _companion_extensions():
                src_comp = src_abs.with_suffix(ext)
                tgt_comp = tgt_abs.with_suffix(ext)
                if src_comp.exists():
                    shutil.copy2(str(src_comp), str(tgt_comp))

            replaced.append({
                "target": tgt_rel,
                "status": "replaced",
                "backup": backup.name,
            })
        except Exception as e:
            errors.append(f"{tgt_rel}: {e}")

    if replaced:
        _invalidate_list_cache()
    return jsonify({"replaced": replaced, "errors": errors, "count": len(replaced)})


# ---------------------------------------------------------------------------
# DELETE /api/shapefiles/<path:shapefile_path>
# ---------------------------------------------------------------------------

@bp.delete("/<path:shapefile_path>")
def delete_shapefile(shapefile_path: str):
    """
    Delete a shapefile and all its companion files (.shx, .dbf, .prj, etc.)

    URL param: relative path, e.g. area_type/Central.shp
    """
    abs_path = _safe_relative(shapefile_path)
    if abs_path is None or not abs_path.exists():
        return jsonify({"error": f"Shapefile not found: {shapefile_path}"}), 404

    guard = _bundled_guard(abs_path, "delete")
    if guard is not None:
        return guard

    deleted = []
    for ext in _companion_extensions():
        companion = abs_path.with_suffix(ext)
        if companion.exists():
            companion.unlink()
            deleted.append(companion.name)

    originals = _load_originals()
    if shapefile_path in originals:
        originals.pop(shapefile_path)
        _save_originals(originals)

    overrides = _load_metadata_overrides()
    if shapefile_path in overrides:
        overrides.pop(shapefile_path)
        _save_metadata_overrides(overrides)

    user_created = _load_user_created()
    if shapefile_path in user_created:
        user_created.discard(shapefile_path)
        _save_user_created(user_created)

    if deleted:
        _invalidate_list_cache()
    return jsonify({"message": f"Deleted {len(deleted)} file(s)", "deleted_files": deleted})


# ---------------------------------------------------------------------------
# GET /api/shapefiles/parameter-options
# ---------------------------------------------------------------------------

@bp.get("/parameter-options")
def get_parameter_options():
    """Return the curated parameter tags offered in the 'Affects' picker, grouped by category."""
    return jsonify(KNOWN_AFFECT_PARAMETER_GROUPS)


# ---------------------------------------------------------------------------
# POST /api/shapefiles/metadata
# ---------------------------------------------------------------------------

@bp.post("/metadata")
def set_layer_metadata():
    """
    Set a user-defined override for a layer's displayed 'Required Columns' /
    'Affects' metadata. This does not change what the scoring engine reads —
    it only corrects the informational labels shown in the GIS Layers list.

    Body: {
        "path": "category/file.shp",
        "required_columns": "COL_A, COL_B",   # optional, free text
        "affects": ["Facility Width", "Curvature", "My Custom Parameter"]
    }
    """
    body = request.get_json(force=True, silent=True) or {}
    shapefile_path = (body.get("path") or "").strip()
    required_columns = (body.get("required_columns") or "").strip()
    affects_list = body.get("affects") or []

    if not shapefile_path:
        return jsonify({"error": "path is required"}), 400
    if not isinstance(affects_list, list):
        return jsonify({"error": "affects must be a list of strings"}), 400

    abs_path = _safe_relative(shapefile_path)
    if abs_path is None or not abs_path.exists():
        return jsonify({"error": f"Shapefile not found: {shapefile_path}"}), 404

    if shapefile_path not in _load_user_created():
        return jsonify({
            "error": "Only newly uploaded layers can have their Required Columns / Affects edited."
        }), 403

    affects_str = ", ".join(str(a).strip() for a in affects_list if str(a).strip())
    if not required_columns and not affects_str:
        return jsonify({"error": "Provide at least one of required_columns or affects"}), 400

    overrides = _load_metadata_overrides()
    overrides[shapefile_path] = {
        "required_columns": required_columns,
        "affects": affects_str,
    }
    _save_metadata_overrides(overrides)
    _invalidate_list_cache()

    root = _shp_root()
    return jsonify({"message": "Layer metadata updated", "info": _file_info(abs_path, root)})


# ---------------------------------------------------------------------------
# POST /api/shapefiles/rename
# ---------------------------------------------------------------------------

@bp.post("/rename")
def rename_shapefile():
    """
    Rename a shapefile and all its companion files to a new stem.

    Body: {"path": "category/file.shp", "new_name": "NewName"}
    """
    import re

    body = request.get_json(force=True, silent=True) or {}
    shapefile_path = (body.get("path") or "").strip()
    new_name = (body.get("new_name") or "").strip()

    if not shapefile_path:
        return jsonify({"error": "path is required"}), 400
    if not new_name:
        return jsonify({"error": "new_name is required"}), 400

    safe_name = re.sub(r"[^\w\s\-.]", "", new_name).strip()
    if not safe_name:
        return jsonify({"error": "Invalid name — use letters, numbers, spaces, hyphens or dots"}), 400

    abs_path = _safe_relative(shapefile_path)
    if abs_path is None or not abs_path.exists():
        return jsonify({"error": f"Shapefile not found: {shapefile_path}"}), 404

    guard = _bundled_guard(abs_path, "rename")
    if guard is not None:
        return guard

    # Load originals before rename so we can preserve the original stem
    originals = _load_originals()
    orig_stem = originals.get(shapefile_path, abs_path.stem)

    parent = abs_path.parent
    renamed = []
    file_suffix = abs_path.suffix.lower()

    if file_suffix == ".shp":
        # For shapefiles, rename all companion files together
        for ext in _companion_extensions():
            companion = abs_path.with_suffix(ext)
            if companion.exists():
                new_file = parent / (safe_name + ext)
                companion.rename(new_file)
                renamed.append(new_file.name)
        new_rel = (parent / (safe_name + ".shp")).relative_to(_shp_root()).as_posix()
    else:
        # For single GIS files (.geojson, .kml, etc.), just rename the one file
        new_file = parent / (safe_name + file_suffix)
        abs_path.rename(new_file)
        renamed.append(new_file.name)
        new_rel = new_file.relative_to(_shp_root()).as_posix()

    # Update originals registry: remap old path -> new path, keep original stem
    originals.pop(shapefile_path, None)
    if orig_stem != safe_name:
        originals[new_rel] = orig_stem
    _save_originals(originals)

    # Remap any metadata override to follow the file's new path
    overrides = _load_metadata_overrides()
    if shapefile_path in overrides:
        overrides[new_rel] = overrides.pop(shapefile_path)
        _save_metadata_overrides(overrides)

    # Remap the user-created marker so the layer stays editable under its new path
    user_created = _load_user_created()
    if shapefile_path in user_created:
        user_created.discard(shapefile_path)
        user_created.add(new_rel)
        _save_user_created(user_created)

    _invalidate_list_cache()
    return jsonify({"message": f"Renamed {len(renamed)} file(s)", "new_path": new_rel, "renamed_files": renamed})


# ---------------------------------------------------------------------------
# POST /api/shapefiles/revert
# ---------------------------------------------------------------------------

@bp.post("/revert")
def revert_shapefile():
    """
    Revert a renamed shapefile back to its original stem.

    Body: {"path": "category/current_file.shp"}
    """
    body = request.get_json(force=True, silent=True) or {}
    shapefile_path = (body.get("path") or "").strip()

    if not shapefile_path:
        return jsonify({"error": "path is required"}), 400

    originals = _load_originals()
    if shapefile_path not in originals:
        return jsonify({"error": "No original name record found for this shapefile"}), 404

    original_stem = originals[shapefile_path]
    abs_path = _safe_relative(shapefile_path)
    if abs_path is None or not abs_path.exists():
        return jsonify({"error": f"Shapefile not found: {shapefile_path}"}), 404

    if abs_path.stem == original_stem:
        originals.pop(shapefile_path, None)
        _save_originals(originals)
        _invalidate_list_cache()
        return jsonify({"message": "Already at original name", "new_path": shapefile_path})

    parent = abs_path.parent
    renamed = []
    for ext in _companion_extensions():
        companion = abs_path.with_suffix(ext)
        if companion.exists():
            new_file = parent / (original_stem + ext)
            companion.rename(new_file)
            renamed.append(new_file.name)

    new_rel = (parent / (original_stem + ".shp")).relative_to(_shp_root()).as_posix()
    originals.pop(shapefile_path, None)
    _save_originals(originals)

    overrides = _load_metadata_overrides()
    if shapefile_path in overrides:
        overrides[new_rel] = overrides.pop(shapefile_path)
        _save_metadata_overrides(overrides)

    user_created = _load_user_created()
    if shapefile_path in user_created:
        user_created.discard(shapefile_path)
        user_created.add(new_rel)
        _save_user_created(user_created)

    _invalidate_list_cache()
    return jsonify({"message": f"Reverted {len(renamed)} file(s)", "new_path": new_rel, "renamed_files": renamed})
