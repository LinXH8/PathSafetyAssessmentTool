"""
verify_gis_columns_v3.py — standalone, no app import needed
Compares actual .shp columns against gis_layer_definition.py directly.
"""

import re, sys
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Dict, Optional

# ── Inline minimal copies of the dataclass and LAYER_DEFINITIONS ─────────────
# (avoids any import chain issues)

@dataclass
class LayerDef:
    name: str
    required_columns: List[str]
    column_aliases: Dict[str, List[str]] = field(default_factory=dict)

DEFS: Dict[str, LayerDef] = {
    "Centralmb2025":        LayerDef("Centralmb2025",        ["PARKING_ZO (1)", "STATION_NA (2)"]),
    "area_type":            LayerDef("area_type",            ["LU_DESC (1)", "LU_TEXT (3)"],
                                     {"LU_DESC": ["LU_DESC","PARKING_ZO","STATION_NA","DESC","ZONE","NAME"],
                                      "LU_TEXT": ["LU_TEXT","LU_DESC","DESC","NAME"]}),
    "LanduseRural2026":     LayerDef("LanduseRural2026",     ["LU_DESC (1)", "LU_TEXT (3)"]),
    "LanduseRecre2026":     LayerDef("LanduseRecre2026",     ["LU_DESC (1)", "LU_TEXT (3)"]),
    "rural":                LayerDef("rural",                ["LU_DESC (1)", "LU_TEXT (3)"]),
    "recreation":           LayerDef("recreation",           ["LU_DESC (1)", "LU_TEXT (3)"]),
    "Mrt_exit":             LayerDef("Mrt_exit",             ["STATION_NA (1)", "EXIT_CODE (2)"],
                                     {"STATION_NA": ["STATION_NA","STATION_NAME","NAME","EXIT_CODE"]}),
    "bus_stop":             LayerDef("bus_stop",             ["BUS_STOP_N (1)", "LOC_DESC (3)"],
                                     {"BUS_STOP_N": ["BUS_STOP_N","BUS_STOP_NO","BUS_STOP_CODE","CODE","NAME","LOC_DESC"]}),
    "BusShelter":           LayerDef("BusShelter",           ["BUS_ROOF_N (1)", "LOC_DESC (2)"]),
    "bus_lane":             LayerDef("bus_lane",             ["TYP_CD (1)", "TYP_NAM (2)"]),
    "LIDAR_scan":           LayerDef("LIDAR_scan",           ["ELEVATION (1)"]),
    "Defects":              LayerDef("Defects",              ["DEFECT_TYP (1)"]),
    "pedestrian_crossing":  LayerDef("pedestrian_crossing",  ["UNIQUE_ID (1)"]),
    "parking_lot":          LayerDef("parking_lot",          ["PP_CODE (1)", "LOT_NO (2)", "TYPE (3)"]),
    "HDB_CAR_PARK_LOTS":    LayerDef("HDB_CAR_PARK_LOTS",   ["CARPARKNO (1)", "NOOFCARLOT (2)"]),
    "roadcrossinglayer":    LayerDef("roadcrossinglayer",    ["UNIQUE_ID (1)"]),
    "AMG_BC2025_shp":       LayerDef("AMG_BC2025_shp",      ["UNIQUE_ID (1)"]),
    "path":                 LayerDef("path",                 ["WIDTH (1)"],
                                     {"WIDTH": ["WIDTH","PATH_WIDTH","W_WIDTH","width","Width_m","WIDTH_M","Wdth","WID"]}),
    "cycling_path":         LayerDef("cycling_path",         ["WIDTH (1)"]),
    "shared_path":          LayerDef("shared_path",          ["WIDTH (1)"]),
    "footpath":             LayerDef("footpath",             ["WIDTH (1)"]),
    "CyclingPath_Jul2024":  LayerDef("CyclingPath_Jul2024",  ["path_width (1)", "path_type (2)"],
                                     {"path_width": ["path_width","WIDTH","width","W_WIDTH","Width_m","WIDTH_M"]}),
    "CyclingPathGazette":   LayerDef("CyclingPathGazette",   ["PLANNING_A (1)", "PLANNING_1 (2)"]),
    "FootPath_Mar2025":     LayerDef("FootPath_Mar2025",     ["WDT_CATG_C (1)", "TYP_CD (2)"],
                                     {"WDT_CATG_C": ["WDT_CATG_C","WIDTH","width","WDT_CATG_1"]}),
    "LinkID_Shape_File":    LayerDef("LinkID_Shape_File",    ["LK_ID_NUM (1)"],
                                     {"LK_ID_NUM": ["LK_ID_NUM","LINKID","LINK_ID","LinkID","ID","link_id"]}),
    "LinkID_Node":          LayerDef("LinkID_Node",          ["NODE_ID_NU (1)", "RD_TYP_CD (2)"]),
    "Speed_limit":          LayerDef("Speed_limit",          ["SPEEDLIMIT (1)"],
                                     {"SPEEDLIMIT": ["SPEEDLIMIT","SPEED_LIMIT","SPEED_LIM","speedlimit","speed_limit","LIMIT"]}),
    "kerb_line":            LayerDef("kerb_line",            ["LANES (1)", "LOCATION (2)", "DIRECTION (3)"],
                                     {"LANES": ["LANES","NUM_LANES","LANE_COUNT","UNIQUE_ID","ID"]}),
    "AMGbeforeCount":       LayerDef("AMGbeforeCount",       ["DataType (1)", "DateTime (2)", "Count_Data (3)"]),
    "AMGsensorCount":       LayerDef("AMGsensorCount",       ["Pivot_user (1)", "Datetime_p (2)", "Count (3)"]),
    "Planning_area":        LayerDef("Planning_area",        ["PLN_AREA_N (1)"]),
    "Road_name":            LayerDef("Road_name",            ["RD_CD_DESC (1)"],
                                     {"RD_CD_DESC": ["RD_CD_DESC","RD_NAM","RD_NAME","ROAD_NAME","NAME"]}),
    "Road_network_line":    LayerDef("Road_network_line",    ["RD_CD_DESC (1)"],  # was RD_TYP_CD — fixed
                                     {"RD_CD_DESC": ["RD_CD_DESC","RD_NAM","RD_NAME","ROAD_NAME","NAME"]}),
    "landuse":              LayerDef("landuse",              ["LU_DESC (1)", "LU_TEXT (2)"],  # new
                                     {"LU_DESC": ["LU_DESC","DESC","NAME"],
                                      "LU_TEXT": ["LU_TEXT","LU_DESC","DESC","NAME"]}),
    "URA_parking_lot":      LayerDef("URA_parking_lot",      ["PP_CODE (1)", "LOT_NO (2)", "TYPE (3)"]),  # new
    "HDB_carpark_lots":     LayerDef("HDB_carpark_lots",     ["CARPARKNO (1)", "NOOFCARLOT (2)"]),        # new alias
}

def clean(s: str) -> str:
    return re.sub(r'[^a-z0-9]', '', s.lower())

def resolve_def(category: str, fname_lower: str) -> Optional[LayerDef]:
    ld_key = category
    if category == "path":
        if "cycling" in fname_lower:   ld_key = "cycling_path"
        elif "shared" in fname_lower:  ld_key = "shared_path"
        elif "foot"   in fname_lower:  ld_key = "footpath"
    elif category == "area_type" and "central" in fname_lower:
        ld_key = "Centralmb2025"
    elif category == "LinkID_Shape_File" and "node" in fname_lower:
        ld_key = "LinkID_Node"
    elif category == "CyclingPath_Jul2024" and "gazette" in fname_lower:
        ld_key = "CyclingPathGazette"
    elif category == "parking_lot" and "hdb" in fname_lower:
        ld_key = "HDB_CAR_PARK_LOTS"
    elif category == "bus_stop" and "shelter" in fname_lower:
        ld_key = "BusShelter"

    # Direct
    if ld_key in DEFS: return DEFS[ld_key]
    # Case-insensitive
    ld_key_l = ld_key.lower()
    for k, v in DEFS.items():
        if k.lower() == ld_key_l: return v
    # Fuzzy
    cn = clean(ld_key)
    for k, v in DEFS.items():
        ck = clean(k)
        if ck and cn and (ck in cn or cn in ck): return v
    return None

def strip_idx(col: str) -> str:
    return col.split("(")[0].strip()

import geopandas as gpd

SHP_ROOT = Path(__file__).resolve().parents[1] / "backend" / "shapefiles"
rows = []

for shp_path in sorted(SHP_ROOT.rglob("*.shp")):
    if shp_path.name.startswith("._"): continue
    rel      = shp_path.relative_to(SHP_ROOT)
    category = rel.parts[0]
    filename = shp_path.name
    fname_lower = shp_path.name.lower()

    ld = resolve_def(category, fname_lower)

    try:
        gdf = gpd.read_file(str(shp_path))
        actual_cols = [c for c in gdf.columns if c != "geometry"]
    except Exception as e:
        rows.append({"status":"WARN","category":category,"file":filename,
                     "note":f"Could not read: {e}","required":[],"actual":[]})
        continue

    if not ld or not ld.required_columns:
        rows.append({"status":"NO_DEF","category":category,"file":filename,
                     "note":"No required_columns defined","required":[],"actual":actual_cols})
        continue

    actual_upper = {c.upper(): c for c in actual_cols}
    missing, resolved = [], []

    for req in ld.required_columns:
        req_bare = strip_idx(req)
        if req_bare.upper() in actual_upper:
            resolved.append(f"{req}=✓")
        else:
            aliases = ld.column_aliases.get(req_bare, [])
            alias_match = next((a for a in aliases if a.upper() in actual_upper), None)
            if alias_match:
                resolved.append(f"{req}=✓[via {alias_match}]")
            else:
                missing.append(req)

    status = "MISSING" if missing else "OK"
    note   = f"MISSING: {', '.join(missing)}" if missing else "All required columns present"
    rows.append({"status":status,"category":category,"file":filename,
                 "note":note,"required":ld.required_columns,"actual":actual_cols})

# ── Print ─────────────────────────────────────────────────────────────────────
W = 102
print("=" * W)
print(f"{'ST':<8} {'CATEGORY':<28} {'FILE':<38} NOTE")
print("=" * W)
symbols = {"OK":"[OK]    ","MISSING":"[MISS]  ","NO_DEF":"[NODEF] ","WARN":"[WARN]  "}
for r in rows:
    sym = symbols.get(r["status"], r["status"])
    print(f"{sym}  {r['category']:<28} {r['file']:<38} {r['note']}")

totals = {}
for r in rows: totals[r["status"]] = totals.get(r["status"], 0) + 1
print()
print("=" * W)
print(f"SUMMARY  ✅ OK: {totals.get('OK',0)}  ❌ MISSING: {totals.get('MISSING',0)}  🔵 NO_DEF: {totals.get('NO_DEF',0)}  ⚠️  WARN: {totals.get('WARN',0)}")
print("=" * W)

# Detail: problems
problems = [r for r in rows if r["status"] in ("MISSING","WARN")]
if problems:
    print("\nDETAIL — layers needing attention:")
    for r in problems:
        print(f"\n  ❌  {r['category']} / {r['file']}")
        print(f"     Required : {r['required']}")
        print(f"     Actual   : {r['actual']}")
        print(f"     Note     : {r['note']}")
else:
    print("\n✅ No MISSING column errors found.")

no_def = [r for r in rows if r["status"] == "NO_DEF"]
if no_def:
    print("\nINFO — layers with no required_columns definition:")
    for r in no_def:
        print(f"  🔵  {r['category']} / {r['file']}  actual: {r['actual']}")
