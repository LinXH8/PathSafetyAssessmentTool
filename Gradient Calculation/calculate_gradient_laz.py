"""
calculate_gradient_laz.py
--------------------------
Compute path gradient using LiDAR LAZ point clouds and update gradient_lookup.csv.

Usage (from images — no project needed):
    python calculate_gradient_laz.py --laz-dir "E:\\tiles" --image-dir "C:\\...\\in"
    python calculate_gradient_laz.py --laz-dir "E:\\tiles" --image-dir "C:\\...\\in\\LORONG 1 TOA PAYOH"

Usage (from existing PSAT projects):
    python calculate_gradient_laz.py --laz-dir "E:\\tiles" --project-dir "C:\\...\\data\\TPYLor13Q25"
    python calculate_gradient_laz.py --laz-dir "E:\\tiles" --all-projects --data-dir "C:\\...\\data"

Image-dir mode:
    1. Scan subfolders of --image-dir for .jpg files (or a single folder)
    2. Extract GPS lat/lon from EXIF, convert to SVY21
    3. Sort images by timestamp, compute distance between consecutive points
    4. Query LAZ tiles for ground elevation at each point
    5. Smooth elevation, compute gradient_pct between consecutive images
    6. Classify Grade: 1 = <5 degrees, 2 = >=5 degrees
    7. Upsert results to backend/shapefiles/gradient_lookup.csv

Prerequisites:
    pip install laspy[lazrs] scipy numpy pandas Pillow pyproj
    (geopandas only needed for --project-dir / --all-projects mode)
"""

import argparse
import glob
import numpy as np
import pandas as pd
from pathlib import Path
from collections import defaultdict
from scipy.spatial import cKDTree
from pyproj import Transformer

import laspy

# ── Constants ─────────────────────────────────────────────────────────────────
# tan(5°) × 100 = 8.748 % — threshold between Grade 1 and Grade 2
GRADE_THRESHOLD_PCT = 8.748

# LAZ files for Singapore are in SVY21
CRS_SVY21 = "EPSG:3414"

# Elevation search / filtering
SEARCH_RADIUS = 5.0       # metres around each query point
Z_MIN = -5.0              # valid elevation floor (metres)
Z_MAX = 50.0              # valid elevation ceiling (Singapore highest road ~35 m)
GROUND_CLASS_ONLY = False  # set True to use only classification==2

# Gradient computation
GRAD_BASELINE_M = 5.0     # compute gradient over this distance (metres)
SMOOTH_WINDOW = 11         # rolling-median window for elevation smoothing
JUMP_THRESHOLD_M = 20.0   # consecutive images >20 m apart = new segment


# WGS84 → SVY21 transformer (created once)
_wgs84_to_svy21 = Transformer.from_crs("EPSG:4326", "EPSG:3414", always_xy=True)


# ── EXIF GPS extraction ──────────────────────────────────────────────────────

def _dms_to_decimal(dms_tuple, ref: str) -> float:
    """Convert EXIF GPS (degrees, minutes, seconds) + N/S/E/W to decimal."""
    d, m, s = [float(v) for v in dms_tuple]
    dec = d + m / 60.0 + s / 3600.0
    if ref in ("S", "W"):
        dec = -dec
    return dec


def extract_gps_from_images(image_dir: Path) -> pd.DataFrame:
    """Read all .jpg in a folder, extract EXIF GPS, return sorted DataFrame."""
    from PIL import Image
    from PIL.ExifTags import TAGS, GPSTAGS

    rows = []
    jpg_files = sorted(
        list(image_dir.glob("*.jpg")) + list(image_dir.glob("*.JPG")) +
        list(image_dir.glob("*.jpeg")) + list(image_dir.glob("*.JPEG"))
    )
    if not jpg_files:
        return pd.DataFrame()

    skipped = 0
    for img_path in jpg_files:
        try:
            with Image.open(img_path) as img:
                exif = img._getexif()
            if not exif:
                skipped += 1
                continue
            gps_info = exif.get(34853, {})  # GPSInfo tag
            if not gps_info or 2 not in gps_info or 4 not in gps_info:
                skipped += 1
                continue
            lat = _dms_to_decimal(gps_info[2], gps_info.get(1, "N"))
            lon = _dms_to_decimal(gps_info[4], gps_info.get(3, "E"))
            rows.append({
                "Image Reference": img_path.name,
                "lat": lat,
                "lon": lon,
            })
        except Exception:
            skipped += 1

    if skipped:
        print(f"  Skipped {skipped}/{len(jpg_files)} images (no GPS EXIF)")

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    # Sort by filename (timestamp-based naming gives chronological order)
    df = df.sort_values("Image Reference").reset_index(drop=True)
    return df


# ── LAZ querying functions ────────────────────────────────────────────────────

def index_laz_files(laz_dir: str) -> list[tuple]:
    """Recursively find .laz files and index their bounding boxes."""
    laz_files = glob.glob(f"{laz_dir}/**/*.laz", recursive=True)
    if not laz_files:
        laz_files = glob.glob(f"{laz_dir}/**/*.LAZ", recursive=True)
    print(f"Indexing {len(laz_files)} LAZ files...")
    index = []
    bad = 0
    for path in laz_files:
        try:
            with laspy.open(path) as f:
                h = f.header
                xmin, ymin = h.mins[0], h.mins[1]
                xmax, ymax = h.maxs[0], h.maxs[1]
                if xmin == 0 and ymin == 0 and xmax == 0 and ymax == 0:
                    raise ValueError("zeroed header")
                if xmax <= xmin or ymax <= ymin:
                    raise ValueError("inverted bounds")
                index.append((xmin, ymin, xmax, ymax, path))
        except Exception:
            bad += 1
            try:
                with laspy.open(path) as f:
                    chunk = next(f.chunk_iterator(50_000))
                    index.append((chunk.x.min(), chunk.y.min(),
                                  chunk.x.max(), chunk.y.max(), path))
            except Exception as e:
                print(f"  WARN: skipping {Path(path).name}: {e}")
    if bad:
        print(f"  NOTE: {bad} files had bad headers — used point bounds instead.")
    print(f"  → {len(index)} tiles indexed.\n")
    return index


def assign_points_to_tiles(coords: np.ndarray, laz_index: list) -> dict:
    """Map each coordinate to covering LAZ tiles by bounding box."""
    tile_to_pts = defaultdict(list)
    for xmin, ymin, xmax, ymax, path in laz_index:
        mask = (
            (coords[:, 0] >= xmin) & (coords[:, 0] <= xmax) &
            (coords[:, 1] >= ymin) & (coords[:, 1] <= ymax)
        )
        for idx in np.where(mask)[0]:
            tile_to_pts[path].append(idx)
    return tile_to_pts


def query_tile(tile_path: str, pt_indices: list, coords: np.ndarray) -> dict:
    """Load one LAZ tile and return {pt_index: elevation} for requested points."""
    results = {}
    with laspy.open(tile_path) as f:
        las = f.read()

    x = np.asarray(las.x, dtype=np.float64)
    y = np.asarray(las.y, dtype=np.float64)
    z = np.asarray(las.z, dtype=np.float64)

    if GROUND_CLASS_ONLY and hasattr(las, 'classification'):
        mask = np.asarray(las.classification) == 2
        x, y, z = x[mask], y[mask], z[mask]

    valid = (z >= Z_MIN) & (z <= Z_MAX)
    x, y, z = x[valid], y[valid], z[valid]
    if x.size == 0:
        return results

    tree = cKDTree(np.column_stack((x, y)))
    query_xy = coords[pt_indices]
    n = len(pt_indices)
    k = min(50, x.size)

    dists, idxs = tree.query(query_xy, k=k)
    dists = np.reshape(dists, (n, k))
    idxs = np.reshape(idxs, (n, k))

    for i, pt_idx in enumerate(pt_indices):
        within = dists[i] <= SEARCH_RADIUS
        if not within.any():
            continue
        z_local = z[idxs[i][within]]
        # Original method: lowest point as floor, keep within +1.5 m, take median
        z_floor = float(z_local.min())
        ground_band = z_local[z_local <= z_floor + 1.5]
        results[pt_idx] = float(np.median(ground_band))

    return results


def query_elevations(coords: np.ndarray, laz_index: list) -> np.ndarray:
    """Query LAZ tiles to get elevation for an array of (x, y) coordinates."""
    elevations = np.full(len(coords), np.nan)
    tile_to_pts = assign_points_to_tiles(coords, laz_index)

    uncovered = len(coords) - len({i for pts in tile_to_pts.values() for i in pts})
    if uncovered:
        print(f"  WARNING: {uncovered}/{len(coords)} points not covered by any LAZ tile.")

    total = len(tile_to_pts)
    for t, (tile_path, pt_indices) in enumerate(tile_to_pts.items(), 1):
        print(f"  [{t}/{total}] {Path(tile_path).name}  ({len(pt_indices)} points)...")
        try:
            results = query_tile(tile_path, pt_indices, coords)
            for pt_idx, elev in results.items():
                if np.isnan(elevations[pt_idx]):
                    elevations[pt_idx] = elev
                else:
                    # Average when same point appears in multiple tiles
                    elevations[pt_idx] = (elevations[pt_idx] + elev) / 2.0
        except Exception as e:
            print(f"    ERROR: {e}")

    return elevations


# ── Gradient from images (no project needed) ─────────────────────────────────

def compute_gradients_from_images(image_dir: Path, laz_index: list) -> pd.DataFrame:
    """Compute gradient for images in a folder using EXIF GPS + LAZ elevation."""

    print(f"\n{'=' * 60}")
    print(f"Street: {image_dir.name}")

    df = extract_gps_from_images(image_dir)
    if df.empty:
        print("  No images with GPS found — skipping.")
        return pd.DataFrame(columns=["Image Reference", "gradient_pct", "Grade"])

    n = len(df)
    print(f"  → {n} images with GPS")

    # Convert WGS84 → SVY21
    svy21_x, svy21_y = _wgs84_to_svy21.transform(
        df["lon"].values, df["lat"].values
    )
    coords = np.column_stack((svy21_x, svy21_y))

    # Query LAZ for elevation at each image location
    print(f"  Querying LAZ elevation for {n} points...")
    elevations = query_elevations(coords, laz_index)

    elev_valid = (~np.isnan(elevations)).sum()
    print(f"  Elevations found: {elev_valid}/{n}")
    if elev_valid == 0:
        print("  → No LAZ coverage for this street. Skipping.")
        return pd.DataFrame(columns=["Image Reference", "gradient_pct", "Grade"])

    # ── Detect GPS discontinuities and split into continuous segments ─────────
    step_dist = np.sqrt(np.diff(svy21_x) ** 2 + np.diff(svy21_y) ** 2)
    # Find break points where consecutive images jump > JUMP_THRESHOLD_M
    breaks = np.where(step_dist > JUMP_THRESHOLD_M)[0] + 1  # indices of first image after jump
    seg_starts = np.concatenate(([0], breaks))
    seg_ends = np.concatenate((breaks, [n]))
    n_segs = len(seg_starts)
    if n_segs > 1:
        print(f"  Detected {n_segs} continuous segments (split at {n_segs - 1} GPS jumps)")

    grad_per_image = np.full(n, np.nan)

    for seg_idx in range(n_segs):
        s, e = seg_starts[seg_idx], seg_ends[seg_idx]
        seg_len = e - s
        if seg_len < 3:
            continue  # too short for meaningful gradient

        seg_elev = elevations[s:e].copy()
        seg_x = svy21_x[s:e]
        seg_y = svy21_y[s:e]

        # Smooth elevation within this segment only
        win = min(SMOOTH_WINDOW, seg_len)
        seg_smooth = (pd.Series(seg_elev)
                      .rolling(window=win, center=True, min_periods=1)
                      .median().values)

        # Cumulative distance within segment
        _dx = np.diff(seg_x, prepend=seg_x[0])
        _dy = np.diff(seg_y, prepend=seg_y[0])
        cum_dist = np.cumsum(np.sqrt(_dx ** 2 + _dy ** 2))

        # Gradient over GRAD_BASELINE_M lookahead within this segment
        for _i in range(seg_len):
            _target = cum_dist[_i] + GRAD_BASELINE_M
            _j = int(np.searchsorted(cum_dist, _target))
            if _j >= seg_len:
                # Near end — look backward
                _target2 = cum_dist[_i] - GRAD_BASELINE_M
                _j = max(0, int(np.searchsorted(cum_dist, _target2)))
                _d = cum_dist[_i] - cum_dist[_j]
                _dz = seg_smooth[_i] - seg_smooth[_j]
            else:
                _d = cum_dist[_j] - cum_dist[_i]
                _dz = seg_smooth[_j] - seg_smooth[_i]
            if _d >= 1.0 and not np.isnan(_dz):
                grad_per_image[s + _i] = _dz / _d * 100.0

    grade = np.where(np.abs(grad_per_image) >= GRADE_THRESHOLD_PCT, 2, 1).astype(float)
    grade[np.isnan(grad_per_image)] = np.nan

    out = pd.DataFrame({
        "Image Reference": df["Image Reference"].values,
        "gradient_pct": np.round(grad_per_image, 3),
        "Grade": grade,
    })
    out["Grade"] = out["Grade"].fillna(1).astype(int)

    valid = (~np.isnan(grad_per_image)).sum()
    steep = (np.abs(grad_per_image[~np.isnan(grad_per_image)]) >= GRADE_THRESHOLD_PCT).sum()
    print(f"  Valid gradients : {valid}/{n}")
    if valid > 0:
        print(f"  Range           : {np.nanmin(grad_per_image):.2f}% to {np.nanmax(grad_per_image):.2f}%")
        print(f"  Grade 1 (<5°)   : {valid - steep}")
        print(f"  Grade 2 (≥5°)   : {steep}")

    return out


# ── Gradient from PSAT projects ──────────────────────────────────────────────

def compute_project_gradients(project_dir: Path, laz_index: list) -> pd.DataFrame:
    """Compute gradient for every segment in a project using LAZ elevation."""
    import geopandas as gpd

    gpkg_path = project_dir / "geo_data.gpkg"
    if not gpkg_path.exists():
        raise FileNotFoundError(f"geo_data.gpkg not found in {project_dir}")

    print(f"\n{'=' * 60}")
    print(f"Project: {project_dir.name}")
    print(f"Loading: {gpkg_path}")
    gdf = gpd.read_file(gpkg_path)
    n = len(gdf)
    print(f"  → {n} segments")

    if n == 0:
        return pd.DataFrame(columns=["Image Reference", "gradient_pct", "Grade"])

    # ── Reproject to SVY21 to match LAZ coordinates ───────────────────────────
    if gdf.crs is None:
        print(f"  [WARN] No CRS on geo_data.gpkg — assuming SVY21")
        gdf = gdf.set_crs(CRS_SVY21)
    gdf_proj = gdf.to_crs(CRS_SVY21)

    # ── Extract start/end coordinates of each segment ─────────────────────────
    starts = np.array([(geom.coords[0][0], geom.coords[0][1])
                       for geom in gdf_proj.geometry])
    ends = np.array([(geom.coords[-1][0], geom.coords[-1][1])
                     for geom in gdf_proj.geometry])

    # Stack all unique points for a single LAZ query pass
    all_pts = np.vstack([starts, ends])                     # shape (2N, 2)
    unique_pts, inverse = np.unique(all_pts, axis=0, return_inverse=True)

    print(f"  Querying elevation for {len(unique_pts)} unique endpoints...")
    elev_unique = query_elevations(unique_pts, laz_index)

    start_inv = inverse[:n]
    end_inv = inverse[n:]
    elev_start = elev_unique[start_inv]
    elev_end = elev_unique[end_inv]

    # ── Smooth elevations along path (same approach as SRTM script) ───────────
    point_elevs = np.full(n + 1, np.nan)
    point_elevs[:n] = elev_start
    point_elevs[n] = elev_end[-1]
    for i in range(1, n):
        a, b = elev_end[i - 1], elev_start[i]
        if not np.isnan(a) and not np.isnan(b):
            point_elevs[i] = (a + b) / 2.0
        elif not np.isnan(a):
            point_elevs[i] = a

    smoothed = (pd.Series(point_elevs)
                .rolling(window=5, center=True, min_periods=1)
                .median().values)
    elev_s = smoothed[:n]
    elev_e = smoothed[1:n + 1]

    # ── Gradient ──────────────────────────────────────────────────────────────
    length = gdf_proj.geometry.length.values
    dz = elev_e - elev_s
    with np.errstate(invalid="ignore", divide="ignore"):
        gradient = np.where(length > 0, dz / length * 100.0, np.nan)

    grade = np.where(np.abs(gradient) >= GRADE_THRESHOLD_PCT, 2, 1).astype(float)
    grade[np.isnan(gradient)] = np.nan

    # ── Build output ──────────────────────────────────────────────────────────
    img_refs = (gdf["Image Reference"].values if "Image Reference" in gdf.columns
                else gdf.get("image_ref", gdf.get("imageRef",
                     pd.Series(["unknown"] * n))).values)

    # Strip project-name prefix so key is portable
    proj_prefix = project_dir.name + "_"
    clean_refs = [
        r[len(proj_prefix):] if isinstance(r, str) and r.startswith(proj_prefix) else r
        for r in img_refs
    ]

    out = pd.DataFrame({
        "Image Reference": clean_refs,
        "gradient_pct": np.round(gradient, 3),
        "Grade": grade,
    })
    out["Grade"] = out["Grade"].fillna(1).astype(int)

    valid = (~np.isnan(gradient)).sum()
    steep = (np.abs(gradient[~np.isnan(gradient)]) >= GRADE_THRESHOLD_PCT).sum()
    print(f"  Valid gradients : {valid}/{n}")
    if valid > 0:
        print(f"  Range           : {np.nanmin(gradient):.2f}% to {np.nanmax(gradient):.2f}%")
        print(f"  Grade 1 (<5°)   : {valid - steep}")
        print(f"  Grade 2 (≥5°)   : {steep}")

    return out


# ── Lookup CSV management ─────────────────────────────────────────────────────

def _find_lookup_path(project_dir: Path) -> Path:
    """Walk up from project_dir to find backend/shapefiles/gradient_lookup.csv."""
    candidate = project_dir
    for _ in range(6):
        candidate = candidate.parent
        sf = candidate / "backend" / "shapefiles"
        if sf.exists():
            return sf / "gradient_lookup.csv"
    # Fallback: assume standard repo layout
    return Path(__file__).resolve().parent.parent / "backend" / "shapefiles" / "gradient_lookup.csv"


def update_lookup(new_rows: pd.DataFrame, lookup_path: Path) -> None:
    """Upsert new_rows into gradient_lookup.csv by Image Reference."""
    if lookup_path.exists():
        existing = pd.read_csv(lookup_path)
        # Drop rows that will be replaced
        existing = existing[~existing["Image Reference"].isin(new_rows["Image Reference"])]
        combined = pd.concat([existing, new_rows], ignore_index=True)
    else:
        lookup_path.parent.mkdir(parents=True, exist_ok=True)
        combined = new_rows

    combined.to_csv(lookup_path, index=False)
    print(f"\n  gradient_lookup.csv updated: {len(combined)} total entries → {lookup_path}")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Compute gradient from LAZ LiDAR data and update gradient_lookup.csv."
    )
    parser.add_argument("--laz-dir", required=True,
                        help="Directory containing .laz files (searched recursively).")

    # Image-dir mode (no project needed)
    parser.add_argument("--image-dir",
                        help="Directory of images with EXIF GPS. "
                             "If subfolders exist (e.g. in/), each subfolder is one street.")

    # Project mode
    parser.add_argument("--project-dir",
                        help="Single project directory (contains geo_data.gpkg).")
    parser.add_argument("--all-projects", action="store_true",
                        help="Process every sub-folder in --data-dir.")
    parser.add_argument("--data-dir",
                        help="Root data directory containing project folders.")

    args = parser.parse_args()

    if not args.image_dir and not args.project_dir and not args.all_projects:
        parser.error("Specify --image-dir, --project-dir, or --all-projects with --data-dir.")

    # ── Index LAZ tiles once ──────────────────────────────────────────────────
    laz_dir = args.laz_dir
    print(f"LAZ directory: {laz_dir}\n")
    laz_index = index_laz_files(laz_dir)
    if not laz_index:
        print("ERROR: No LAZ files found. Check --laz-dir path.")
        return

    all_rows = []

    # ── Image-dir mode ────────────────────────────────────────────────────────
    if args.image_dir:
        image_dir = Path(args.image_dir)
        # Check if it's a single street folder (contains images) or parent of street folders
        _IMG_GLOBS = ("*.jpg", "*.JPG", "*.jpeg", "*.JPEG")
        has_imgs = any(f for g in _IMG_GLOBS for f in image_dir.glob(g))
        if has_imgs:
            # Single street folder
            street_dirs = [image_dir]
        else:
            # Parent folder — each subfolder is a street
            street_dirs = sorted([
                d for d in image_dir.iterdir()
                if d.is_dir() and any(f for g in _IMG_GLOBS for f in d.glob(g))
            ])

        if not street_dirs:
            print(f"No image folders found in {image_dir}")
            return
        print(f"Found {len(street_dirs)} street folder(s)")

        for sd in street_dirs:
            try:
                rows = compute_gradients_from_images(sd, laz_index)
                if len(rows) > 0:
                    all_rows.append(rows)
            except Exception as exc:
                print(f"  [ERROR] {sd.name}: {exc}")

    # ── Project-dir mode ──────────────────────────────────────────────────────
    elif args.project_dir or args.all_projects:
        if args.all_projects:
            if not args.data_dir:
                parser.error("--all-projects requires --data-dir.")
            data_dir = Path(args.data_dir)
            project_dirs = sorted([
                p for p in data_dir.iterdir()
                if p.is_dir() and (p / "geo_data.gpkg").exists()
            ])
            if not project_dirs:
                print(f"No project directories with geo_data.gpkg found in {data_dir}")
                return
            print(f"Found {len(project_dirs)} project(s)")
        else:
            project_dirs = [Path(args.project_dir)]

        for pd_ in project_dirs:
            try:
                rows = compute_project_gradients(pd_, laz_index)
                if len(rows) > 0:
                    all_rows.append(rows)
            except Exception as exc:
                print(f"  [ERROR] {pd_.name}: {exc}")

    if not all_rows:
        print("\nNo gradients computed.")
        return

    combined = pd.concat(all_rows, ignore_index=True)

    # ── Update gradient_lookup.csv ────────────────────────────────────────────
    # Use repo-relative path
    lookup_path = Path(__file__).resolve().parent.parent / "backend" / "shapefiles" / "gradient_lookup.csv"
    if args.image_dir:
        ref_dir = Path(args.image_dir)
    elif args.project_dir:
        ref_dir = Path(args.project_dir)
    else:
        ref_dir = Path(args.data_dir)
    alt = _find_lookup_path(ref_dir)
    if alt.exists():
        lookup_path = alt

    update_lookup(combined, lookup_path)

    final = pd.read_csv(lookup_path)
    print(f"\n✓ Done.  gradient_lookup.csv now has {len(final)} entries.")


if __name__ == "__main__":
    main()
