"""Append per-row coordinates to a project version's CSVs.

The version CSVs (attributes / results / treatment) carry no spatial data — the
geometry lives in the project's ``geo_data.gpkg``. This script joins the two and
writes NEW copies with three extra columns appended:

    Image Reference — the photo the row came from (traceability)
    Coordinates     — WGS84 "lat, lon"
    SVY21           — EPSG:3414 "easting, northing"

The originals are never modified. Output lands in ``<project>/exports/<version>/``,
which is outside ``versions/`` and (being non-8-digit) invisible to the app's
version discovery.

IMPORTANT — the join is POSITIONAL. The CSVs have no key column, so row *i* of the
CSV is row *i* of the gpkg. This mirrors the app itself (project_version.py deletes
the same index from both; export.py merges with ``.values``). The row-count guard
below is what keeps that assumption honest — it hard-fails rather than silently
misaligning.

By default it enriches the CSVs inside the project's own version directory. Pass
``--csv-dir`` to enrich a different folder of CSVs instead (e.g. a decoded export)
— any folder whose files are row-for-row derivatives of the same version, so the
same positional join applies. Every ``*.csv`` in that folder is processed.

Usage:
    backend/venv/bin/python scripts/append_coords_to_version.py \
        [--project "Autocoded Singapore (Islandwide)"] [--version 20260811] \
        [--profile <profile-dir>] [--csv-dir <dir>] [--out <dir>] [--split-columns]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

REPO_ROOT = Path(__file__).resolve().parent.parent

DEFAULT_PROFILE = "xiang-hong-lin-from-tp-lta-gov-sg"
DEFAULT_PROJECT = "Autocoded Singapore (Islandwide)"
DEFAULT_VERSION = "20260811"

# CSVs to enrich when reading the project's own version directory.
# snapshot_metadata.csv is skipped there — coder name / date / status only,
# nothing per-segment worth geocoding. With --csv-dir, every *.csv is processed.
TARGET_CSVS = ("attributes.csv", "results.csv", "treatment.csv")


def _first_vertex_point(geom):
    """Reduce a (Multi)LineString to a Point at its first vertex.

    Copied verbatim from backend/app/api/projects/export.py so this script stays
    standalone. Matches the Path Analysis map, which plots each segment as a
    single marker at the LineString's first coordinate — i.e. where that row's
    photo was actually taken.
    """
    if geom is None or geom.is_empty:
        return None
    if geom.geom_type == "Point":
        return geom
    if geom.geom_type == "LineString":
        return Point(geom.coords[0])
    if geom.geom_type == "MultiLineString":
        first = geom.geoms[0]
        if first.is_empty:
            return None
        return Point(first.coords[0])
    return None


def build_coord_frame(gpkg_path: Path, split_columns: bool) -> pd.DataFrame:
    """Read geo_data.gpkg and return one coordinate row per segment."""
    gdf = gpd.read_file(gpkg_path).reset_index(drop=True)
    if gdf.empty:
        raise SystemExit(f"[fatal] {gpkg_path} has no features")

    # Mirrors export.py: assume the project's native SVY21 when CRS is absent.
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:3414")
    elif gdf.crs.to_epsg() != 3414:
        gdf = gdf.to_crs("EPSG:3414")

    points = gdf.geometry.apply(_first_vertex_point)
    missing = int(points.isna().sum())
    if missing:
        raise SystemExit(
            f"[fatal] {missing} geometries could not be reduced to a point — "
            "refusing to emit misaligned rows"
        )

    svy21 = gpd.GeoSeries(points, crs="EPSG:3414")
    wgs84 = svy21.to_crs("EPSG:4326")

    out = pd.DataFrame(index=range(len(gdf)))
    out["Image Reference"] = gdf.get(
        "Image Reference", pd.Series([""] * len(gdf))
    ).astype(str).values

    if split_columns:
        out["Latitude"] = [f"{p.y:.7f}" for p in wgs84]
        out["Longitude"] = [f"{p.x:.7f}" for p in wgs84]
        out["SVY21 Easting"] = [f"{p.x:.3f}" for p in svy21]
        out["SVY21 Northing"] = [f"{p.y:.3f}" for p in svy21]
    else:
        out["Coordinates"] = [f"{p.y:.7f}, {p.x:.7f}" for p in wgs84]
        out["SVY21"] = [f"{p.x:.3f}, {p.y:.3f}" for p in svy21]

    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--profile", default=DEFAULT_PROFILE)
    ap.add_argument("--project", default=DEFAULT_PROJECT)
    ap.add_argument("--version", default=DEFAULT_VERSION)
    ap.add_argument(
        "--csv-dir",
        default=None,
        help="folder of CSVs to enrich instead of the project's version dir; "
             "every *.csv in it is processed (must be row-for-row derivatives "
             "of the same version)",
    )
    ap.add_argument("--out", default=None, help="output dir (default <project>/exports/<version>)")
    ap.add_argument(
        "--split-columns",
        action="store_true",
        help="emit Latitude/Longitude/SVY21 Easting/SVY21 Northing as 4 numeric "
             "columns instead of 2 combined ones",
    )
    args = ap.parse_args()

    project_dir = REPO_ROOT / "profiles" / args.profile / "projects" / args.project
    version_dir = project_dir / "versions" / args.version
    gpkg_path = project_dir / "geo_data.gpkg"

    if not gpkg_path.exists():
        raise SystemExit(f"[fatal] not found: {gpkg_path}")

    if args.csv_dir:
        csv_dir = Path(args.csv_dir).expanduser().resolve()
        if not csv_dir.is_dir():
            raise SystemExit(f"[fatal] not a directory: {csv_dir}")
        targets = sorted(p.name for p in csv_dir.glob("*.csv"))
        if not targets:
            raise SystemExit(f"[fatal] no CSVs found in {csv_dir}")
        default_out = csv_dir.parent / f"{csv_dir.name}_with_coords"
    else:
        csv_dir = version_dir
        if not csv_dir.exists():
            raise SystemExit(f"[fatal] not found: {csv_dir}")
        targets = TARGET_CSVS
        default_out = project_dir / "exports" / args.version

    out_dir = Path(args.out).expanduser() if args.out else default_out
    if out_dir.resolve() == csv_dir.resolve():
        raise SystemExit("[fatal] output dir must differ from the source dir — "
                         "this script never overwrites originals")
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Project : {args.project}")
    print(f"Version : {args.version}")
    print(f"Geometry: {gpkg_path.name}")
    print(f"Source  : {csv_dir}")
    print(f"Output  : {out_dir}\n")

    coords = build_coord_frame(gpkg_path, args.split_columns)
    n_geo = len(coords)
    new_cols = list(coords.columns)
    print(f"Geometry rows: {n_geo:,}  (unique images: {coords['Image Reference'].nunique():,})")
    print(f"New columns  : {', '.join(new_cols)}\n")

    for name in targets:
        src = csv_dir / name
        if not src.exists():
            print(f"  {name:<24} SKIP (not present)")
            continue

        # dtype=str + keep_default_na=False so the original columns round-trip
        # byte-identically (no 2 -> 2.0, no blank -> NaN).
        df = pd.read_csv(src, dtype=str, keep_default_na=False)
        n = len(df)

        if n == 0:
            # treatment.csv is header-only on this project — nothing to geocode.
            for col in new_cols:
                df[col] = pd.Series(dtype=str)
            dst = out_dir / f"{src.stem}_with_coords.csv"
            df.to_csv(dst, index=False, encoding="utf-8")
            print(f"  {name:<24} 0 rows — header only, columns added but empty  -> {dst.name}")
            continue

        if n != n_geo:
            raise SystemExit(
                f"[fatal] row-count mismatch for {name}: {n:,} CSV rows vs "
                f"{n_geo:,} geometries. Refusing to write a misaligned file."
            )

        for col in new_cols:
            df[col] = coords[col].values

        dst = out_dir / f"{src.stem}_with_coords.csv"
        df.to_csv(dst, index=False, encoding="utf-8")
        first = " | ".join(f"{c}={df[c].iloc[0]}" for c in new_cols)
        print(f"  {name:<24} {n:,} rows -> {dst.name}")
        print(f"  {'':<24} row 0: {first}")

    print("\nDone. Originals untouched.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
