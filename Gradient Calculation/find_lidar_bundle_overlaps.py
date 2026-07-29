"""
find_lidar_bundle_overlaps.py
-----------------------------
Find which top-level LiDAR bundle folders overlap a project's geo_data.gpkg bounds.

Example:
    python "Gradient Calculation/find_lidar_bundle_overlaps.py" ^
    --project-dir "data\\TPYLor13Q25" ^
    --laz-root "E:\\3D point cloud GSV_NorthEast_30092025"
"""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path

import laspy
from shapely import wkb


def _gpkg_blob_to_geometry(blob: bytes):
    if not blob or len(blob) < 8:
        raise ValueError("invalid geometry blob")

    flags = blob[3]
    envelope_indicator = (flags >> 1) & 0b111
    envelope_sizes = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
    header_size = 8 + envelope_sizes.get(envelope_indicator, 0)
    return wkb.loads(bytes(blob[header_size:]))


def load_project_bounds(project_dir: Path) -> tuple[float, float, float, float]:
    gpkg_path = project_dir / "geo_data.gpkg"
    if not gpkg_path.exists():
        raise FileNotFoundError(f"geo_data.gpkg not found in {project_dir}")

    conn = sqlite3.connect(gpkg_path)
    try:
        rows = conn.execute('SELECT geom FROM geo_data').fetchall()
    finally:
        conn.close()

    if not rows:
        raise ValueError(f"No rows found in {gpkg_path}")

    minx = miny = float("inf")
    maxx = maxy = float("-inf")
    for (geom_blob,) in rows:
        geom = _gpkg_blob_to_geometry(geom_blob)
        bx1, by1, bx2, by2 = geom.bounds
        minx = min(minx, bx1)
        miny = min(miny, by1)
        maxx = max(maxx, bx2)
        maxy = max(maxy, by2)
    return minx, miny, maxx, maxy


def overlaps(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    return not (ax2 < bx1 or ax1 > bx2 or ay2 < by1 or ay1 > by2)


def main() -> None:
    parser = argparse.ArgumentParser(description="Find overlapping LiDAR bundles for a project")
    parser.add_argument("--project-dir", required=True, help="Project directory containing geo_data.gpkg")
    parser.add_argument("--laz-root", required=True, help="Root directory containing top-level LAZ bundle folders")
    args = parser.parse_args()

    project_dir = Path(args.project_dir)
    laz_root = Path(args.laz_root)
    bounds = load_project_bounds(project_dir)
    print("Project:", project_dir)
    print("Bounds (SVY21):", tuple(round(v, 3) for v in bounds))

    hits = []
    for bundle in sorted(path for path in laz_root.iterdir() if path.is_dir()):
        laz_files = list(bundle.rglob("*.laz")) + list(bundle.rglob("*.LAZ"))
        for laz_path in laz_files:
            with laspy.open(laz_path) as handle:
                xmin, ymin = handle.header.mins[:2]
                xmax, ymax = handle.header.maxs[:2]
            tile_bounds = (xmin, ymin, xmax, ymax)
            if overlaps(bounds, tile_bounds):
                hits.append((bundle.name, laz_path.name, tile_bounds))
                break

    if not hits:
        print("No overlapping LiDAR bundles found.")
        return

    print("Overlapping bundles:")
    for bundle_name, tile_name, tile_bounds in hits:
        pretty = tuple(round(float(v), 1) for v in tile_bounds)
        print(f"- {bundle_name}: {tile_name} {pretty}")


if __name__ == "__main__":
    main()