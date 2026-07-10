"""Autocode routes: CV image autocode, GIS autocode and the bulk autocode driver."""
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

from ._helpers import _ensure_models_ready, _get_gis, _get_segment_midpoint, df_to_records, fail, get_ctx, ok, with_project
from .gradient import _inject_grade
from .image_utils import _resolve_image_from_in
from . import _helpers



def _cv_autocode_core(pm, project_name: str, image_ref: str, skip_obstacles: bool = False) -> dict:
    """Resolve image path and run YOLO CV inference. Returns updates dict.
    Caller must call _ensure_models_ready() first.
    Does NOT call _inject_grade (caller's responsibility to avoid double-injection in bulk).
    Raises FileNotFoundError if image is missing, or any model exception on failure.
    """
    legacy_path = (pm.des_path / project_name / global_var.PROJECT_IMAGES_FOLDER / image_ref).resolve()
    if legacy_path.is_file():
        img_path = legacy_path
    else:
        img_path = _resolve_image_from_in(pm, project_name, image_ref)
    if img_path is None or not img_path.exists():
        raise FileNotFoundError(f"image not found: {image_ref}")

    _helpers._INFERENCE_DEPTH += 1
    try:
        updates = cv_pred.CycleRAP_Coding_Helper.autocode(img_path, skip_obstacles=skip_obstacles) or {}
    finally:
        _helpers._INFERENCE_DEPTH -= 1
    return {k: v for k, v in updates.items() if v is not None}


@bp.post("/<project_name>/autocode/image")
def autocode_image(project_name: str):
    logger.debug(f"[Autocode] >>> autocode_image called for project='{project_name}'")
    try:
        _ensure_models_ready()
        ctx = get_ctx()
        pm = ctx["pm"]
        payload = request.get_json(force=True, silent=True) or {}
        image_ref = payload.get("imageRef")
        if not image_ref:
            return fail("imageRef is required", 400)
        skip_obstacles = bool(payload.get("skipObstacles", False))
        logger.debug(f"[Autocode] CV inference: {image_ref} (skip_obstacles={skip_obstacles})")
        updates = _cv_autocode_core(pm, project_name, image_ref, skip_obstacles)
        logger.debug(f"[Autocode] CV done: {image_ref} → {len(updates)} field(s) set")

        gradient_pct = _inject_grade(image_ref, updates, project_name=project_name)
        resp: dict = {"updates": updates, "changed_fields": list(updates.keys())}
        if gradient_pct is not None:
            resp["gradient_pct"] = round(gradient_pct, 3)
        return ok(resp)

    except FileNotFoundError as e:
        return fail(str(e), 404)
    except ServiceUnavailable as e:
        return fail(str(e), 503)
    except Exception as e:
        traceback.print_exc()
        return fail(f"autocode_image error: {e}", 500)


def _gis_autocode_core(coords, fields_filter=None) -> dict:
    """Run all spatial GIS queries for a single segment. Returns updates dict.
    Raises ValueError if coords is missing/malformed, ServiceUnavailable if GIS
    layer is not loaded, or any other exception on spatial query failure.
    """
    if not coords or not isinstance(coords, list) or not isinstance(coords[0], list):
        raise ValueError("coords (LineString) is required")

    start_lon, start_lat = coords[0]
    from shapely.geometry import Point
    pt = Point(start_lon, start_lat)
    curvature_pt = _get_segment_midpoint(coords)

    _needs = lambda *flds: not fields_filter or any(f in fields_filter for f in flds)
    _gis = _get_gis()

    updates: dict = {}

    if _needs("Peak pedestrian flow along or across facility") and _gis.is_mrt(pt):
        updates["Peak pedestrian flow along or across facility"] = 3
    if _needs("Heavy vehicle flow") and _gis.is_bus_lane(pt):
        updates["Heavy vehicle flow"] = 2
    if _needs("Adjacent Vehicle Parking 0-1m") and _gis.is_parking(pt):
        updates["Adjacent Vehicle Parking 0-1m"] = 1
    if _needs("Peak pedestrian flow along or across facility") and _gis.is_bus_stop(pt):
        updates["Peak pedestrian flow along or across facility"] = 2

    if _needs("Pedestrian Crossing") and (
        _gis.is_bus_stop(pt, dist=10)
        or _gis.is_road_crossing(pt, dist=10)
        or _gis.is_mrt(pt, dist=10)
    ):
        updates["Pedestrian Crossing"] = 1

    if _needs("Crossing Facility", "Crossing Type") and _gis.is_bicycle_crossing(pt, dist=2):
        updates["Crossing Facility"] = 1
        updates["Crossing Type"] = "Bicycle Crossing"

    if _needs("Intersecting Bicycle Facility"):
        if _gis.is_road_crossing(pt, dist=5):
            updates["Intersecting Bicycle Facility"] = 1
        else:
            updates["Intersecting Bicycle Facility"] = 2

    if _needs("Area type"):
        updates["Area type"] = int(_gis.get_area_type(pt))

    if _needs("Road AADT"):
        updates["Road AADT"] = 6000

    if _needs("Peak bicycle/LV traffic flow", "Peak pedestrian flow along or across facility"):
        res = _gis.get_peak_pedestrian_flow(pt, dist=10)
        bpks = (res or {}).get("before_peaks")
        spks = (res or {}).get("sensor_peaks")

        def _apply_peak(peaks):
            if not peaks:
                return
            if int(peaks.get("MICROMOBILITY", 0)) > 50:
                updates["Peak bicycle/LV traffic flow"] = 2
            if int(peaks.get("OTHER", 0)) > 50:
                updates["Peak pedestrian flow along or across facility"] = 3

        if spks:
            _apply_peak(spks)
        elif bpks:
            _apply_peak(bpks)

    if _needs("Road operating speed (mean)"):
        updates["Road operating speed (mean)"] = _gis.get_road_operating_speed(pt, buffer_dist=20, max_dist=30, default_speed=30.0)

    if _needs("Road speed limit"):
        updates["Road speed limit"] = _gis.get_road_speed_limit(pt, buffer_dist=20, max_dist=30, default_limit=10)

    if _needs("Heavy vehicle flow"):
        updates["Heavy vehicle flow"] = _gis.get_heavy_vehicle_flow(pt, buffer_dist=15, max_dist=15, default_value=1)

    if _needs("Curvature", "Curvature Sub-category"):
        curvature, curvature_subcat = _gis.get_curvature(curvature_pt, sharp_turn_threshold=10.0, default_value=2)
        updates["Curvature"] = curvature
        if curvature_subcat is not None:
            updates["Curvature Sub-category"] = curvature_subcat

    if _needs("Facility Width per Direction", "Facility Width Sub-category"):
        facility_width, width_subcat = _gis.get_facility_width(pt, start_radius=2.0, max_radius=10.0, step_size=2.0, default_value=2)
        updates["Facility Width per Direction"] = facility_width
        if width_subcat is not None:
            updates["Facility Width Sub-category"] = width_subcat

    if _needs("Number of lanes – adjacent road"):
        nol = _gis.get_number_of_lane(pt, dist=20)
        if nol is not None:
            updates["Number of lanes – adjacent road"] = nol

    _DEFORM = "Major Surface Deformation or Drain Opening"
    _SLIP = "Loose or slippery surface"
    _DEFECT_TYPE = "Defect Type"
    if _needs(_DEFORM, _SLIP, "Delineation", "Delineation Type", _DEFECT_TYPE):
        try:
            from shapely.geometry import LineString as _LineString
            import geopandas as _gpd
            from app.services.defects_store import get_defects_store
            line_raw = _LineString(coords)
            if coords[0][0] < 180:
                line_metric = _gpd.GeoSeries([line_raw], crs="EPSG:4326").to_crs("EPSG:3414").iloc[0]
            else:
                line_metric = line_raw
            nearby = get_defects_store().query_near_line(line_metric, 5.0)
            has_deform = has_slip = has_faded_marking = False
            defect_types: list[str] = []
            for d in nearby:
                raw = d["type_of_defect"].strip()
                dt = raw.lower()
                if dt == "algae":
                    has_slip = True
                elif dt == "faded marking":
                    has_faded_marking = True
                else:
                    has_deform = True
                    if raw not in defect_types:
                        defect_types.append(raw)
            # Authoritative on the Red/Amber-filtered defects source: explicitly
            # downgrades to Not Present (2) when nothing matches nearby, instead of
            # only ever adding a Present flag — otherwise a Present coded under an
            # older/less-filtered defects source can never self-correct on rerun.
            if _needs(_DEFORM, _DEFECT_TYPE):
                updates[_DEFORM] = 1 if has_deform else 2
                updates[_DEFECT_TYPE] = ", ".join(defect_types) if (has_deform and defect_types) else None
            if has_slip and _needs(_SLIP):
                updates[_SLIP] = 1
            if has_faded_marking and _needs("Delineation", "Delineation Type"):
                updates["Delineation"] = 2
                updates["Delineation Type"] = "Faded Marking"
        except FileNotFoundError:
            pass
        except Exception:
            pass

    return updates


@bp.post("/<project_name>/autocode/gis")
def autocode_gis(project_name: str):
    try:
        payload = request.get_json(force=True, silent=True) or {}
        coords = payload.get("coords")
        fields_filter = payload.get("fields")
        if fields_filter and not isinstance(fields_filter, list):
            fields_filter = None
        updates = _gis_autocode_core(coords, fields_filter)
        return ok({"updates": updates, "changed_fields": list(updates.keys())})
    except ServiceUnavailable as e:
        return fail(str(e), 503)
    except Exception as e:
        traceback.print_exc()
        return fail(f"autocode_gis error: {e}", 500)


@bp.post("/<project_name>/autocode/all")
@with_project(version=True)
def autocode_all(project_name: str, pm, proj, ver):
    """
    Modes:
      A) Single (backward-compatible):
         Body: { imageRef: "...", coords: [[lon,lat],...], index?: int }
      B) Bulk - all rows:
         Body: { all: true }  (optionally { save: true } to persist)
      C) Bulk - selected indices:
         Body: { indices: [0,2,5], save?: true }

    Returns:
      - For single: { updates: {...}, saved: bool }
      - For bulk: {
          saved: bool,
          total: N,
          ok: K,
          fail: M,
          errors: [{ index, reason }],
        }
    """
    try:
        payload = request.get_json(force=True, silent=True) or {}
        want_stream: bool = bool(payload.get("stream", False))

        # ---------- detect mode ----------
        run_all: bool = bool(payload.get("all"))
        indices = payload.get("indices")
        has_single_fields = ("imageRef" in payload) or ("coords" in payload) or ("index" in payload)

        # Always ensure models/layers first
        _ensure_models_ready()

        # ---------- helpers to resolve per-row data ----------
        import math
        from shapely.geometry import LineString as _LS

        def _resolve_image_ref(idx: int) -> str | None:
            """
            Resolve the image filename for a given row index.

            This function looks for image references in the correct location:
            1. Primary source: geo_data.df (where project_manager stores image refs during creation)
            2. Fallback: attributes.df (in case user manually added it there)

            It also verifies that the referenced image file actually exists on disk.

            Args:
                idx: Row index in the attributes/geo_data tables

            Returns:
                str: Image filename if found and exists, None otherwise
            """
            def _image_ref_exists(img_ref: str) -> bool:
                """Check images/ dir first, then in/ (for new/migrated projects)."""
                legacy = (pm.des_path / project_name / global_var.PROJECT_IMAGES_FOLDER / img_ref).resolve()
                if legacy.is_file():
                    return True
                return _resolve_image_from_in(pm, project_name, img_ref) is not None

            # Primary source: geo_data (where image references are stored during project creation)
            if 0 <= idx < len(proj.geo_data.df):
                geo_row = proj.geo_data.df.iloc[idx]
                for key in ("Image Reference", "Image_Reference", "image", "img", "FILENAME"):
                    if key in geo_row and pd.notna(geo_row[key]) and str(geo_row[key]).strip():
                        img_ref = str(geo_row[key]).strip()
                        if _image_ref_exists(img_ref):
                            return img_ref

            # Fallback: attributes table (in case it was copied there)
            if 0 <= idx < len(ver.attributes.df):
                attr_row = ver.attributes.df.iloc[idx]
                for key in ("Image Reference", "Image_Reference", "image", "img", "FILENAME"):
                    if key in attr_row and pd.notna(attr_row[key]) and str(attr_row[key]).strip():
                        img_ref = str(attr_row[key]).strip()
                        if _image_ref_exists(img_ref):
                            return img_ref
            return None

        def _resolve_coords(idx: int):
            if 0 <= idx < len(proj.geo_data.df):
                geom = proj.geo_data.df.geometry.iloc[idx]
                if geom is not None and isinstance(geom, _LS) and not geom.is_empty:
                    # shapely coords -> [[lon,lat], ...]
                    return [list(c) for c in list(geom.coords)]
            return None

        # Fields produced EXCLUSIVELY by GIS (autocode_gis). CV never produces these.
        # Safe to skip CV inference when ALL requested fields are in this set.
        # NOTE: "Peak pedestrian flow along or across facility" is intentionally EXCLUDED —
        # GIS conditionally overrides CV for that field; if GIS doesn't fire (not near MRT/bus
        # stop), the CV-computed default is the correct final value, so CV must still run.
        _GIS_ONLY_FIELDS: frozenset = frozenset({
            "Area type",
            "Road AADT",
            "Road operating speed (mean)",
            "Road speed limit",
            "Curvature",
            "Curvature Sub-category",
            "Facility Width per Direction",
            "Facility Width Sub-category",
            "Heavy vehicle flow",
            "Adjacent Vehicle Parking 0-1m",
            "Pedestrian Crossing",
            "Peak bicycle/LV traffic flow",
            "Grade",  # from LAZ gradient lookup, not from CV
            "Number of lanes – adjacent road",  # from kerb_line shapefile LANES column
        })

        def _call_autocode_pair(image_ref: str, coords, skip_cv: bool = False, skip_gis: bool = False, skip_obstacles: bool = False, fields_filter: "list | None" = None):
            """
            Call CV and/or GIS autocoding for a single image and merge results.
            Calls _cv_autocode_core / _gis_autocode_core directly (no HTTP round-trip),
            eliminating the ~2.5 s/seg test_request_context overhead in bulk mode.

            Returns: (merged_updates, sources, error_or_None)
            """
            img_updates: dict = {}
            if not skip_cv:
                try:
                    img_updates = _cv_autocode_core(pm, project_name, image_ref, skip_obstacles)
                except Exception as e:
                    return None, None, str(e)

            gis_updates: dict = {}
            if not skip_gis:
                try:
                    gis_updates = _gis_autocode_core(coords, fields_filter)
                except Exception as e:
                    return None, None, str(e)

            # Merge updates: GIS overrides CV if both set the same field
            # Example: If CV sets "Area type"=2 and GIS sets "Area type"=1, final value is 1
            merged = {**img_updates, **gis_updates}

            # Special case: "Crossing Type" — append GIS value to CV value instead of override
            # e.g. CV="Traffic Crossing" + GIS="Bicycle Crossing" → "Traffic Crossing, Bicycle Crossing"
            if "Crossing Type" in img_updates and "Crossing Type" in gis_updates:
                cv_type = img_updates["Crossing Type"]   # may be None
                gis_type = gis_updates["Crossing Type"]
                merged["Crossing Type"] = f"{cv_type}, {gis_type}" if cv_type else gis_type

            # Track which fields came from CV vs GIS for UI highlighting badges
            sources = {}
            for field in img_updates:
                sources[field] = "CV"
            for field in gis_updates:
                sources[field] = "GIS"  # GIS overrides CV source if both set the same field

            # Special case: "Intersecting Bicycle Facility" — CV wins over GIS only when CV
            # explicitly detected a dominant traffic/zebra crossing (value is not None).
            # GIS says Present when a road crossing is within 5 m, but if CV saw a pedestrian
            # crossing dominating the image it overrides to Not Present.
            ibf_key = "Intersecting Bicycle Facility"
            if img_updates.get(ibf_key) is not None and ibf_key in gis_updates:
                merged[ibf_key] = img_updates[ibf_key]
                sources[ibf_key] = "CV"

            return merged, sources, None

        # ========================================================================
        # Used by the single "Auto-code" button in the UI
        # Payload: { imageRef: "...", coords: [[lon,lat],...], index?: int }
        if has_single_fields and not run_all and not indices:
            image_ref = payload.get("imageRef")
            coords = payload.get("coords")
            if not image_ref or not coords:
                return fail("imageRef and coords are required", 400)

            # Call CV + GIS autocoding
            merged, sources, err = _call_autocode_pair(image_ref, coords)
            if err:
                return fail(err, 500)

            # Inject Grade from pre-computed LAZ gradient lookup
            _inject_grade(image_ref, merged, sources, project_name=project_name)
            idx = payload.get("index")
            if isinstance(idx, int) and 0 <= idx < len(ver.attributes.df):
                changed_fields = []  # Only fields that actually changed value
                field_sources = {}   # Source (CV/GIS) for each changed field

                for field, code in (merged or {}).items():
                    # Check if value actually changed (not just set to same value)
                    old_val = ver.attributes.df.at[idx, field] if field in ver.attributes.df.columns else None
                    if old_val != code:
                        changed_fields.append(field)
                        field_sources[field] = sources.get(field, "Unknown")
                    # Update the DataFrame
                    ver.attributes.df.at[idx, field] = code

                # Save immediately for single-image autocoding
                ver.save_all()

                return ok({
                    "updates": merged,
                    "saved": True,
                    "changed_fields": changed_fields,      # For UI highlighting
                    "field_sources": field_sources         # For CV/GIS badges
                })

            # No index provided - return updates without saving
            return ok({
                "updates": merged,
                "saved": False,
                "changed_fields": list(merged.keys()),
                "field_sources": sources
            })

        # ========================================================================
        # BULK MODE: Auto-code multiple/all images
        # ========================================================================
        # Used by the "Auto-code all" button in the UI
        # Payload options:
        #   - { all: true, save?: false }              -> Process all rows
        #   - { indices: [0,2,5], save?: false }       -> Process specific rows
        #   - { ..., stream: true }                    -> SSE streaming (yields progress per row)

        # Determine which rows to process
        if not indices:
            indices = list(range(len(ver.attributes.df)))
        else:
            indices = [i for i in indices if isinstance(i, int) and 0 <= i < len(ver.attributes.df)]

        # Check if we should save to disk (default: True, but UI passes False for temp changes)
        save = bool(payload.get("save", True))

        # Optional field filter: only apply updates for these specific field names
        fields_filter = payload.get("fields")  # list[str] | None
        if fields_filter and not isinstance(fields_filter, list):
            fields_filter = None  # Ignore malformed value

        # Determine whether CV inference can be skipped for this batch.
        # CV is safe to skip only when ALL requested fields are exclusively
        # produced by GIS (never by CV). This avoids running expensive YOLO
        # inference when the user selects e.g. only "Area type" or "Curvature".
        skip_cv = bool(fields_filter and all(f in _GIS_ONLY_FIELDS for f in fields_filter))
        if skip_cv:
            logger.info(f"[Autocode] Skipping CV inference — all requested fields are GIS-only: {fields_filter}")

        # Fields that require the obstacle detector model (second YOLO pass).
        # Safe to skip when none of these are in the requested fields.
        _CV_OBSTACLE_FIELDS: frozenset = frozenset({
            "Fixed Obstacle on Facility",
            "Non-Fixed Obstacle on Facility",
            "Width Restriction",
            "FO Type",
            "NFO Type",
        })
        skip_obstacles = bool(
            not skip_cv  # obstacle skip only relevant when CV runs at all
            and fields_filter
            and not any(f in _CV_OBSTACLE_FIELDS for f in fields_filter)
        )
        if skip_obstacles:
            logger.info(f"[Autocode] Skipping obstacle detection — no obstacle fields requested: {fields_filter}")

        def _bulk_gen():
            """
            Generator that processes all rows and yields dicts:
              {"type": "progress", "processed": N, "total": M, "errors": E}  — after each row
              {"type": "done", "saved": bool, "total": M, "ok": K, ...}       — after completion

            Streaming mode (want_stream=True): events are serialised to SSE and returned as a
            Flask streaming Response so the frontend can update the progress counter per segment.
            Non-streaming mode: events are consumed internally and the "done" event is returned
            as a normal JSON response (backward-compatible).
            """
            import json as _json  # noqa: F401 — used by caller's SSE wrapper

            errors: list = []
            ok_count: int = 0
            changed_by_row: dict = {}
            sources_by_row: dict = {}

            total_count = len(indices)
            logger.info(f"[Autocode] Bulk starting: {total_count} rows for project '{project_name}'")
            _helpers._INFERENCE_DEPTH += 1
            try:
                for idx in indices:
                    try:
                        # Resolve image filename and coordinates for this row
                        image_ref = _resolve_image_ref(idx)
                        coords = _resolve_coords(idx)

                        # Validate we have the required data
                        if not image_ref:
                            geo_row = proj.geo_data.df.iloc[idx] if idx < len(proj.geo_data.df) else None
                            if geo_row is not None:
                                img_col = "Image Reference"
                                img_val = geo_row.get(img_col) if img_col in geo_row else None
                                errors.append({"index": idx, "reason": f"missing or invalid imageRef (geo_data['{img_col}'] = {repr(img_val)})"})
                            else:
                                errors.append({"index": idx, "reason": "missing imageRef (row not in geo_data)"})
                            continue

                        if not coords:
                            errors.append({"index": idx, "reason": "missing LineString coords"})
                            continue

                        # Run CV + GIS autocoding for this row
                        merged, sources, err = _call_autocode_pair(image_ref, coords, skip_cv=skip_cv, skip_obstacles=skip_obstacles, fields_filter=fields_filter)
                        if err:
                            errors.append({"index": idx, "reason": err})
                            continue

                        # Inject Grade from pre-computed LAZ gradient lookup
                        if not skip_cv or (fields_filter and "Grade" in fields_filter):
                            _inject_grade(image_ref, merged, sources, project_name=project_name)

                        # Apply per-attribute filter: only keep requested fields
                        if fields_filter:
                            actual_filter = list(fields_filter)
                            if "Grade" in actual_filter:
                                actual_filter.append("Gradient %")
                            if "Delineation" in actual_filter:
                                actual_filter.append("Delineation Type")
                            if "Major Surface Deformation or Drain Opening" in actual_filter:
                                actual_filter.append("Defect Type")
                            merged = {k: v for k, v in (merged or {}).items() if k in actual_filter}
                            sources = {k: v for k, v in (sources or {}).items() if k in actual_filter}

                        # Track which fields actually changed (for UI highlighting)
                        changed_fields: list = []
                        field_sources: dict = {}
                        for field, code in (merged or {}).items():
                            old_val = ver.attributes.df.at[idx, field] if field in ver.attributes.df.columns else None
                            if old_val != code:
                                changed_fields.append(field)
                                field_sources[field] = sources.get(field, "Unknown")
                            ver.attributes.df.at[idx, field] = code

                        changed_by_row[idx] = changed_fields
                        sources_by_row[idx] = field_sources
                        ok_count += 1

                        # Yield per-row progress event (consumed by SSE wrapper or discarded)
                        yield {"type": "progress", "processed": ok_count, "total": total_count, "errors": len(errors)}

                        if ok_count % 10 == 0:
                            logger.info(f"[Autocode] Bulk progress: {ok_count}/{total_count} done ({len(errors)} errors so far)")

                    except Exception as e:
                        traceback.print_exc()
                        errors.append({"index": idx, "reason": str(e)})
            finally:
                _helpers._INFERENCE_DEPTH -= 1

            # --- Area Type Smoothing (100m rule) ---
            try:
                area_col = "Area type"
                if len(indices) > 1 and area_col in ver.attributes.df.columns and (not fields_filter or area_col in fields_filter):
                    import pandas as pd
                    df_len = len(ver.attributes.df)
                    area_vals = ver.attributes.df[area_col].copy()
                    
                    lengths = pd.Series([10.0] * df_len)
                    if getattr(proj, "geo_data", None) and getattr(proj.geo_data, "df", None) is not None and "Length" in proj.geo_data.df.columns:
                        lengths = pd.to_numeric(proj.geo_data.df["Length"], errors='coerce').fillna(10.0)
                    elif "Length" in ver.attributes.df.columns:
                        lengths = pd.to_numeric(ver.attributes.df["Length"], errors='coerce').fillna(10.0)
                    elif "Distance" in ver.attributes.df.columns:
                        lengths = pd.to_numeric(ver.attributes.df["Distance"], errors='coerce').fillna(10.0)
                    
                    i = 0
                    while i < df_len:
                        curr_val = area_vals.iloc[i]
                        run_len = 0.0
                        j = i
                        while j < df_len and area_vals.iloc[j] == curr_val:
                            run_len += lengths.iloc[j]
                            j += 1
                        
                        if run_len < 100.0:
                            prev_val = area_vals.iloc[i-1] if i > 0 else None
                            next_val = area_vals.iloc[j] if j < df_len else None
                            replace_val = curr_val
                            if prev_val is not None:
                                replace_val = prev_val
                            elif next_val is not None:
                                replace_val = next_val
                                
                            for k in range(i, j):
                                area_vals.iloc[k] = replace_val
                        i = j
                        
                    for idx_ in range(df_len):
                        new_val = area_vals.iloc[idx_]
                        if ver.attributes.df.at[idx_, area_col] != new_val:
                            ver.attributes.df.at[idx_, area_col] = new_val
                            if idx_ in changed_by_row:
                                if area_col not in changed_by_row[idx_]:
                                    changed_by_row[idx_].append(area_col)
                            else:
                                changed_by_row[idx_] = [area_col]
                                
                            if idx_ not in sources_by_row:
                                sources_by_row[idx_] = {}
                            sources_by_row[idx_][area_col] = "GIS (Smoothed)"
            except Exception as e:
                logger.warning(f"[Autocode] Area type smoothing failed: {e}")

            # Save to disk (runs only when the loop completes; skipped on generator abandon/disconnect)
            if save and ok_count > 0:
                logger.info(f"[Autocode] Bulk complete: {ok_count}/{total_count} OK, {len(errors)} failed. Saving...")
                # df.at[] writes bypass the BaseTable.df setter so df_dirty is never set.
                # Force it True before saving so ver.save_all() actually serializes attributes.
                ver.attributes.df_dirty = True
                proj.save_all()
                proj.metadata.last_updated = datetime.datetime.now()
                proj.metadata.serialize(proj.project_path)

            updated_attributes = df_to_records(ver.attributes.df)
            yield {
                "type": "done",
                "saved": bool(save and ok_count > 0),
                "total": len(indices),
                "ok": ok_count,
                "fail": len(errors),
                "errors": errors,
                "changed_by_row": changed_by_row,
                "sources_by_row": sources_by_row,
                "updated_attributes": updated_attributes,
            }

        # ── Streaming mode: return SSE response ──────────────────────────────
        if want_stream:
            import json as _json

            def _sse():
                for event in _bulk_gen():
                    yield f"data: {_json.dumps(event)}\n\n"

            return Response(
                stream_with_context(_sse()),
                mimetype="text/event-stream",
                headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
            )

        # ── Non-streaming mode: consume generator, return JSON ───────────────
        final_event = None
        for event in _bulk_gen():
            if event["type"] == "done":
                final_event = event
        return ok({k: v for k, v in (final_event or {}).items() if k != "type"})

    except ServiceUnavailable as e:
        return fail(str(e), 503)
    except Exception as e:
        traceback.print_exc()
        return fail(f"autocode_all error: {e}", 500)
