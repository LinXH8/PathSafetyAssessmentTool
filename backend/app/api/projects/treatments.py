"""Treatment definition, application, preview and effectiveness routes.

Holds the canonical `TREATMENTS` catalogue (must match the frontend) and every
`/treatments/*` endpoint."""
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

from ._helpers import df_to_records, fail, with_project




# ===== Treatment Definitions (must match frontend exactly) =====
TREATMENTS = [
    {
        "id": 1,
        "name": "Upgrade to on-road bicycle lane with light segregation",
        "triggers": [
            {"Facility Type": [5], "Light Segregation": [2]},
            {"Facility Type": [6], "Light Segregation": [2]},
            {"Facility Type": [1, 2], "Number of lanes – adjacent road": [1], "Peak pedestrian flow along or across facility": [3]},
            {"Facility Type": [1, 2], "Number of lanes – adjacent road": [1]},
        ],
        "effects": {"Facility Type": 4, "Light Segregation": 1, "Facility access": 1}
    },
    {
        "id": 2,
        "name": "Safety barrier (Adjacent road 0-1m)",
        "triggers": [
            {"Facility Type": [4, 5, 6], "Adjacent Road Lane 0-1m": [1], "Intersection or Road Crossing": [2]},
            {"Facility Type": [4, 5, 6], "Adjacent Road Lane 0-1m": [1], "Curvature": [1], "Intersection or Road Crossing": [2]},
            {"Facility Type": [3, 4, 5, 6], "Adjacent Road Lane 0-1m": [1], "Intersection or Road Crossing": [2]},
        ],
        "effects": {"Adjacent Road Lane 0-1m": 2, "Facility access": 1}
    },
    {
        "id": 3,
        "name": "Safety barrier (Adjacent road 1-3m)",
        "triggers": [
            {"Facility Type": [4, 5, 6], "Adjacent Road Lane 1-3m": [1], "Intersection or Road Crossing": [2]},
            {"Facility Type": [3, 4, 5, 6], "Adjacent Road Lane 1-3m": [1], "Intersection or Road Crossing": [2]},
        ],
        "effects": {"Adjacent Road Lane 1-3m": 2, "Facility access": 1}
    },
    {
        "id": 4,
        "name": "Upgrade to cycling-priority street",
        "triggers": [
            {"Facility Type": [1, 2, 5, 6], "Property Access": [1]},
        ],
        "effects": {"Facility access": 1}
    },
    {
        "id": 5,
        "name": "Upgrade to multi-use path",
        "triggers": [
            {"Facility Type": [1, 2, 5, 6], "Property Access": [1]},
        ],
        "effects": {"Facility Type": 2, "Facility Width per Direction": 3, "Facility access": 1}
    },
    {
        "id": 6,
        "name": "Upgrade to off-road bicycle path",
        "triggers": [
            {"Facility Type": [1, 2, 5, 6], "Property Access": [1]},
        ],
        "effects": {"Facility Type": 3, "Facility access": 1}
    },
    {
        "id": 7,
        "name": "Convert to one-way facility",
        "triggers": [
            {"Facility Type": [4, 5, 6], "Flow Direction": [2]},
        ],
        "effects": {"Flow Direction": 1, "Facility access": 1}
    },
    {
        "id": 8,
        "name": "Improve surface conditions",
        "triggers": [
            {"Loose or slippery surface": [1]},
        ],
        "effects": {"Loose or slippery surface": 2, "Major Surface Deformation or Drain Opening": 2}
    },
    {
        "id": 9,
        "name": "Install light segregation",
        "triggers": [
            {"Light Segregation": [2]},
        ],
        "effects": {"Light Segregation": 1}
    },
    {
        "id": 10,
        "name": "Install street lighting",
        "triggers": [
            {"Street Lighting": [2]},
        ],
        "effects": {"Street Lighting": 1}
    },
    {
        "id": 11,
        "name": "Remove fixed obstacles",
        "triggers": [
            {"Fixed Obstacle on Facility": [1]},
        ],
        "effects": {"Fixed Obstacle on Facility": 2}
    },
    {
        "id": 12,
        "name": "Remove non-fixed obstacles",
        "triggers": [
            {"Non-Fixed Obstacle on Facility": [1]},
        ],
        "effects": {"Non-Fixed Obstacle on Facility": 2}
    },
    {
        "id": 13,
        "name": "Remove width restriction",
        "triggers": [
            {"Width Restriction": [1]},
        ],
        "effects": {"Width Restriction": 2}
    },
    {
        "id": 14,
        "name": "Improve facility access",
        "triggers": [
            {"Facility access": [2]},
        ],
        "effects": {"Facility access": 1}
    },
    {
        "id": 15,
        "name": "Redesign sharp curves",
        "triggers": [
            {"Curvature": [1]},
        ],
        "effects": {"Curvature": 2}
    },
    {
        "id": 16,
        "name": "Widen the facility",
        "triggers": [
            {"Facility Width per Direction": [1, 2]},
        ],
        "effects": {"Facility Width per Direction": 3}
    },
    {
        "id": 17,
        "name": "Install protective barrier",
        "triggers": [
            {"Adjacent Severe Hazard 0-1m": [1]},
        ],
        "effects": {"Adjacent Severe Hazard 0-1m": 2}
    },
    {
        "id": 18,
        "name": "Improve delineation",
        "triggers": [
            {"Delineation": [2]},
        ],
        "effects": {"Delineation": 1}
    },
    {
        "id": 19,
        "name": "Review intersection approach",
        "triggers": [
            {"Intersection Approach": [1]},
        ],
        "effects": {"Intersection Approach": 2}
    },
    {
        "id": 20,
        "name": "Improve crossing facility",
        "triggers": [
            {"Crossing Facility": [2]},
        ],
        "effects": {"Crossing Facility": 1}
    },
    {
        "id": 21,
        "name": "Evaluate grade separation",
        "triggers": [
            {"Intersection or Road Crossing": [1]},
        ],
        "effects": {"Intersection or Road Crossing": 2}
    },
    {
        "id": 22,
        "name": "Reconfigure/remove parking",
        "triggers": [
            {"Adjacent Vehicle Parking 0-1m": [1]},
        ],
        "effects": {"Adjacent Vehicle Parking 0-1m": 2}
    },
    {
        "id": 23,
        "name": "Review tram/train rails",
        "triggers": [
            {"Tram or Train Rails": [1]},
        ],
        "effects": {"Tram or Train Rails": 2}
    },
    {
        "id": 24,
        "name": "Install traffic calming",
        "triggers": [
            {"Facility Type": [4], "Intersection or Road Crossing": [2], "Adjacent Road Lane 0-1m": [1]},
        ],
        "effects": {}
    },
    {
        "id": 25,
        "name": "Bicycle speed control",
        "triggers": [
            {"Bicycle/LV speed – average": [2]},
        ],
        "effects": {"Bicycle/LV speed – average": 1}
    },
]

@bp.post("/<project_name>/treatments")
@with_project(version=True)
def evaluate_treatments(project_name: str, pm, proj, ver):
    """
    Use the Excel STM macro to generate treatment suggestions:
    - Requires GeoData + Attributes
    """
    gdf = proj.geo_data.df
    attrs = ver.attributes.df

    treatment_tbl = CRI.cycleRAP_interface.evaluate_treatment_suggestions(gdf, attrs)
    ver._treatment = treatment_tbl
    proj.save_all()

    return jsonify({"ok": True, "rows": df_to_records(treatment_tbl.df)})


@bp.post("/<project_name>/treatments/apply")
@with_project(version=True)
def apply_treatments(project_name: str, pm, proj, ver):
    """
    Apply selected treatments to a specific segment.

    Request body:
        {
            "segment_index": 5,
            "treatment_ids": [1, 9, 14],
            "image_ref": "FERNVALE_001.jpg"  // Optional, for tracking
        }

    Response:
        {
            "ok": true,
            "segment_index": 5,
            "treatments_applied": "1,9,14",
            "modified_attributes": { "Facility Type": 4, ... },
            "before_scores": { "BB": 2.5, "BP": 1.2, "SB": 3.1, "VB": 5.8, "Overall Risk Level": 12.6 },
            "after_scores": { "BB": 1.8, "BP": 0.9, "SB": 2.2, "VB": 3.5, "Overall Risk Level": 8.4 }
        }
    """
    try:

        data = request.get_json(silent=True) or {}
        segment_index = data.get("segment_index")
        treatment_ids = data.get("treatment_ids", [])
        image_ref = data.get("image_ref", "")

        if segment_index is None:
            return fail("Missing segment_index", 400)

        if not isinstance(treatment_ids, list):
            return fail("treatment_ids must be a list", 400)

        # Load original attributes
        attrs_df = ver.attributes.df
        if segment_index >= len(attrs_df):
            return fail(f"Segment index {segment_index} out of range", 400)

        original_row = dict(attrs_df.iloc[segment_index])

        # Apply treatment effects
        modified_row = original_row.copy()
        for treatment_id in treatment_ids:
            if not (1 <= treatment_id <= 25):
                return fail(f"Invalid treatment ID: {treatment_id}", 400)
            treatment = TREATMENTS[treatment_id - 1]  # Convert 1-based to 0-based
            for attr_name, new_value in treatment['effects'].items():
                modified_row[attr_name] = new_value

        # Calculate before scores (from original attributes)
        original_df = pd.DataFrame([original_row])
        before_scores_df = calculate_cyclerap_score_native(original_df)
        before_scores = {
            "BB": float(before_scores_df["BB"].iloc[0]),
            "BP": float(before_scores_df["BP"].iloc[0]),
            "SB": float(before_scores_df["SB"].iloc[0]),
            "VB": float(before_scores_df["VB"].iloc[0]),
            "Overall Risk Level": float(before_scores_df["Overall Risk Level"].iloc[0])
        }

        # Calculate after scores (from modified attributes)
        modified_df = pd.DataFrame([modified_row])
        after_scores_df = calculate_cyclerap_score_native(modified_df)
        after_scores = {
            "BB": float(after_scores_df["BB"].iloc[0]),
            "BP": float(after_scores_df["BP"].iloc[0]),
            "SB": float(after_scores_df["SB"].iloc[0]),
            "VB": float(after_scores_df["VB"].iloc[0]),
            "Overall Risk Level": float(after_scores_df["Overall Risk Level"].iloc[0])
        }

        # Convert modified_row values to JSON-serializable types
        serializable_modified_row = {}
        for col, val in modified_row.items():
            if pd.notna(val):
                try:
                    if hasattr(val, 'item'):  # numpy/pandas scalar
                        serializable_modified_row[col] = val.item()
                    else:
                        serializable_modified_row[col] = val
                except (ValueError, TypeError):
                    serializable_modified_row[col] = None
            else:
                serializable_modified_row[col] = None

        # Update or create treatment.csv
        treatment_df = ver.treatment.df

        # Ensure treatment dataframe has all attribute columns
        for col in attrs_df.columns:
            if col not in treatment_df.columns:
                treatment_df[col] = ""

        # Ensure the treatment.csv has enough rows
        if len(treatment_df) <= segment_index:
            # Need to expand the dataframe
            new_rows = [treatment_df.iloc[0].copy() if len(treatment_df) > 0 else {}] * (segment_index - len(treatment_df) + 1)
            treatment_df = pd.concat([treatment_df, pd.DataFrame(new_rows)], ignore_index=True)

        # Update the row with modified attributes
        for col in modified_row.keys():
            if col in treatment_df.columns:
                treatment_df.at[segment_index, col] = modified_row[col]

        # Update "Treatments Applied" column
        if "Treatments Applied" not in treatment_df.columns:
            treatment_df.insert(0, "Treatments Applied", "")

        if treatment_ids:
            treatment_df.at[segment_index, "Treatments Applied"] = ",".join(str(tid) for tid in treatment_ids)
        else:
            treatment_df.at[segment_index, "Treatments Applied"] = ""

        # Save updated treatment.csv
        ver._treatment = serializer.Treatment()
        ver.treatment.df = treatment_df
        ver.treatment.df_dirty = True
        proj.save_all()

        # Update last_updated
        proj.metadata.last_updated = datetime.datetime.now()
        proj.metadata.serialize(proj.project_path)

        return jsonify({
            "ok": True,
            "segment_index": segment_index,
            "treatments_applied": ",".join(str(tid) for tid in treatment_ids),
            "modified_attributes": serializable_modified_row,
            "before_scores": before_scores,
            "after_scores": after_scores
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return fail(f"Error applying treatments: {str(e)}", 500)


@bp.post("/<project_name>/treatments/preview")
@with_project(version=True)
def preview_treatments(project_name: str, pm, proj, ver):
    """
    Preview selected treatments for a specific segment without saving.
    
    Request body:
        {
            "segment_index": 5,
            "treatment_ids": [1, 9, 14]
        }

    Response:
        {
            "ok": true,
            "segment_index": 5,
            "modified_attributes": { "Facility Type": 4, ... },
            "before_scores": { "BB": 2.5, ... },
            "after_scores": { "BB": 1.8, ... }
        }
    """
    try:

        data = request.get_json(silent=True) or {}
        segment_index = data.get("segment_index")
        treatment_ids = data.get("treatment_ids", [])

        if segment_index is None:
            return fail("Missing segment_index", 400)

        if not isinstance(treatment_ids, list):
            return fail("treatment_ids must be a list", 400)

        # Load original attributes
        attrs_df = ver.attributes.df
        if segment_index >= len(attrs_df):
            return fail(f"Segment index {segment_index} out of range", 400)

        original_row = dict(attrs_df.iloc[segment_index])

        # Apply treatment effects
        modified_row = original_row.copy()
        for treatment_id in treatment_ids:
            if not (1 <= treatment_id <= 25):
                return fail(f"Invalid treatment ID: {treatment_id}", 400)
            treatment = TREATMENTS[treatment_id - 1]  # Convert 1-based to 0-based
            for attr_name, new_value in treatment['effects'].items():
                modified_row[attr_name] = new_value

        # Calculate before scores (from original attributes)
        original_df = pd.DataFrame([original_row])
        before_scores_df = calculate_cyclerap_score_native(original_df)
        before_scores = {
            "BB": float(before_scores_df["BB"].iloc[0]),
            "BP": float(before_scores_df["BP"].iloc[0]),
            "SB": float(before_scores_df["SB"].iloc[0]),
            "VB": float(before_scores_df["VB"].iloc[0]),
            "Overall Risk Level": float(before_scores_df["Overall Risk Level"].iloc[0])
        }

        # Calculate after scores (from modified attributes)
        modified_df = pd.DataFrame([modified_row])
        after_scores_df = calculate_cyclerap_score_native(modified_df)
        after_scores = {
            "BB": float(after_scores_df["BB"].iloc[0]),
            "BP": float(after_scores_df["BP"].iloc[0]),
            "SB": float(after_scores_df["SB"].iloc[0]),
            "VB": float(after_scores_df["VB"].iloc[0]),
            "Overall Risk Level": float(after_scores_df["Overall Risk Level"].iloc[0])
        }

        # Convert modified_row values to JSON-serializable types
        serializable_modified_row = {}
        for col, val in modified_row.items():
            if pd.notna(val):
                try:
                    if hasattr(val, 'item'):  # numpy/pandas scalar
                        serializable_modified_row[col] = val.item()
                    else:
                        serializable_modified_row[col] = val
                except (ValueError, TypeError):
                    serializable_modified_row[col] = None
            else:
                serializable_modified_row[col] = None

        return jsonify({
            "ok": True,
            "segment_index": segment_index,
            "modified_attributes": serializable_modified_row,
            "before_scores": before_scores,
            "after_scores": after_scores
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return fail(f"Error previewing treatments: {str(e)}", 500)


@bp.post("/<project_name>/treatments/effectiveness")
@with_project(version=True)
def treatment_effectiveness(project_name: str, pm, proj, ver):
    """
    Count, per treatment, how many segments in the project would have their
    Overall Risk Level Band *improve* (band decreases) if that treatment
    were applied in isolation. Used by the frontend to rank the
    "By Treatment" list top-down by effectiveness.

    Request body (optional):
        { "treatment_ids": [1, 2, 3, ...] }   # defaults to all 25

    Response:
        {
            "ok": true,
            "total_segments": 412,
            "counts": { "1": 180, "2": 0, "3": 45, ... }
        }
    """
    try:

        data = request.get_json(silent=True) or {}
        requested_ids = data.get("treatment_ids")
        if requested_ids is None:
            requested_ids = [t["id"] for t in TREATMENTS]
        if not isinstance(requested_ids, list):
            return fail("treatment_ids must be a list", 400)

        attrs_df = ver.attributes.df
        n = len(attrs_df)
        if n == 0:
            return jsonify({
                "ok": True,
                "total_segments": 0,
                "counts": {str(tid): 0 for tid in requested_ids},
                "applicable_counts": {str(tid): 0 for tid in requested_ids},
            })

        # Baseline scoring once
        before_df = calculate_cyclerap_score_native(attrs_df)
        before_band = before_df["Overall Risk Level Band"].to_numpy()

        treatment_map = {t["id"]: t for t in TREATMENTS}
        counts: dict[str, int] = {}
        applicable_counts: dict[str, int] = {}

        for tid in requested_ids:
            if tid not in treatment_map:
                counts[str(tid)] = 0
                applicable_counts[str(tid)] = 0
                continue
            treatment = treatment_map[tid]

            # Applicability mask (vectorized): OR of trigger sets, AND within a set
            mask = pd.Series(False, index=attrs_df.index)
            for trigger_set in treatment.get("triggers", []):
                set_mask = pd.Series(True, index=attrs_df.index)
                for attr_name, valid_values in trigger_set.items():
                    if attr_name not in attrs_df.columns:
                        set_mask = pd.Series(False, index=attrs_df.index)
                        break
                    set_mask &= attrs_df[attr_name].isin(valid_values)
                mask |= set_mask

            applicable_counts[str(tid)] = int(mask.sum())

            if not mask.any():
                counts[str(tid)] = 0
                continue

            modified = attrs_df.copy()
            for attr_name, new_value in treatment.get("effects", {}).items():
                if attr_name in modified.columns:
                    modified.loc[mask, attr_name] = new_value
                else:
                    modified[attr_name] = None
                    modified.loc[mask, attr_name] = new_value

            after_df = calculate_cyclerap_score_native(modified)
            after_band = after_df["Overall Risk Level Band"].to_numpy()

            improved = ((after_band < before_band) & mask.to_numpy()).sum()
            counts[str(tid)] = int(improved)

        return jsonify({
            "ok": True,
            "total_segments": int(n),
            "counts": counts,
            "applicable_counts": applicable_counts,
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return fail(f"Error computing treatment effectiveness: {str(e)}", 500)


@bp.get("/<project_name>/treatments/effectiveness/segment/<int:segment_index>")
@with_project(version=True)
def treatment_segment_effectiveness(project_name: str, segment_index: int, pm, proj, ver):
    """
    For a single segment, compute the Overall Risk Level score drop for each
    treatment applied in isolation. Used by the frontend to rank the
    "By Segment" treatment list top-down by per-segment effectiveness.

    Response:
        {
            "ok": true,
            "score_drops": { "1": 4.2, "3": 0.0, ... }
        }
    """
    try:

        attrs_df = ver.attributes.df
        n = len(attrs_df)
        if segment_index < 0 or segment_index >= n:
            return fail(f"segment_index {segment_index} out of range [0, {n})", 400)

        row_df = attrs_df.iloc[[segment_index]]
        before_score = float(calculate_cyclerap_score_native(row_df)["Overall Risk Level"].iloc[0])

        score_drops: dict[str, float] = {}
        for treatment in TREATMENTS:
            tid = treatment["id"]

            applicable = True
            for trigger_set in treatment.get("triggers", []):
                set_ok = True
                for attr_name, valid_values in trigger_set.items():
                    if attr_name not in row_df.columns:
                        set_ok = False
                        break
                    if row_df[attr_name].iloc[0] not in valid_values:
                        set_ok = False
                        break
                if set_ok:
                    break
            else:
                applicable = False

            if not applicable:
                score_drops[str(tid)] = 0.0
                continue

            modified = row_df.copy()
            for attr_name, new_value in treatment.get("effects", {}).items():
                if attr_name in modified.columns:
                    modified[attr_name] = new_value
                else:
                    modified[attr_name] = new_value

            after_score = float(calculate_cyclerap_score_native(modified)["Overall Risk Level"].iloc[0])
            score_drops[str(tid)] = round(before_score - after_score, 4)

        return jsonify({"ok": True, "score_drops": score_drops})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return fail(f"Error computing segment treatment effectiveness: {str(e)}", 500)


@bp.get("/<project_name>/treatments/all")
@with_project(version=True)
def get_all_treatments(project_name: str, pm, proj, ver):
    """
    Return treatment state for every segment in one call.

    Reads treatment.csv once and returns which segments have treatments and
    what modified attributes are stored.  Does NOT re-score — scores are
    calculated lazily per segment on demand.

    Response:
        {
            "ok": true,
            "segments": {
                "3":  { "has_treatments": true,  "treatments_applied": [1, 9], "modified_attributes": {...} },
                "17": { "has_treatments": true,  "treatments_applied": [5],    "modified_attributes": {...} }
            }
        }
    Only segments that actually have treatments are included.
    """
    try:

        treatment_df = ver.treatment.df
        attrs_df = ver.attributes.df

        segments: dict = {}

        if treatment_df is None or treatment_df.empty or "Treatments Applied" not in treatment_df.columns:
            return jsonify({"ok": True, "segments": segments})

        for idx, row in treatment_df.iterrows():
            treatments_str = row.get("Treatments Applied", "")
            if not treatments_str or pd.isna(treatments_str) or str(treatments_str).strip() == "":
                continue

            try:
                treatment_ids = [int(x.strip()) for x in str(treatments_str).split(",") if x.strip()]
            except ValueError:
                continue

            if not treatment_ids:
                continue

            modified_attributes: dict = {}
            for col in attrs_df.columns:
                if col in treatment_df.columns and col != "Treatments Applied":
                    val = row.get(col)
                    if pd.notna(val):
                        try:
                            modified_attributes[col] = val.item() if hasattr(val, 'item') else val
                        except (ValueError, TypeError):
                            modified_attributes[col] = None
                    else:
                        modified_attributes[col] = None

            segments[str(idx)] = {
                "has_treatments": True,
                "treatments_applied": treatment_ids,
                "modified_attributes": modified_attributes,
            }

        if segments:
            # Vectorized calculation of after_scores for all segments with treatments
            modified_rows = [v["modified_attributes"] for v in segments.values()]
            idx_keys = list(segments.keys())
            modified_df = pd.DataFrame(modified_rows)
            after_scores_df = calculate_cyclerap_score_native(modified_df)
            
            for i, idx_str in enumerate(idx_keys):
                after_scores = {
                    "BB": float(after_scores_df["BB"].iloc[i].item() if hasattr(after_scores_df["BB"].iloc[i], 'item') else after_scores_df["BB"].iloc[i]),
                    "BP": float(after_scores_df["BP"].iloc[i].item() if hasattr(after_scores_df["BP"].iloc[i], 'item') else after_scores_df["BP"].iloc[i]),
                    "SB": float(after_scores_df["SB"].iloc[i].item() if hasattr(after_scores_df["SB"].iloc[i], 'item') else after_scores_df["SB"].iloc[i]),
                    "VB": float(after_scores_df["VB"].iloc[i].item() if hasattr(after_scores_df["VB"].iloc[i], 'item') else after_scores_df["VB"].iloc[i]),
                    "Overall Risk Level": float(after_scores_df["Overall Risk Level"].iloc[i].item() if hasattr(after_scores_df["Overall Risk Level"].iloc[i], 'item') else after_scores_df["Overall Risk Level"].iloc[i])
                }
                segments[idx_str]["after_scores"] = after_scores

        return jsonify({"ok": True, "segments": segments})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return fail(f"Error retrieving all treatments: {str(e)}", 500)


@bp.get("/<project_name>/treatments/segment/<int:segment_index>")
@with_project(version=True)
def get_segment_treatments(project_name: str, segment_index: int, pm, proj, ver):
    """
    Get treatment state for a specific segment.

    Response:
        {
            "ok": true,
            "segment_index": 5,
            "has_treatments": true,
            "treatments_applied": [1, 9, 14],
            "modified_attributes": { "Facility Type": 4, ... },
            "after_scores": { "BB": 1.8, "BP": 0.9, "SB": 2.2, "VB": 3.5, "Overall Risk Level": 8.4 }
        }
    """
    try:

        treatment_df = ver.treatment.df

        # Check if segment exists in treatment.csv
        if segment_index >= len(treatment_df):
            return jsonify({
                "ok": True,
                "segment_index": segment_index,
                "has_treatments": False,
                "treatments_applied": []
            })

        row = treatment_df.iloc[segment_index]

        # Check if "Treatments Applied" column exists and has data
        treatments_str = ""
        if "Treatments Applied" in treatment_df.columns:
            treatments_str = row.get("Treatments Applied", "")

        # If no treatments applied, return early
        if not treatments_str or pd.isna(treatments_str) or treatments_str.strip() == "":
            return jsonify({
                "ok": True,
                "segment_index": segment_index,
                "has_treatments": False,
                "treatments_applied": []
            })

        # Parse treatment IDs
        try:
            treatment_ids = [int(x.strip()) for x in treatments_str.split(",") if x.strip()]
        except ValueError:
            return jsonify({
                "ok": True,
                "segment_index": segment_index,
                "has_treatments": False,
                "treatments_applied": []
            })

        # Extract modified attributes from row
        modified_attributes = {}
        attrs_df = ver.attributes.df
        original_row = dict(attrs_df.iloc[segment_index])

        for col in attrs_df.columns:
            val_treatment = None
            if col in treatment_df.columns and col != "Treatments Applied":
                val_treatment = row.get(col)
                
            # If value in treatment_df is not null and not empty string, use it
            if pd.notna(val_treatment) and str(val_treatment).strip() != "":
                # Convert pandas types to Python native types for JSON serialization
                try:
                    if hasattr(val_treatment, 'item'):  # numpy/pandas scalar
                        val_treatment = val_treatment.item()
                    # Ensure we get a Python native type
                    if isinstance(val_treatment, (int, float, bool)):
                        modified_attributes[col] = val_treatment
                    else:
                        modified_attributes[col] = float(val_treatment)
                except (ValueError, TypeError):
                    modified_attributes[col] = original_row.get(col)
            else:
                # Fallback to the original baseline attributes if this column was untouched
                modified_attributes[col] = original_row.get(col)

        # Calculate after scores from modified attributes
        modified_df = pd.DataFrame([modified_attributes])
        after_scores_df = calculate_cyclerap_score_native(modified_df)

        # Extract scores safely with explicit type conversion
        after_scores = {
            "BB": float(after_scores_df["BB"].iloc[0].item() if hasattr(after_scores_df["BB"].iloc[0], 'item') else after_scores_df["BB"].iloc[0]),
            "BP": float(after_scores_df["BP"].iloc[0].item() if hasattr(after_scores_df["BP"].iloc[0], 'item') else after_scores_df["BP"].iloc[0]),
            "SB": float(after_scores_df["SB"].iloc[0].item() if hasattr(after_scores_df["SB"].iloc[0], 'item') else after_scores_df["SB"].iloc[0]),
            "VB": float(after_scores_df["VB"].iloc[0].item() if hasattr(after_scores_df["VB"].iloc[0], 'item') else after_scores_df["VB"].iloc[0]),
            "Overall Risk Level": float(after_scores_df["Overall Risk Level"].iloc[0].item() if hasattr(after_scores_df["Overall Risk Level"].iloc[0], 'item') else after_scores_df["Overall Risk Level"].iloc[0])
        }

        return jsonify({
            "ok": True,
            "segment_index": segment_index,
            "has_treatments": True,
            "treatments_applied": [int(x) if hasattr(x, 'item') else int(x) for x in treatment_ids],
            "modified_attributes": modified_attributes,
            "after_scores": after_scores
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return fail(f"Error retrieving treatment state: {str(e)}", 500)


@bp.post("/<project_name>/treatments/apply-all")
@with_project(version=True)
def apply_all_treatments(project_name: str, pm, proj, ver):
    """
    Apply all applicable recommended treatments to all segments within a project.

    This endpoint analyzes each segment, identifies applicable treatments,
    and applies all recommended treatments to it.

    Response:
        {
            "ok": true,
            "total_segments": 50,
            "segments_treated": 48,
            "segments_skipped": 2,
            "details": [
                {
                    "segment_index": 0,
                    "treatment_ids": [1, 9, 14],
                    "before_scores": { "BB": 2.5, ... },
                    "after_scores": { "BB": 1.8, ... }
                },
                ...
            ]
        }
    """
    try:

        # Load attributes and treatment dataframes
        attrs_df = ver.attributes.df
        treatment_df = ver.treatment.df.copy()

        # Ensure treatment dataframe has all attribute columns
        for col in attrs_df.columns:
            if col not in treatment_df.columns:
                # Initialize column with None for all rows
                treatment_df[col] = None  # Use None first for proper pandas handling

        # Ensure treatment dataframe has same number of rows as attributes dataframe
        if len(treatment_df) < len(attrs_df):
            # Expand treatment dataframe to match attributes size
            new_rows = [treatment_df.iloc[0].copy() if len(treatment_df) > 0 else {}] * (len(attrs_df) - len(treatment_df))
            treatment_df = pd.concat([treatment_df, pd.DataFrame(new_rows)], ignore_index=True)

        # Helper function to get applicable treatments for a segment
        def get_applicable_treatments(attr_row):
            # Recreate the trigger logic from frontend
            applicable = []
            for treatment in TREATMENTS:
                for trigger_set in treatment.get("triggers", []):
                    # Check if all conditions in this trigger set are met
                    all_match = True
                    for attr_name, required_values in trigger_set.items():
                        if attr_name not in attr_row:
                            all_match = False
                            break
                        if attr_row[attr_name] not in required_values:
                            all_match = False
                            break

                    if all_match:
                        applicable.append(treatment)
                        break  # Only need one trigger set to match
            return applicable

        # Process each segment
        details = []
        total_treated = 0

        for segment_index in range(len(attrs_df)):
            try:
                original_row = dict(attrs_df.iloc[segment_index])

                # Get applicable treatments for this segment
                applicable_treatments = get_applicable_treatments(original_row)

                if not applicable_treatments:
                    continue  # Skip if no applicable treatments

                # Collect all treatment IDs for this segment
                treatment_ids = [t["id"] for t in applicable_treatments]

                # Apply treatment effects
                modified_row = original_row.copy()
                for treatment in applicable_treatments:
                    for attr_name, new_value in treatment['effects'].items():
                        modified_row[attr_name] = new_value

                # Calculate before scores
                original_df = pd.DataFrame([original_row])
                before_scores_df = calculate_cyclerap_score_native(original_df)
                before_scores = {
                    "BB": float(before_scores_df["BB"].iloc[0]),
                    "BP": float(before_scores_df["BP"].iloc[0]),
                    "SB": float(before_scores_df["SB"].iloc[0]),
                    "VB": float(before_scores_df["VB"].iloc[0]),
                    "Overall Risk Level": float(before_scores_df["Overall Risk Level"].iloc[0])
                }

                # Calculate after scores
                modified_df = pd.DataFrame([modified_row])
                after_scores_df = calculate_cyclerap_score_native(modified_df)
                after_scores = {
                    "BB": float(after_scores_df["BB"].iloc[0]),
                    "BP": float(after_scores_df["BP"].iloc[0]),
                    "SB": float(after_scores_df["SB"].iloc[0]),
                    "VB": float(after_scores_df["VB"].iloc[0]),
                    "Overall Risk Level": float(after_scores_df["Overall Risk Level"].iloc[0])
                }

                # Update treatment dataframe
                if len(treatment_df) <= segment_index:
                    new_rows = [treatment_df.iloc[0].copy() if len(treatment_df) > 0 else {}] * (segment_index - len(treatment_df) + 1)
                    treatment_df = pd.concat([treatment_df, pd.DataFrame(new_rows)], ignore_index=True)

                # Update the row with modified attributes
                for col in modified_row.keys():
                    if col in treatment_df.columns:
                        treatment_df.at[segment_index, col] = modified_row[col]

                # Update "Treatments Applied" column
                if "Treatments Applied" not in treatment_df.columns:
                    treatment_df.insert(0, "Treatments Applied", "")

                treatment_df.at[segment_index, "Treatments Applied"] = ",".join(str(tid) for tid in treatment_ids)

                # Record details
                details.append({
                    "segment_index": segment_index,
                    "treatment_ids": treatment_ids,
                    "before_scores": before_scores,
                    "after_scores": after_scores
                })

                total_treated += 1

            except Exception:
                continue

        # Mark treatment dataframe as dirty but don't save yet
        # User must click "Save" button to persist changes
        # Directly assign to the existing treatment object's df property
        # This sets df_dirty=True via the property setter
        ver.treatment.df = treatment_df
        # NOTE: NOT calling proj.save_all() here - changes will be saved only when user clicks Save

        return jsonify({
            "ok": True,
            "total_segments": int(len(attrs_df)),
            "segments_treated": int(total_treated),
            "segments_skipped": int(len(attrs_df) - total_treated),
            "details": details
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return fail(f"Error applying all treatments: {str(e)}", 500)


@bp.post("/<project_name>/treatments/apply-specific")
@with_project(version=True)
def apply_specific_treatment(project_name: str, pm, proj, ver):
    """
    Apply a specific treatment to all applicable segments within a project.

    This endpoint analyzes each segment, checks if the given treatment_id is applicable,
    and applies it if so.

    Response:
        {
            "ok": true,
            "total_segments": 50,
            "segments_treated": 48,
            "segments_skipped": 2,
            "details": [ ... ]
        }
    """
    try:
        
        data = request.get_json(silent=True) or {}
        target_treatment_id = data.get("treatment_id")
        if not target_treatment_id:
            return fail("Missing treatment_id", 400)
            
        target_treatment = next((t for t in TREATMENTS if t["id"] == target_treatment_id), None)
        if not target_treatment:
            return fail(f"Invalid treatment_id: {target_treatment_id}", 400)

        attrs_df = ver.attributes.df
        treatment_df = ver.treatment.df.copy()

        if len(treatment_df) < len(attrs_df):
            new_rows = [{}] * (len(attrs_df) - len(treatment_df))
            treatment_df = pd.concat([treatment_df, pd.DataFrame(new_rows)], ignore_index=True)

        def is_treatment_applicable(attr_row, treatment):
            for trigger_set in treatment.get("triggers", []):
                all_match = True
                for attr_name, required_values in trigger_set.items():
                    if attr_name not in attr_row:
                        all_match = False
                        break
                    if attr_row[attr_name] not in required_values:
                        all_match = False
                        break
                if all_match:
                    return True
            return False

        for col in attrs_df.columns:
            if col not in treatment_df.columns:
                treatment_df[col] = None

        details = []
        total_treated = 0

        if "Treatments Applied" not in treatment_df.columns:
            treatment_df.insert(0, "Treatments Applied", "")

        for segment_index in range(len(attrs_df)):
            try:
                original_row = dict(attrs_df.iloc[segment_index])
                
                if not is_treatment_applicable(original_row, target_treatment):
                    continue
                
                existing_treatments_str = treatment_df.at[segment_index, "Treatments Applied"]
                existing_treatment_ids = []
                if pd.notna(existing_treatments_str) and str(existing_treatments_str).strip():
                    try:
                        existing_treatment_ids = [int(x.strip()) for x in str(existing_treatments_str).split(",") if x.strip()]
                    except ValueError:
                        pass
                
                if target_treatment_id in existing_treatment_ids:
                    continue # Already applied
                
                treatment_ids = existing_treatment_ids + [target_treatment_id]
                
                modified_row = original_row.copy()
                for tid in treatment_ids:
                    t_obj = next((t for t in TREATMENTS if t["id"] == tid), None)
                    if t_obj:
                        for attr_name, new_value in t_obj['effects'].items():
                            modified_row[attr_name] = new_value

                original_df = pd.DataFrame([original_row])
                before_scores_df = calculate_cyclerap_score_native(original_df)
                before_scores = {
                    "BB": float(before_scores_df["BB"].iloc[0]),
                    "BP": float(before_scores_df["BP"].iloc[0]),
                    "SB": float(before_scores_df["SB"].iloc[0]),
                    "VB": float(before_scores_df["VB"].iloc[0]),
                    "Overall Risk Level": float(before_scores_df["Overall Risk Level"].iloc[0])
                }

                modified_df = pd.DataFrame([modified_row])
                after_scores_df = calculate_cyclerap_score_native(modified_df)
                after_scores = {
                    "BB": float(after_scores_df["BB"].iloc[0]),
                    "BP": float(after_scores_df["BP"].iloc[0]),
                    "SB": float(after_scores_df["SB"].iloc[0]),
                    "VB": float(after_scores_df["VB"].iloc[0]),
                    "Overall Risk Level": float(after_scores_df["Overall Risk Level"].iloc[0])
                }

                for col in modified_row.keys():
                    if col in treatment_df.columns:
                        treatment_df.at[segment_index, col] = modified_row[col]

                treatment_df.at[segment_index, "Treatments Applied"] = ",".join(str(tid) for tid in treatment_ids)

                details.append({
                    "segment_index": segment_index,
                    "treatment_ids": treatment_ids,
                    "before_scores": before_scores,
                    "after_scores": after_scores
                })

                total_treated += 1

            except Exception:
                continue

        ver.treatment.df = treatment_df

        return jsonify({
            "ok": True,
            "total_segments": int(len(attrs_df)),
            "segments_treated": int(total_treated),
            "segments_skipped": int(len(attrs_df) - total_treated),
            "details": details
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return fail(f"Error applying specific treatment: {str(e)}", 500)


@bp.post("/<project_name>/treatments/reset-all")
@with_project(version=True)
def reset_all_treatments(project_name: str, pm, proj, ver):
    """
    Clear all applied treatments for all segments in a project.

    Response:
        {
            "ok": true,
            "total_segments": 50,
            "segments_reset": 48,
            "message": "All treatments have been reset"
        }
    """
    try:

        # Load treatment dataframe
        treatment_df = ver.treatment.df.copy()

        # Ensure treatment dataframe has same number of rows as attributes dataframe
        attrs_df = ver.attributes.df
        if len(treatment_df) < len(attrs_df):
            # Expand treatment dataframe to match attributes size
            new_rows = [{}] * (len(attrs_df) - len(treatment_df))
            treatment_df = pd.concat([treatment_df, pd.DataFrame(new_rows)], ignore_index=True)

        # Count how many segments had treatments
        if "Treatments Applied" in treatment_df.columns:
            # fillna("") ensures NaNs become empty strings. astype(str) ensures everything is string.
            # str.strip() removes distinct whitespace.
            # Then we check if length > 0.
            # This handles: NaN, None, "", "   ".
            # It counts ANY row that has non-empty treatment string.
            applied_col = treatment_df["Treatments Applied"].fillna("").astype(str).str.strip()
            segments_reset = int((applied_col != "").sum())
        else:
            segments_reset = 0

        # Clear "Treatments Applied" column for all rows
        if "Treatments Applied" in treatment_df.columns:
            treatment_df["Treatments Applied"] = ""

        # Reset all attribute columns to original values from attributes.csv
        attrs_df = ver.attributes.df
        for col in treatment_df.columns:
            if col != "Treatments Applied" and col in attrs_df.columns:
                # Copy original attribute values from attributes.csv
                if col in attrs_df.columns:
                    treatment_df[col] = attrs_df[col].values

        # Mark treatment dataframe as dirty but don't save yet
        # User must click "Save" button to persist changes
        # Directly assign to the existing treatment object's df property
        # This sets df_dirty=True via the property setter
        ver.treatment.df = treatment_df
        # NOTE: NOT calling proj.save_all() here - changes will be saved only when user clicks Save

        return jsonify({
            "ok": True,
            "total_segments": int(len(treatment_df)),
            "segments_reset": segments_reset,
            "message": "All treatments have been reset"
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return fail(f"Error resetting treatments: {str(e)}", 500)


@bp.post("/<project_name>/treatments/save")
@with_project(version=True)
def save_treatments(project_name: str, pm, proj, ver):
    """
    Save all pending treatment changes to treatment.csv

    Response:
        {
            "ok": true,
            "message": "Treatments saved successfully"
        }
    """
    try:

        # Save all pending changes
        proj.save_all()

        # Update last_updated
        proj.metadata.last_updated = datetime.datetime.now()
        proj.metadata.serialize(proj.project_path)

        return jsonify({
            "ok": True,
            "message": "Treatments saved successfully"
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return fail(f"Error saving treatments: {str(e)}", 500)
