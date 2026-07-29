"""
build_path_gradient_profile.py
--------------------------------
Prototype path-based gradient pipeline.

This script does not key anything by image name globally. Instead it:
1. reads the ordered path segments from a project's geo_data.gpkg
2. stitches them into a single centerline
3. samples the centerline every N metres
4. estimates elevation at each sampled point from nearby LAZ points
5. computes gradient by chainage over a centered baseline
6. writes backend-managed review outputs

Outputs:
- gradient_profile.csv: one row per sampled chainage point
- node_gradient_preview.csv: current project rows mapped onto the profile for review only
- metadata.json: provenance for the current profile build

By default outputs are written to backend-managed storage, not to the user
project folder:
    backend/shapefiles/gradient_profiles/<path_key>/

The LiDAR bundle name is stored as provenance in metadata.json rather than used
as the master folder identity.

Example:
    python "Gradient Calculation/build_path_gradient_profile.py" ^
      --laz-dir "E:\\3D point cloud GSV_NorthEast_30092025\\Hougang_05_TPY_01" ^
      --project-dir "data\\TPYIndustrialPark3Q25" ^
      --path-key "toa_payoh_industrial_park" ^
      --max-samples 60
"""

from __future__ import annotations

import argparse
import glob
import json
import re
import sqlite3
from collections import Counter
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import laspy
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree
from shapely import wkb
from shapely.geometry import LineString
from shapely.ops import linemerge


GRADE_THRESHOLD_PCT = 8.748
K_NEAREST = 50
SEARCH_RADIUS = 5.0
Z_MIN = -5.0
Z_MAX = 50.0
LAZ_CHUNK_POINTS = 2_000_000
DEFAULT_SPACING_M = 2.0
DEFAULT_BASELINE_M = 10.0
DEFAULT_SMOOTH_WINDOW_M = 8.0
DEFAULT_OUTLIER_WINDOW_M = 14.0
DEFAULT_OUTLIER_DEV_M = 1.5
DEFAULT_STEP_JUMP_M = 0.3
DEFAULT_GRADIENT_SPIKE_THRESHOLD_PCT = 2.5
DEFAULT_GRADIENT_NEIGHBOR_TOL_PCT = 1.0


def _gpkg_blob_to_geometry(blob: bytes) -> LineString:
    if not blob or len(blob) < 8:
        raise ValueError("invalid geometry blob")

    flags = blob[3]
    envelope_indicator = (flags >> 1) & 0b111
    envelope_sizes = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
    header_size = 8 + envelope_sizes.get(envelope_indicator, 0)

    geom = wkb.loads(bytes(blob[header_size:]))
    if geom.geom_type == "LineString":
        return geom
    if geom.geom_type == "MultiLineString":
        merged = linemerge(geom)
        if merged.geom_type == "LineString":
            return merged
        return max(geom.geoms, key=lambda g: g.length)
    raise ValueError(f"unsupported geometry type: {geom.geom_type}")


def load_project_segments(project_dir: Path) -> list[dict]:
    gpkg_path = project_dir / "geo_data.gpkg"
    if not gpkg_path.exists():
        raise FileNotFoundError(f"geo_data.gpkg not found in {project_dir}")

    conn = sqlite3.connect(gpkg_path)
    try:
        cur = conn.cursor()
        rows = cur.execute(
            'SELECT fid, geom, "Image Reference", "Road Name", "Distance (Metres)" '
            'FROM geo_data ORDER BY fid'
        ).fetchall()
    finally:
        conn.close()

    segments = []
    for fid, geom_blob, image_ref, road_name, distance_m in rows:
        geom = _gpkg_blob_to_geometry(geom_blob)
        segments.append(
            {
                "fid": fid,
                "geometry": geom,
                "image_reference": image_ref,
                "road_name": road_name,
                "distance_m": float(distance_m) if distance_m is not None else float(geom.length),
            }
        )
    if not segments:
        raise ValueError(f"No segments found in {gpkg_path}")
    return segments


def _same_point(a: tuple[float, float], b: tuple[float, float], tol: float = 1e-3) -> bool:
    return abs(a[0] - b[0]) <= tol and abs(a[1] - b[1]) <= tol


def stitch_path_line(segments: list[dict]) -> LineString:
    stitched: list[tuple[float, float]] = []

    for segment in segments:
        coords = list(segment["geometry"].coords)
        if len(coords) < 2:
            continue
        if not stitched:
            stitched.extend(coords)
            continue

        end_pt = stitched[-1]
        start_dist = np.hypot(end_pt[0] - coords[0][0], end_pt[1] - coords[0][1])
        reverse_dist = np.hypot(end_pt[0] - coords[-1][0], end_pt[1] - coords[-1][1])
        if reverse_dist < start_dist:
            coords = list(reversed(coords))

        if _same_point(stitched[-1], coords[0]):
            stitched.extend(coords[1:])
        else:
            stitched.extend(coords)

    if len(stitched) < 2:
        raise ValueError("Could not stitch a usable centerline")
    return LineString(stitched)


def sample_line(line: LineString, spacing_m: float, max_samples: int | None = None) -> tuple[np.ndarray, np.ndarray]:
    total_length = float(line.length)
    chainages = np.arange(0.0, total_length + spacing_m * 0.5, spacing_m)
    if chainages[-1] < total_length:
        chainages = np.append(chainages, total_length)
    if max_samples is not None and len(chainages) > max_samples:
        chainages = chainages[:max_samples]

    coords = np.array([(line.interpolate(chain).x, line.interpolate(chain).y) for chain in chainages])
    return chainages, coords


def _normalize_road_token(value: str | None) -> str:
    if value is None:
        return ""
    token = re.sub(r"\s+", " ", str(value).strip()).upper()
    return token


def _default_road_sections_shp() -> Path:
    repo_root = Path(__file__).resolve().parent.parent
    candidates = [
        repo_root / "backend" / "shapefiles" / "planningareas" / "ROADSECTIONLINE.shp",
        repo_root / "backend" / "shapefiles" / "Road_name" / "ROADSECTIONLINE.shp",
        repo_root / "backend" / "shapefiles" / "Road_name" / "ROADNETWORKLINE.shp",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError("No road sections shapefile found for road boundary validation")


def nearest_road_labels(
    coords: np.ndarray,
    road_sections_shp: Path,
) -> tuple[np.ndarray, np.ndarray]:
    """Return nearest road name + distance for each sampled coordinate."""
    try:
        import geopandas as gpd
    except Exception as exc:
        raise RuntimeError(
            "Road boundary validation needs geopandas. Use the psat conda env or install geopandas."
        ) from exc

    road_gdf = gpd.read_file(str(road_sections_shp))
    road_name_col = next(
        (c for c in ("RD_NAM", "RD_NAME", "ROAD_NAME", "NAME", "RD_CD_DESC") if c in road_gdf.columns),
        None,
    )
    if road_name_col is None:
        raise RuntimeError(f"Road shapefile has no recognized road-name column: {road_sections_shp}")

    pts_gdf = gpd.GeoDataFrame(
        {"sample_idx": np.arange(len(coords), dtype=int)},
        geometry=gpd.points_from_xy(coords[:, 0], coords[:, 1]),
        crs="EPSG:3414",
    )
    if road_gdf.crs != pts_gdf.crs:
        road_gdf = road_gdf.to_crs(pts_gdf.crs)

    joined = gpd.sjoin_nearest(
        pts_gdf,
        road_gdf[[road_name_col, "geometry"]],
        how="left",
        distance_col="nearest_road_dist_m",
    )
    # sjoin_nearest can emit duplicate rows when multiple road segments are tied.
    joined = (
        joined.sort_values(["sample_idx", "nearest_road_dist_m", road_name_col], kind="stable")
        .drop_duplicates(subset=["sample_idx"], keep="first")
        .sort_values("sample_idx", kind="stable")
    )
    labels = (
        joined[road_name_col]
        .fillna("")
        .astype(str)
        .str.strip()
        .replace({"": "<blank>"})
        .to_numpy(dtype=object)
    )
    distances = joined["nearest_road_dist_m"].to_numpy(dtype=float)
    return labels, distances


def apply_road_boundary_policy(
    chainages: np.ndarray,
    coords: np.ndarray,
    target_road_name: str,
    target_road_aliases: list[str],
    offroad_policy: str,
    road_sections_shp: Path,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict]:
    road_labels, road_distances = nearest_road_labels(coords, road_sections_shp)

    allowed = {_normalize_road_token(target_road_name)}
    for alias in target_road_aliases:
        norm = _normalize_road_token(alias)
        if norm:
            allowed.add(norm)

    label_norm = np.array([_normalize_road_token(v) for v in road_labels], dtype=object)
    keep_mask = np.array([token in allowed for token in label_norm], dtype=bool)
    offroad_mask = ~keep_mask
    offroad_count = int(offroad_mask.sum())

    offroad_counter = Counter(road_labels[offroad_mask].tolist())
    offroad_top = [
        {"road_name": name, "point_count": int(count)}
        for name, count in offroad_counter.most_common(5)
    ]

    summary = {
        "target_road_name": target_road_name,
        "target_road_aliases": target_road_aliases,
        "offroad_policy": offroad_policy,
        "road_sections_shp": str(road_sections_shp),
        "total_points": int(len(chainages)),
        "offroad_point_count": offroad_count,
        "offroad_top_road_names": offroad_top,
    }
    if offroad_count:
        off_chainages = chainages[offroad_mask]
        summary["offroad_chainage_min_m"] = round(float(off_chainages.min()), 3)
        summary["offroad_chainage_max_m"] = round(float(off_chainages.max()), 3)

    if offroad_count:
        print("\nRoad boundary check:")
        print(f"  target: {target_road_name}")
        print(f"  off-road points: {offroad_count}/{len(chainages)}")
        for item in offroad_top:
            print(f"    - {item['road_name']}: {item['point_count']}")

        if offroad_policy == "fail":
            raise SystemExit(
                "Road boundary validation failed. "
                f"Off-road points found at chainage {summary.get('offroad_chainage_min_m')}.."
                f"{summary.get('offroad_chainage_max_m')} m. "
                "Re-run with --offroad-policy trim to auto-remove them if intended."
            )
        if offroad_policy == "trim":
            chainages = chainages[keep_mask]
            coords = coords[keep_mask]
            road_labels = road_labels[keep_mask]
            road_distances = road_distances[keep_mask]
            summary["trimmed_offroad_points"] = offroad_count
            print(f"  trimmed off-road points: {offroad_count}")
        else:
            print("  continuing without trimming (warn policy)")
    else:
        print("\nRoad boundary check: no off-road points detected")

    if len(chainages) == 0:
        raise SystemExit("Road boundary trimming removed all sampled points")

    return chainages, coords, road_labels, road_distances, summary


def index_laz_files(laz_dir: Path) -> list[tuple[float, float, float, float, str]]:
    laz_files = glob.glob(str(laz_dir / "**" / "*.laz"), recursive=True)
    laz_files.extend(glob.glob(str(laz_dir / "**" / "*.LAZ"), recursive=True))
    laz_files = sorted(set(laz_files))

    print(f"Indexing {len(laz_files)} LAZ files...")
    indexed = []
    for path in laz_files:
        try:
            with laspy.open(path) as handle:
                header = handle.header
                xmin, ymin = header.mins[0], header.mins[1]
                xmax, ymax = header.maxs[0], header.maxs[1]
                if xmax <= xmin or ymax <= ymin:
                    raise ValueError("invalid bounds")
                indexed.append((xmin, ymin, xmax, ymax, path))
        except Exception as exc:
            print(f"  WARN: skipping {Path(path).name}: {exc}")
    print(f"  -> {len(indexed)} usable tiles\n")
    return indexed


def assign_points_to_tiles(coords: np.ndarray, laz_index: list[tuple[float, float, float, float, str]]) -> dict[str, list[int]]:
    assignments: dict[str, list[int]] = defaultdict(list)
    for xmin, ymin, xmax, ymax, path in laz_index:
        mask = (
            (coords[:, 0] >= xmin) & (coords[:, 0] <= xmax) &
            (coords[:, 1] >= ymin) & (coords[:, 1] <= ymax)
        )
        for idx in np.where(mask)[0]:
            assignments[path].append(int(idx))
    return assignments


def query_tile(tile_path: str, pt_indices: list[int], coords: np.ndarray, search_radius: float) -> dict[int, float]:
    results: dict[int, float] = {}
    if not pt_indices:
        return results

    query_xy = coords[pt_indices]
    min_x = float(query_xy[:, 0].min() - search_radius)
    min_y = float(query_xy[:, 1].min() - search_radius)
    max_x = float(query_xy[:, 0].max() + search_radius)
    max_y = float(query_xy[:, 1].max() + search_radius)

    x_parts: list[np.ndarray] = []
    y_parts: list[np.ndarray] = []
    z_parts: list[np.ndarray] = []
    with laspy.open(tile_path) as handle:
        for chunk in handle.chunk_iterator(LAZ_CHUNK_POINTS):
            x = np.asarray(chunk.x, dtype=np.float64)
            y = np.asarray(chunk.y, dtype=np.float64)
            z = np.asarray(chunk.z, dtype=np.float64)
            valid = (
                (z >= Z_MIN) & (z <= Z_MAX) &
                (x >= min_x) & (x <= max_x) &
                (y >= min_y) & (y <= max_y)
            )
            if valid.any():
                x_parts.append(x[valid])
                y_parts.append(y[valid])
                z_parts.append(z[valid])

    if not x_parts:
        return results

    x = np.concatenate(x_parts)
    y = np.concatenate(y_parts)
    z = np.concatenate(z_parts)
    if x.size == 0:
        return results

    tree = cKDTree(np.column_stack((x, y)))
    k = min(K_NEAREST, x.size)
    dists, idxs = tree.query(query_xy, k=k)
    if k == 1:
        dists = np.asarray(dists)[:, np.newaxis]
        idxs = np.asarray(idxs)[:, np.newaxis]
    else:
        dists = np.asarray(dists)
        idxs = np.asarray(idxs)

    for row_idx, pt_idx in enumerate(pt_indices):
        within = dists[row_idx] <= search_radius
        if not within.any():
            continue
        z_local = z[idxs[row_idx][within]]
        z_floor = float(z_local.min())
        ground_band = z_local[z_local <= z_floor + 1.5]
        if ground_band.size == 0:
            continue
        results[pt_idx] = float(np.median(ground_band))

    return results


def query_profile_elevations(coords: np.ndarray, laz_index: list[tuple[float, float, float, float, str]], search_radius: float) -> np.ndarray:
    elevations = np.full(len(coords), np.nan)
    per_point: dict[int, list[float]] = defaultdict(list)
    tile_to_pts = assign_points_to_tiles(coords, laz_index)

    uncovered = len(coords) - len({idx for indices in tile_to_pts.values() for idx in indices})
    if uncovered:
        print(f"WARNING: {uncovered}/{len(coords)} sample points not covered by any tile")

    total = len(tile_to_pts)
    for tile_no, (tile_path, pt_indices) in enumerate(tile_to_pts.items(), start=1):
        print(f"  [{tile_no}/{total}] {Path(tile_path).name} ({len(pt_indices)} samples)")
        try:
            results = query_tile(tile_path, pt_indices, coords, search_radius)
            for pt_idx, elev in results.items():
                per_point[pt_idx].append(elev)
        except Exception as exc:
            print(f"    ERROR: {exc}")

    for pt_idx, values in per_point.items():
        elevations[pt_idx] = float(np.mean(values))

    return elevations


def filter_elevation_outliers(raw_elevations: np.ndarray, spacing_m: float, window_m: float, deviation_m: float) -> tuple[np.ndarray, int]:
    window = max(5, int(round(window_m / spacing_m)))
    if window % 2 == 0:
        window += 1

    series = pd.Series(raw_elevations, dtype=float)
    local_median = series.rolling(window=window, center=True, min_periods=max(3, window // 2)).median()
    deviation = (series - local_median).abs()
    outlier_mask = local_median.notna() & deviation.gt(deviation_m)

    filtered = series.copy()
    filtered[outlier_mask] = np.nan
    filtered = filtered.interpolate(limit=2, limit_direction="both")
    return filtered.to_numpy(dtype=float), int(outlier_mask.sum())


def filter_elevation_step_jumps(filtered_elevations: np.ndarray, max_step_m: float) -> tuple[np.ndarray, int, np.ndarray]:
    series = pd.Series(filtered_elevations, dtype=float)
    series = series.interpolate(limit=3, limit_direction="both")
    rejected = np.zeros(len(series), dtype=bool)

    for _ in range(6):
        values = series.to_numpy(dtype=float)
        jump_positions = np.flatnonzero(np.abs(np.diff(values)) > max_step_m)
        if len(jump_positions) == 0:
            break

        changed = False
        for left_idx in jump_positions:
            candidates: list[tuple[float, int]] = []
            for cand_idx in (left_idx, left_idx + 1):
                if pd.isna(series.iloc[cand_idx]):
                    continue
                lo = max(0, cand_idx - 3)
                hi = min(len(series), cand_idx + 4)
                window = series.iloc[lo:hi].drop(labels=series.index[cand_idx]).dropna()
                if len(window) < 2:
                    continue
                score = abs(float(series.iloc[cand_idx]) - float(window.median()))
                candidates.append((score, cand_idx))

            if not candidates:
                continue

            _, bad_idx = max(candidates)
            if not pd.isna(series.iloc[bad_idx]):
                series.iloc[bad_idx] = np.nan
                rejected[bad_idx] = True
                changed = True

        if not changed:
            break

        series = series.interpolate(limit=3, limit_direction="both")

    return series.to_numpy(dtype=float), int(rejected.sum()), rejected


def smooth_elevations(raw_elevations: np.ndarray, spacing_m: float, smooth_window_m: float) -> np.ndarray:
    window = max(3, int(round(smooth_window_m / spacing_m)))
    if window % 2 == 0:
        window += 1

    series = pd.Series(raw_elevations)
    series = series.interpolate(limit=2, limit_direction="both")
    smoothed = series.rolling(window=window, center=True, min_periods=max(2, window // 2)).median()
    return smoothed.to_numpy(dtype=float)


def compute_gradients(
    smoothed_elevations: np.ndarray,
    chainages: np.ndarray,
    spacing_m: float,
    baseline_m: float,
    rejected_step_jump_mask: np.ndarray | None = None,
    endpoint_guard_points: int = 0,
) -> np.ndarray:
    gradients = np.full(len(chainages), np.nan)
    half_window = max(1, int(round((baseline_m / 2.0) / spacing_m)))

    for idx in range(len(chainages)):
        left = max(0, idx - half_window)
        right = min(len(chainages) - 1, idx + half_window)
        if left == right:
            continue
        if rejected_step_jump_mask is not None:
            left_guard_lo = max(0, left - endpoint_guard_points)
            left_guard_hi = min(len(chainages), left + endpoint_guard_points + 1)
            right_guard_lo = max(0, right - endpoint_guard_points)
            right_guard_hi = min(len(chainages), right + endpoint_guard_points + 1)
            if (
                rejected_step_jump_mask[left_guard_lo:left_guard_hi].any()
                or rejected_step_jump_mask[right_guard_lo:right_guard_hi].any()
            ):
                continue
        z_left = smoothed_elevations[left]
        z_right = smoothed_elevations[right]
        if np.isnan(z_left) or np.isnan(z_right):
            continue
        distance = chainages[right] - chainages[left]
        if distance <= 0:
            continue
        gradients[idx] = (z_right - z_left) / distance * 100.0

    return gradients


def repair_bad_gradient_points(
    gradients: np.ndarray,
    spike_threshold_pct: float = DEFAULT_GRADIENT_SPIKE_THRESHOLD_PCT,
    neighbor_tolerance_pct: float = DEFAULT_GRADIENT_NEIGHBOR_TOL_PCT,
) -> tuple[np.ndarray, int, int]:
    """
    Apply the operating rule:
    - one bad point -> average nearest valid areas
    - an entire bad stretch -> remove results
    """
    cleaned = gradients.copy()
    repaired_count = 0
    removed_count = 0

    idx = 1
    while idx < len(cleaned) - 1:
        left = cleaned[idx - 1]
        cur = cleaned[idx]
        if np.isnan(left) or np.isnan(cur):
            idx += 1
            continue
        if abs(cur - left) < spike_threshold_pct:
            idx += 1
            continue

        run_start = idx
        run_end = idx
        while run_end + 1 < len(cleaned) - 1:
            current = cleaned[run_end]
            next_value = cleaned[run_end + 1]
            if np.isnan(current) or np.isnan(next_value):
                break
            if abs(next_value - current) >= spike_threshold_pct:
                break
            run_end += 1

        if run_end + 1 >= len(cleaned):
            break

        right = cleaned[run_end + 1]
        if np.isnan(right):
            idx = run_end + 1
            continue

        neighbor_mean = (left + right) / 2.0
        run_mean = float(np.nanmean(cleaned[run_start:run_end + 1]))
        if abs(left - right) <= neighbor_tolerance_pct and abs(run_mean - neighbor_mean) >= spike_threshold_pct:
            run_len = run_end - run_start + 1
            if run_len == 1:
                cleaned[run_start] = neighbor_mean
                repaired_count += 1
            else:
                cleaned[run_start:run_end + 1] = np.nan
                removed_count += run_len
            idx = run_end + 1
            continue

        idx += 1

    idx = 0
    while idx < len(cleaned):
        if not np.isnan(cleaned[idx]):
            idx += 1
            continue
        end = idx + 1
        while end < len(cleaned) and np.isnan(cleaned[end]):
            end += 1

        run_len = end - idx
        left_idx = idx - 1
        right_idx = end
        if run_len == 1 and left_idx >= 0 and right_idx < len(cleaned):
            left = cleaned[left_idx]
            right = cleaned[right_idx]
            if not np.isnan(left) and not np.isnan(right):
                cleaned[idx] = (left + right) / 2.0
                repaired_count += 1

        idx = end

    return cleaned, repaired_count, removed_count


def build_profile_dataframe(
    path_key: str,
    source_project: str,
    chainages: np.ndarray,
    coords: np.ndarray,
    raw_elevations: np.ndarray,
    filtered_elevations: np.ndarray,
    smoothed_elevations: np.ndarray,
    gradients: np.ndarray,
    nearest_road_names: np.ndarray | None = None,
    nearest_road_distances: np.ndarray | None = None,
) -> pd.DataFrame:
    grades = np.where(np.abs(gradients) >= GRADE_THRESHOLD_PCT, 2, 1).astype(float)
    grades[np.isnan(gradients)] = np.nan
    data = {
        "path_key": path_key,
        "source_project": source_project,
        "chainage_m": np.round(chainages, 3),
        "x_svy21": np.round(coords[:, 0], 3),
        "y_svy21": np.round(coords[:, 1], 3),
        "elevation_m_raw": np.round(raw_elevations, 3),
        "elevation_m_filtered": np.round(filtered_elevations, 3),
        "elevation_m_smooth": np.round(smoothed_elevations, 3),
        "gradient_pct": np.round(gradients, 3),
        "Grade": grades,
    }
    if nearest_road_names is not None:
        data["nearest_road_name"] = nearest_road_names
    if nearest_road_distances is not None:
        data["nearest_road_dist_m"] = np.round(nearest_road_distances, 3)
    return pd.DataFrame(data)


def build_node_preview(path_key: str, line: LineString, segments: list[dict], profile_df: pd.DataFrame) -> pd.DataFrame:
    chainages = profile_df["chainage_m"].to_numpy(dtype=float)
    step = float(np.median(np.diff(chainages))) if len(chainages) > 1 else 0.0
    tolerance = max(step * 1.5, 1.0)
    preview_rows = []

    for segment in segments:
        midpoint = segment["geometry"].interpolate(0.5, normalized=True)
        chainage = float(line.project(midpoint))
        profile_idx = int(np.argmin(np.abs(chainages - chainage)))
        profile_row = profile_df.iloc[profile_idx]
        if abs(float(profile_row["chainage_m"]) - chainage) > tolerance:
            elevation_m = float("nan")
            gradient_pct = float("nan")
            grade = float("nan")
            profile_chainage_m = float("nan")
        else:
            elevation_m = profile_row["elevation_m_smooth"]
            gradient_pct = profile_row["gradient_pct"]
            grade = profile_row["Grade"]
            profile_chainage_m = profile_row["chainage_m"]
        preview_rows.append(
            {
                "path_key": path_key,
                "fid": segment["fid"],
                "Image Reference": segment["image_reference"],
                "Road Name": segment["road_name"],
                "segment_length_m": round(segment["distance_m"], 3),
                "assigned_chainage_m": round(chainage, 3),
                "profile_chainage_m": profile_chainage_m,
                "elevation_m": elevation_m,
                "gradient_pct": gradient_pct,
                "Grade": grade,
            }
        )

    return pd.DataFrame(preview_rows)


def load_project_metadata(project_dir: Path) -> dict:
    metadata_path = project_dir / "project_metadata.json"
    if not metadata_path.exists():
        return {}
    try:
        return json.loads(metadata_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def derive_path_key(project_dir: Path, explicit_key: str | None) -> str:
    if explicit_key:
        raw = explicit_key
    else:
        project_metadata = load_project_metadata(project_dir)
        raw = (
            project_metadata.get("path_key")
            or project_metadata.get("dataset")
            or re.sub(r"(?:\dQ\d{2,4}|Q\d{4})$", "", project_dir.name, flags=re.IGNORECASE)
        )

    key = re.sub(r"[^A-Za-z0-9]+", "_", raw).strip("_").lower()
    if not key:
        raise ValueError("Could not derive a valid path key")
    return key


def default_output_dir(path_key: str) -> Path:
    repo_root = Path(__file__).resolve().parent.parent
    return repo_root / "backend" / "shapefiles" / "gradient_profiles" / path_key


def build_metadata(
    path_key: str,
    project_dir: Path,
    laz_dir: Path,
    centerline: LineString,
    args: argparse.Namespace,
    chainages: np.ndarray,
    raw_elevations: np.ndarray,
    rejected_outlier_count: int,
    rejected_step_jump_count: int,
    gradients: np.ndarray,
    repaired_gradient_point_count: int = 0,
    removed_bad_gradient_point_count: int = 0,
    road_boundary_summary: dict | None = None,
) -> dict:
    minx, miny, maxx, maxy = centerline.bounds
    profile_point_count = int(len(chainages))
    valid_elevation_count = int(np.count_nonzero(~np.isnan(raw_elevations)))
    valid_gradient_count = int(np.count_nonzero(~np.isnan(gradients)))
    if profile_point_count > 0:
        usable_gradient_completion_pct = round(valid_gradient_count / profile_point_count * 100.0, 2)
        elevation_hit_coverage_pct = round(valid_elevation_count / profile_point_count * 100.0, 2)
        step_jump_rejection_pct = round(rejected_step_jump_count / profile_point_count * 100.0, 2)
    else:
        usable_gradient_completion_pct = None
        elevation_hit_coverage_pct = None
        step_jump_rejection_pct = None
    metadata = {
        "path_key": path_key,
        "display_name": args.display_name.strip() if args.display_name else project_dir.name,
        "source_project": project_dir.name,
        "source_geo_data": str((project_dir / "geo_data.gpkg").resolve()),
        "lidar_bundle": laz_dir.name,
        "lidar_root": str(laz_dir.resolve()),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "spacing_m": args.spacing_m,
        "baseline_m": args.baseline_m,
        "smooth_window_m": args.smooth_window_m,
        "search_radius_m": args.search_radius,
        "max_samples": args.max_samples,
        "centerline_length_m": round(float(centerline.length), 3),
        "profile_point_count": profile_point_count,
        "valid_elevation_count": valid_elevation_count,
        "rejected_outlier_count": rejected_outlier_count,
        "rejected_step_jump_count": rejected_step_jump_count,
        "repaired_gradient_point_count": repaired_gradient_point_count,
        "removed_bad_gradient_point_count": removed_bad_gradient_point_count,
        "valid_gradient_count": valid_gradient_count,
        "usable_gradient_completion_pct": usable_gradient_completion_pct,
        "elevation_hit_coverage_pct": elevation_hit_coverage_pct,
        "step_jump_rejection_pct": step_jump_rejection_pct,
        "gradient_min_pct": None if np.isnan(gradients).all() else round(float(np.nanmin(gradients)), 3),
        "gradient_max_pct": None if np.isnan(gradients).all() else round(float(np.nanmax(gradients)), 3),
        "path_bounds_svy21": {
            "min_x": round(float(minx), 3),
            "min_y": round(float(miny), 3),
            "max_x": round(float(maxx), 3),
            "max_y": round(float(maxy), 3),
        },
    }
    if road_boundary_summary is not None:
        metadata["road_boundary"] = road_boundary_summary
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description="Prototype chainage-based gradient profile builder")
    parser.add_argument("--laz-dir", required=True, help="Directory containing LAZ files (searched recursively)")
    parser.add_argument("--project-dir", required=True, help="Project directory containing geo_data.gpkg")
    parser.add_argument("--path-key", help="Stable master-data key for this path/profile (recommended; not tied to project name)")
    parser.add_argument("--output-dir", help="Directory for CSV outputs; defaults to backend/shapefiles/gradient_profiles/<path_key>")
    parser.add_argument("--spacing-m", type=float, default=DEFAULT_SPACING_M, help="Sample spacing along the path")
    parser.add_argument("--baseline-m", type=float, default=DEFAULT_BASELINE_M, help="Centered baseline used for gradient")
    parser.add_argument("--smooth-window-m", type=float, default=DEFAULT_SMOOTH_WINDOW_M, help="Smoothing window for elevation profile")
    parser.add_argument("--outlier-window-m", type=float, default=DEFAULT_OUTLIER_WINDOW_M, help="Window used to detect elevation outliers")
    parser.add_argument("--outlier-dev-m", type=float, default=DEFAULT_OUTLIER_DEV_M, help="Deviation from local median above which an elevation sample is rejected")
    parser.add_argument("--search-radius", type=float, default=SEARCH_RADIUS, help="Radius around each sample point for LAZ lookup")
    parser.add_argument("--max-samples", type=int, help="Prototype cap on the number of sampled chainage points")
    parser.add_argument("--target-road-name", help="Primary road name to enforce for sampled profile points")
    parser.add_argument("--target-road-alias", action="append", default=[], help="Additional allowed road names when enforcing road boundaries")
    parser.add_argument("--display-name", help="Override display_name stored in metadata.json")
    parser.add_argument("--offroad-policy", choices=["fail", "trim", "warn"], default="fail", help="Behavior when sampled points nearest-map to roads outside the allowed road names")
    parser.add_argument("--road-sections-shp", help="Optional path to ROADSECTIONLINE/ROADNETWORKLINE shapefile for road boundary validation")
    args = parser.parse_args()

    project_dir = Path(args.project_dir)
    laz_dir = Path(args.laz_dir)
    path_key = derive_path_key(project_dir, args.path_key)
    output_dir = Path(args.output_dir) if args.output_dir else default_output_dir(path_key)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Project: {project_dir}")
    print(f"Path key: {path_key}")
    segments = load_project_segments(project_dir)
    print(f"Loaded {len(segments)} ordered segments")
    centerline = stitch_path_line(segments)
    print(f"Centerline length: {centerline.length:.1f} m")

    chainages, coords = sample_line(centerline, args.spacing_m, args.max_samples)
    if args.max_samples is not None:
        print(f"Prototype mode: capped to {len(chainages)} sampled chainage points")
    else:
        print(f"Sampled {len(chainages)} chainage points")

    nearest_road_names: np.ndarray | None = None
    nearest_road_distances: np.ndarray | None = None
    road_boundary_summary: dict | None = None
    if args.target_road_name:
        road_shp = Path(args.road_sections_shp) if args.road_sections_shp else _default_road_sections_shp()
        chainages, coords, nearest_road_names, nearest_road_distances, road_boundary_summary = apply_road_boundary_policy(
            chainages,
            coords,
            args.target_road_name,
            args.target_road_alias,
            args.offroad_policy,
            road_shp,
        )
        print(f"Road-boundary sample count after policy: {len(chainages)}")

    laz_index = index_laz_files(laz_dir)
    if not laz_index:
        raise SystemExit("No usable LAZ files found")

    raw_elevations = query_profile_elevations(coords, laz_index, args.search_radius)
    valid_elev = int(np.count_nonzero(~np.isnan(raw_elevations)))
    if valid_elev == 0:
        raise SystemExit(
            "No LiDAR elevations were found for the sampled points. "
            "Check that you chose the correct LAZ bundle, or use the overlap finder first."
        )

    filtered_elevations, rejected_outlier_count = filter_elevation_outliers(
        raw_elevations,
        args.spacing_m,
        args.outlier_window_m,
        args.outlier_dev_m,
    )
    filtered_elevations, rejected_step_jump_count, rejected_step_jump_mask = filter_elevation_step_jumps(
        filtered_elevations,
        DEFAULT_STEP_JUMP_M,
    )
    smoothed_elevations = smooth_elevations(filtered_elevations, args.spacing_m, args.smooth_window_m)
    gradients = compute_gradients(
        smoothed_elevations,
        chainages,
        args.spacing_m,
        args.baseline_m,
        rejected_step_jump_mask=rejected_step_jump_mask,
        endpoint_guard_points=0,
    )
    gradients, repaired_gradient_point_count, removed_bad_gradient_point_count = repair_bad_gradient_points(gradients)

    profile_df = build_profile_dataframe(
        path_key,
        project_dir.name,
        chainages,
        coords,
        raw_elevations,
        filtered_elevations,
        smoothed_elevations,
        gradients,
        nearest_road_names=nearest_road_names,
        nearest_road_distances=nearest_road_distances,
    )
    preview_df = build_node_preview(path_key, centerline, segments, profile_df)
    metadata = build_metadata(
        path_key,
        project_dir,
        laz_dir,
        centerline,
        args,
        chainages,
        raw_elevations,
        rejected_outlier_count,
        rejected_step_jump_count,
        gradients,
        repaired_gradient_point_count=repaired_gradient_point_count,
        removed_bad_gradient_point_count=removed_bad_gradient_point_count,
        road_boundary_summary=road_boundary_summary,
    )

    profile_path = output_dir / "gradient_profile.csv"
    preview_path = output_dir / "node_gradient_preview.csv"
    metadata_path = output_dir / "metadata.json"
    profile_df.to_csv(profile_path, index=False)
    preview_df.to_csv(preview_path, index=False)
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    valid_grad = int(np.count_nonzero(~np.isnan(gradients)))
    print(f"\nElevation hits: {valid_elev}/{len(raw_elevations)}")
    print(f"Rejected elevation outliers: {rejected_outlier_count}")
    print(f"Rejected elevation step jumps: {rejected_step_jump_count}")
    print(f"Repaired isolated bad gradient points: {repaired_gradient_point_count}")
    print(f"Removed bad gradient stretch points: {removed_bad_gradient_point_count}")
    print(f"Valid gradients: {valid_grad}/{len(gradients)}")
    if valid_grad:
        print(f"Gradient range: {np.nanmin(gradients):.2f}% to {np.nanmax(gradients):.2f}%")
    print(f"Profile CSV: {profile_path}")
    print(f"Node preview CSV: {preview_path}")
    print(f"Metadata JSON: {metadata_path}")


if __name__ == "__main__":
    main()
