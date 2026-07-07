"""
Generate road_reference.csv from image EXIF GPS data in the in/ folder.

Scans each subfolder of the configured `in_folder`, extracts GPS coordinates
from a sample of images, and writes a CSV used by the "Select Roads" polygon
tool on the Create Project page.

Usage:
    python scripts/generate_road_reference.py
"""

import os
import sys
import json
import csv
from pathlib import Path

import exifread

# ---------------------------------------------------------------------------
# Paths — resolve backend/ relative to this script's location in scripts/
# ---------------------------------------------------------------------------
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
SAMPLE_EVERY_N = 10  # Take every Nth image to keep the CSV manageable

def get_config():
    config_path = BACKEND_DIR / "config.json"
    with open(config_path) as f:
        return json.load(f)

def get_full_path(rel):
    return str((BACKEND_DIR / rel).resolve())

def dms_to_decimal(dms, ref):
    deg = dms[0].num / dms[0].den
    minute = dms[1].num / dms[1].den
    sec = dms[2].num / dms[2].den
    dec = deg + minute / 60 + sec / 3600
    return -dec if ref in ("S", "W") else dec


def extract_gps_from_folder(folder_path: Path, sample_n: int):
    """Yield (lat, lon) tuples from sampled images in a folder."""
    files = sorted(
        f for f in os.listdir(folder_path)
        if f.lower().endswith((".jpg", ".jpeg"))
    )
    for i, fname in enumerate(files):
        if i % sample_n != 0:
            continue
        img_path = folder_path / fname
        try:
            with open(img_path, "rb") as fh:
                tags = exifread.process_file(fh, details=False)
            required = {
                "GPS GPSLatitude", "GPS GPSLongitude",
                "GPS GPSLatitudeRef", "GPS GPSLongitudeRef",
            }
            if not required.issubset(tags):
                continue
            lat = dms_to_decimal(
                tags["GPS GPSLatitude"].values,
                tags["GPS GPSLatitudeRef"].printable,
            )
            lon = dms_to_decimal(
                tags["GPS GPSLongitude"].values,
                tags["GPS GPSLongitudeRef"].printable,
            )
            yield (lat, lon)
        except Exception as e:
            print(f"  [WARN] {fname}: {e}")


def main():
    cfg = get_config()
    in_path = Path(get_full_path(cfg["in_folder"]))
    out_csv = BACKEND_DIR / "shapefiles" / "road_reference.csv"

    if not in_path.exists():
        print(f"ERROR: in_folder not found: {in_path}")
        sys.exit(1)

    folders = sorted(
        f for f in os.listdir(in_path)
        if (in_path / f).is_dir()
    )
    print(f"Found {len(folders)} road folders in {in_path}")

    rows = []
    for folder_name in folders:
        folder_path = in_path / folder_name
        pts = list(extract_gps_from_folder(folder_path, SAMPLE_EVERY_N))
        print(f"  {folder_name}: {len(pts)} sampled points")
        for lat, lon in pts:
            rows.append((folder_name, lat, lon))

    out_csv.parent.mkdir(parents=True, exist_ok=True)
    with open(out_csv, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["road_name", "lat", "lon"])
        writer.writerows(rows)

    print(f"\nWrote {len(rows)} points to {out_csv}")


if __name__ == "__main__":
    main()
