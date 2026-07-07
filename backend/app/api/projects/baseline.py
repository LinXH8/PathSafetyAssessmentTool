"""Baseline snapshot and autocode-metadata persistence routes."""
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

from ._helpers import df_to_records, fail, ok, with_project




# ===== Baseline Management Endpoints =====

@bp.get("/<project_name>/baseline/exists")
@with_project
def baseline_exists(project_name: str, pm, proj):
    """Check if baseline CSV exists for a project."""
    try:

        baseline_path = proj.project_path / "baseline" / f"{project_name}_baseline.csv"
        exists = baseline_path.exists()

        return ok({"exists": exists})
    except KeyError:
        return fail("Project not found", 404)
    except Exception as e:
        traceback.print_exc()
        return fail(f"Error checking baseline: {e}", 500)


@bp.get("/<project_name>/baseline")
@with_project
def get_baseline(project_name: str, pm, proj):
    """
    Get baseline CSV as JSON array of row dictionaries.

    Response:
        {
            "ok": true,
            "rows": [
                {"Facility Type": 2, "Area type": 1, ...},
                ...
            ]
        }
    """
    try:

        baseline_path = proj.project_path / "baseline" / f"{project_name}_baseline.csv"

        if not baseline_path.exists():
            return ok({"rows": []})  # No baseline yet

        # Read CSV and convert to JSON
        baseline_df = pd.read_csv(baseline_path)
        rows = df_to_records(baseline_df)

        return ok({"rows": rows})

    except KeyError:
        return fail("Project not found", 404)
    except Exception as e:
        traceback.print_exc()
        return fail(f"Error reading baseline: {e}", 500)


@bp.post("/<project_name>/baseline")
@with_project
def save_baseline(project_name: str, pm, proj):
    """
    Create or update baseline CSV for a project.

    Body:
        {
            "rows": [
                {"Facility Type": 2, "Area type": 1, ...},
                ...
            ]
        }

    Response:
        {
            "ok": true,
            "message": "Baseline saved successfully"
        }
    """
    try:

        data = request.get_json(force=True, silent=True) or {}
        rows = data.get("rows")

        if not isinstance(rows, list):
            return fail("rows must be an array", 400)

        # Create baseline directory if not exists
        baseline_dir = proj.project_path / "baseline"
        baseline_dir.mkdir(parents=True, exist_ok=True)

        # Create DataFrame and save to CSV
        baseline_df = pd.DataFrame(rows)
        baseline_path = baseline_dir / f"{project_name}_baseline.csv"
        baseline_df.to_csv(baseline_path, index=False, encoding='utf-8')

        return ok({"message": "Baseline saved successfully"})

    except KeyError:
        return fail("Project not found", 404)
    except Exception as e:
        traceback.print_exc()
        return fail(f"Error saving baseline: {e}", 500)

# ===== Autocode Metadata Management Endpoints =====

@bp.get("/<project_name>/autocode-metadata")
@with_project
def get_autocode_metadata(project_name: str, pm, proj):
    """
    Get autocode metadata (changed fields and sources) as JSON.
    
    Response:
        {
            "ok": true,
            "changedFieldsByRow": { "0": ["Field1"], ... },
            "fieldSourcesByRow": { "0": {"Field1": "GIS"}, ... }
        }
    """
    try:
        
        # Use 'autocode' directory for metadata
        autocode_dir = proj.project_path / "autocode"
        metadata_path = autocode_dir / f"{project_name}_metadata.json"
        
        if not metadata_path.exists():
            return ok({
                "changedFieldsByRow": {},
                "fieldSourcesByRow": {}
            })
            
        import json
        with open(metadata_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        return ok(data)

    except KeyError:
        return fail("Project not found", 404)
    except Exception as e:
        traceback.print_exc()
        return fail(f"Error reading autocode metadata: {e}", 500)

@bp.post("/<project_name>/autocode-metadata")
@with_project
def save_autocode_metadata(project_name: str, pm, proj):
    """
    Save autocode metadata (changed fields and sources) as JSON.
    
    Body:
        {
            "changedFieldsByRow": { ... },
            "fieldSourcesByRow": { ... }
        }
    """
    try:
        
        data = request.get_json(force=True, silent=True) or {}
        
        # Create autocode directory if not exists
        autocode_dir = proj.project_path / "autocode"
        autocode_dir.mkdir(parents=True, exist_ok=True)
        
        metadata_path = autocode_dir / f"{project_name}_metadata.json"
            
        import json
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            
        return ok({"message": "Autocode metadata saved successfully"})

    except KeyError:
        return fail("Project not found", 404)
    except Exception as e:
        traceback.print_exc()
        return fail(f"Error saving autocode metadata: {e}", 500)
