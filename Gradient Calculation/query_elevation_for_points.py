"""
query_elevation_for_points.py
-------------------------------
For each 10m path point in a shapefile, query the nearest LAZ tile(s) to get
ground elevation, then calculate gradient between consecutive points.

Output: same shapefile + two new columns:
  - elevation_m   : median Z of nearby LiDAR points (metres)
  - gradient_pct  : rise/run to the NEXT point (%)  [NaN for last point]

Prerequisites:
  pip install laspy[lazrs] geopandas scipy numpy

IMPORTANT – point ordering:
  Gradient is computed between consecutive rows in the shapefile.
  Make sure your points are sorted by (route_id, sequence) before running.
  Quick sort example:
      gdf = gdf.sort_values(['route_id', 'seq']).reset_index(drop=True)
  Uncomment and edit the SORT section below if needed.
"""

import laspy
import geopandas as gpd
import numpy as np
from scipy.spatial import cKDTree
from pathlib import Path
from collections import defaultdict
import glob

# ── Config ────────────────────────────────────────────────────────────────────
SET = "F"

LAZ_BASE_DIR = r"E:\3D point cloud GSV_NorthEast_30092025\D_Hougang_LTA\LAZ"
POINTS_SHP   = r"C:\Users\Alaster\Documents\GitHub\PathSafetyAssessmentTool\backend\shapefiles\LinkID_Shape_File\31Oct24_Node_FUL.shp"
OUTPUT_DIR   = r"C:\Users\Alaster\Downloads\elevation_output"

# How far (metres) to search for LiDAR points around each path point.
SEARCH_RADIUS = 5.0

# Valid elevation range for Singapore (metres). Filters LiDAR noise/artifacts.
Z_MIN = -5.0    # below sea level drainage exists but not much lower
Z_MAX = 170.0   # Bukit Timah is ~164m, nothing higher in SG

# Only use ground-classified points (classification == 2)?
GROUND_CLASS_ONLY = False

# Limit number of LAZ files to process (set to None to process all).
MAX_LAZ_FILES = None
# ─────────────────────────────────────────────────────────────────────────────


def resolve_laz_dirs() -> list[str]:
    """Return list of LAZ subdirectories to process based on SET config."""
    if SET.upper() == "ALL":
        sets = ["Set A", "Set B", "Set C", "Set D", "Set E", "Set F"]
    else:
        sets = [f"Set {SET.upper()}"]
    dirs = []
    for s in sets:
        d = f"{LAZ_BASE_DIR}\\{s}"
        if not __import__('os').path.isdir(d):
            print(f"  WARN: directory not found: {d}")
        else:
            dirs.append(d)
    return dirs


def index_laz_files(laz_dirs: list[str]) -> list[tuple]:
    """Read LAZ bounding boxes from headers, falling back to actual points if headers are bad."""
    laz_files = []
    for d in laz_dirs:
        laz_files.extend(glob.glob(f"{d}/**/*.laz", recursive=True))
    if MAX_LAZ_FILES is not None:
        laz_files = laz_files[:MAX_LAZ_FILES]
    print(f"Indexing {len(laz_files)} LAZ files (headers only)...")
    index = []
    bad_headers = 0
    for path in laz_files:
        try:
            with laspy.open(path) as f:
                h = f.header
                xmin, ymin = h.mins[0], h.mins[1]
                xmax, ymax = h.maxs[0], h.maxs[1]
                # Sanity check: bounds must be non-zero and make geometric sense
                if xmin == 0 and ymin == 0 and xmax == 0 and ymax == 0:
                    raise ValueError("zeroed header bounds")
                if xmax <= xmin or ymax <= ymin:
                    raise ValueError("inverted header bounds")
                index.append((xmin, ymin, xmax, ymax, path))
        except Exception:
            # Fall back: sample first chunk of actual points to get real bounds
            bad_headers += 1
            try:
                with laspy.open(path) as f:
                    chunk = next(f.chunk_iterator(50_000))
                    index.append((chunk.x.min(), chunk.y.min(), chunk.x.max(), chunk.y.max(), path))
            except Exception as e:
                print(f"  WARN: skipping {Path(path).name}: {e}")
    if bad_headers:
        print(f"  NOTE: {bad_headers} files had bad headers — used actual point bounds instead.")
    print(f"  → {len(index)} files indexed.\n")
    if index:
        xmin, ymin, xmax, ymax, p = index[0]
        print(f"  Sample tile bounds: X [{xmin:.1f} → {xmax:.1f}]  Y [{ymin:.1f} → {ymax:.1f}]")
    return index


def assign_points_to_tiles(coords: np.ndarray, laz_index: list) -> dict:
    """Return {tile_path: [list of point indices]} using bounding-box lookup."""
    tile_to_pts = defaultdict(list)
    for xmin, ymin, xmax, ymax, path in laz_index:
        mask = (
            (coords[:, 0] >= xmin) & (coords[:, 0] <= xmax) &
            (coords[:, 1] >= ymin) & (coords[:, 1] <= ymax)
        )
        for idx in np.where(mask)[0]:
            tile_to_pts[path].append(idx)
    return tile_to_pts


def query_tile(tile_path: str, pt_indices: list, coords: np.ndarray,
               search_radius: float, ground_only: bool) -> dict:
    """Load one tile and return {pt_index: elevation} for the requested points."""
    results = {}
    with laspy.open(tile_path) as f:
        las = f.read()

    # Force plain numpy arrays
    x = np.asarray(las.x, dtype=np.float64)
    y = np.asarray(las.y, dtype=np.float64)
    z = np.asarray(las.z, dtype=np.float64)

    # Filter to ground class if requested
    if ground_only and hasattr(las, 'classification'):
        mask = np.asarray(las.classification) == 2
        x, y, z = x[mask], y[mask], z[mask]

    # Clamp to valid elevation range (removes LiDAR artifacts/noise)
    valid = (z >= Z_MIN) & (z <= Z_MAX)
    x, y, z = x[valid], y[valid], z[valid]

    if x.size == 0:
        return results

    tree = cKDTree(np.column_stack((x, y)))
    query_xy = coords[pt_indices]
    n = len(pt_indices)
    k = min(50, x.size)  # more neighbours for robust clustering

    dists, idxs = tree.query(query_xy, k=k)

    dists = np.reshape(dists, (n, k))
    idxs  = np.reshape(idxs,  (n, k))

    for i, pt_idx in enumerate(pt_indices):
        within = dists[i] <= search_radius
        if not within.any():
            continue  # no points in range — leave as NaN, don't guess
        z_local = z[idxs[i][within]]
        z_floor = z_local.min()
        ground_band = z_local[z_local <= z_floor + 1.5]
        results[pt_idx] = float(np.median(ground_band))

    return results


def main():
    import os

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    set_label = SET.upper()

    # ── Load path points ──────────────────────────────────────────────────────
    print(f"Loading path points from {POINTS_SHP}...")
    gdf = gpd.read_file(POINTS_SHP)
    print(f"  → {len(gdf)} points loaded (CRS: {gdf.crs})\n")

    coords = np.array([(geom.x, geom.y) for geom in gdf.geometry])

    # ── Load any previously completed sets so we don't overwrite progress ─────
    merged_csv = f"{OUTPUT_DIR}\\nodes_elevation_merged.csv"
    elevations = np.full(len(gdf), np.nan)
    if os.path.exists(merged_csv):
        import pandas as pd
        prev = pd.read_csv(merged_csv, index_col='index')
        existing = prev['elevation_m'].reindex(range(len(gdf))).values
        valid = ~np.isnan(existing)
        elevations[valid] = existing[valid]
        print(f"Loaded {valid.sum()} existing elevations from previous sets.\n")

    # ── Index LAZ tiles for this set ──────────────────────────────────────────
    laz_dirs = resolve_laz_dirs()
    print(f"Processing Set {set_label}: {laz_dirs}\n")
    laz_index = index_laz_files(laz_dirs)
    tile_to_pts = assign_points_to_tiles(coords, laz_index)

    uncovered = set(range(len(gdf))) - {i for pts in tile_to_pts.values() for i in pts}
    if uncovered:
        print(f"WARNING: {len(uncovered)} path points not covered by Set {set_label} tiles.\n")

    # ── Query elevation per tile ──────────────────────────────────────────────
    total_tiles = len(tile_to_pts)
    for t, (tile_path, pt_indices) in enumerate(tile_to_pts.items(), 1):
        print(f"[{t}/{total_tiles}] {Path(tile_path).name}  ({len(pt_indices)} points)...")
        try:
            results = query_tile(tile_path, pt_indices, coords, SEARCH_RADIUS, GROUND_CLASS_ONLY)
            for pt_idx, elev in results.items():
                if np.isnan(elevations[pt_idx]) or elev < elevations[pt_idx]:
                    elevations[pt_idx] = elev
        except Exception as e:
            print(f"  ERROR: {e}")

    # ── Save per-set output ───────────────────────────────────────────────────
    set_shp = f"{OUTPUT_DIR}\\nodes_elevation_set{set_label}.shp"
    set_csv = f"{OUTPUT_DIR}\\nodes_elevation_set{set_label}.csv"
    gdf['elevation_m'] = elevations.round(3)
    gdf.to_file(set_shp)
    gdf.drop(columns='geometry').to_csv(set_csv, index=False)

    # ── Save/update merged output (all sets so far) ───────────────────────────
    import pandas as pd
    merged_df = gdf.drop(columns='geometry').copy()
    merged_df.index.name = 'index'
    merged_df.to_csv(merged_csv)

    filled = (~np.isnan(elevations)).sum()
    print(f"\n✓ Set {set_label} done!")
    print(f"  Per-set shapefile : {set_shp}")
    print(f"  Per-set CSV       : {set_csv}")
    print(f"  Merged CSV        : {merged_csv}")
    print(f"  Points with elevation (total so far) : {filled} / {len(gdf)}")
    if filled > 0:
        print(f"  Elevation range : {np.nanmin(elevations):.1f}m to {np.nanmax(elevations):.1f}m")


if __name__ == "__main__":
    main()
