"""
calculate_gradient_srtm.py
---------------------------
Computes path gradient using SRTM elevation data — no LAZ files required.
Provides complete coverage for all segments in a project.

Requires:
    pip install srtm.py geopandas pandas numpy

Usage:
    python calculate_gradient_srtm.py --project-dir "C:\\...\\data\\AMK 1"
    python calculate_gradient_srtm.py --all-projects --data-dir "C:\\...\\data"

How it works:
    1. Reads geo_data.gpkg to get segment start/end coordinates
    2. Reprojects coordinates to WGS84 (lat/lon)
    3. Queries SRTM 3-arc-second (~90m) elevation at each point
    4. Smooths elevation along the path
    5. Computes gradient (%) = (elev_end - elev_start) / length * 100
    6. Updates backend/shapefiles/gradient_lookup.csv
"""

import argparse
import geopandas as gpd
import pandas as pd
import numpy as np
from pathlib import Path
import shutil

# tan(5°) × 100 = 8.748 % — same threshold as the LAZ script
GRADE_THRESHOLD_PCT = 8.748

CRS_WGS84 = "EPSG:4326"


# ──────────────────────────────────────────────────────────────────────────────
# Elevation backends
# ──────────────────────────────────────────────────────────────────────────────

def _get_elevations_srtm(lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    """Query SRTM elevation using the `srtm.py` package.

    Tiles are downloaded once (~2 MB per tile) and cached in
    ~/.cache/srtm/  (or the srtm package default).
    Singapore fits in 2–4 tiles.
    """
    import srtm  # pip install srtm.py
    data = srtm.get_data()
    out = np.full(len(lats), np.nan, dtype=float)
    for i, (lat, lon) in enumerate(zip(lats, lons)):
        e = data.get_elevation(float(lat), float(lon))
        if e is not None:
            out[i] = float(e)
    return out


def _get_elevations_api(lats: np.ndarray, lons: np.ndarray,
                        batch_size: int = 100) -> np.ndarray:
    """Fallback: query the free Open-Elevation REST API (uses SRTM data).

    Used only when srtm.py is not installed.  Requires internet access.
    """
    import requests
    out = np.full(len(lats), np.nan, dtype=float)
    total = len(lats)
    for start in range(0, total, batch_size):
        end = min(start + batch_size, total)
        locations = [
            {"latitude": float(lats[i]), "longitude": float(lons[i])}
            for i in range(start, end)
        ]
        try:
            resp = requests.post(
                "https://api.open-elevation.com/api/v1/lookup",
                json={"locations": locations},
                timeout=60,
            )
            resp.raise_for_status()
            for j, r in enumerate(resp.json()["results"]):
                out[start + j] = float(r["elevation"])
            print(f"  API elevations {start + 1}–{end}/{total}", flush=True)
        except Exception as exc:
            print(f"  [WARN] API batch {start}–{end} failed: {exc}", flush=True)
    return out


def get_elevations(lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    """Get SRTM elevations, preferring the local srtm.py package."""
    try:
        import srtm  # noqa: F401 — just check availability
        print("Using srtm.py for elevation lookups (tiles cached locally).")
        return _get_elevations_srtm(lats, lons)
    except ImportError:
        print("srtm.py not found — falling back to Open-Elevation API (requires internet).")
        print("  To avoid this: pip install srtm.py")
        return _get_elevations_api(lats, lons)


# ──────────────────────────────────────────────────────────────────────────────
# Core gradient computation
# ──────────────────────────────────────────────────────────────────────────────

def compute_project_gradients(project_dir: Path) -> pd.DataFrame:
    """Return a DataFrame with Image Reference, gradient_pct, Grade for every segment."""

    gpkg_path = project_dir / "geo_data.gpkg"
    if not gpkg_path.exists():
        raise FileNotFoundError(f"geo_data.gpkg not found in {project_dir}")

    print(f"\n{'='*60}")
    print(f"Project: {project_dir.name}")
    print(f"Loading: {gpkg_path}")
    gdf = gpd.read_file(gpkg_path)
    print(f"  → {len(gdf)} segments")

    if len(gdf) == 0:
        print("  [WARN] No segments — skipping.")
        return pd.DataFrame(columns=["Image Reference", "gradient_pct", "Grade"])

    # ── Reproject to WGS84 so we get lat/lon ─────────────────────────────────
    gdf_wgs = gdf.to_crs(CRS_WGS84)

    # ── Extract start/end points ──────────────────────────────────────────────
    starts_xy = np.array([(geom.coords[0][0], geom.coords[0][1])
                           for geom in gdf_wgs.geometry])   # lon, lat
    ends_xy   = np.array([(geom.coords[-1][0], geom.coords[-1][1])
                           for geom in gdf_wgs.geometry])

    all_xy = np.vstack([starts_xy, ends_xy])            # shape (2N, 2)
    lons_q = all_xy[:, 0]
    lats_q = all_xy[:, 1]

    # De-duplicate for fewer queries
    unique_xy, inverse = np.unique(all_xy, axis=0, return_inverse=True)
    print(f"  Querying elevation for {len(unique_xy)} unique points…")
    elev_unique = get_elevations(unique_xy[:, 1], unique_xy[:, 0])  # lat, lon

    n = len(gdf)
    start_inv = inverse[:n]
    end_inv   = inverse[n:]
    elev_start = elev_unique[start_inv]
    elev_end   = elev_unique[end_inv]

    # ── Smooth elevations along path ──────────────────────────────────────────
    point_elevs = np.full(n + 1, np.nan)
    point_elevs[:n] = elev_start
    point_elevs[n]  = elev_end[-1]
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

    # ── Gradient (%) ──────────────────────────────────────────────────────────
    # Use projected CRS length for accuracy
    length = gdf.geometry.length.values
    dz = elev_e - elev_s
    with np.errstate(invalid="ignore", divide="ignore"):
        gradient = np.where(length > 0, dz / length * 100.0, np.nan)

    grade = np.where(np.abs(gradient) >= GRADE_THRESHOLD_PCT, 2, 1).astype(float)
    grade[np.isnan(gradient)] = np.nan

    # ── Build output DataFrame ────────────────────────────────────────────────
    img_refs = gdf["Image Reference"].values if "Image Reference" in gdf.columns else \
               gdf.get("image_ref", gdf.get("imageRef", pd.Series(["unknown"] * n))).values

    # Strip project-name prefix so the key is portable across projects
    proj_prefix = project_dir.name + "_"
    clean_refs = [
        r[len(proj_prefix):] if isinstance(r, str) and r.startswith(proj_prefix) else r
        for r in img_refs
    ]

    out = pd.DataFrame({
        "Image Reference": clean_refs,
        "gradient_pct":    np.round(gradient, 3),
        "Grade":           grade,
    })
    out["Grade"] = out["Grade"].fillna(1).astype(int)

    valid  = (~np.isnan(gradient)).sum()
    steep  = (np.abs(gradient[~np.isnan(gradient)]) >= GRADE_THRESHOLD_PCT).sum()
    print(f"  Valid gradients : {valid}/{n}")
    if valid > 0:
        print(f"  Range           : {np.nanmin(gradient):.2f}% to {np.nanmax(gradient):.2f}%")
        print(f"  Grade 1 (<5°)   : {valid - steep}")
        print(f"  Grade 2 (≥5°)   : {steep}")

    return out


def _find_shapefiles_dir(project_dir: Path) -> Path:
    candidate = project_dir
    for _ in range(6):
        candidate = candidate.parent
        sf = candidate / "backend" / "shapefiles"
        if sf.exists() or (candidate / "backend").exists():
            sf.mkdir(parents=True, exist_ok=True)
            return sf
    fallback = project_dir.parent / "shapefiles"
    fallback.mkdir(parents=True, exist_ok=True)
    print(f"[WARN] Could not locate backend/shapefiles — writing to {fallback}")
    return fallback


def update_lookup(new_rows: pd.DataFrame, lookup_path: Path) -> None:
    """Merge new_rows into the existing gradient_lookup.csv (upsert by Image Reference)."""
    if lookup_path.exists():
        existing = pd.read_csv(lookup_path)
        # Remove stale entries for the same image refs
        existing = existing[~existing["Image Reference"].isin(new_rows["Image Reference"])]
        combined = pd.concat([existing, new_rows], ignore_index=True)
    else:
        combined = new_rows

    combined.to_csv(lookup_path, index=False)
    print(f"  Lookup updated  : {lookup_path}  ({len(combined)} total entries)")


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Compute SRTM-based gradient and update gradient_lookup.csv."
    )
    parser.add_argument("--project-dir",
                        help="Single project directory (contains geo_data.gpkg).")
    parser.add_argument("--all-projects", action="store_true",
                        help="Process every sub-folder in --data-dir.")
    parser.add_argument("--data-dir",
                        help="Root data directory containing project folders "
                             "(used with --all-projects).")
    args = parser.parse_args()

    if not args.project_dir and not args.all_projects:
        parser.error("Specify either --project-dir or --all-projects with --data-dir.")

    if args.all_projects:
        if not args.data_dir:
            parser.error("--all-projects requires --data-dir.")
        data_dir = Path(args.data_dir)
        project_dirs = [p for p in data_dir.iterdir()
                        if p.is_dir() and (p / "geo_data.gpkg").exists()]
        if not project_dirs:
            print(f"No project directories with geo_data.gpkg found in {data_dir}")
            return
        print(f"Found {len(project_dirs)} project(s): {[p.name for p in project_dirs]}")
    else:
        project_dirs = [Path(args.project_dir)]

    all_rows = []
    for pd_ in project_dirs:
        try:
            rows = compute_project_gradients(pd_)
            all_rows.append(rows)
        except Exception as exc:
            print(f"  [ERROR] {pd_.name}: {exc}")

    if not all_rows:
        print("No gradients computed.")
        return

    combined_rows = pd.concat(all_rows, ignore_index=True)

    # Write lookup next to the first project's backend/shapefiles
    shapefiles_dir = _find_shapefiles_dir(project_dirs[0])
    lookup_path = shapefiles_dir / "gradient_lookup.csv"
    update_lookup(combined_rows, lookup_path)

    print(f"\n✓ Done.  gradient_lookup.csv has {len(pd.read_csv(lookup_path))} entries.")


if __name__ == "__main__":
    main()
