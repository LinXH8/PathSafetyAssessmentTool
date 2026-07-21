from __future__ import annotations

import threading
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

from app.config import Config

CRS_WGS84 = "EPSG:4326"
CRS_METRIC = "EPSG:3414"

DEFECT_FILE = Path(Config.DATA_DIR).parent / "generate-summary-1Q 2.xlsx"
HEADER_ROW = 9  # zero-indexed; row 10 in the sheet


def _format_date(raw) -> str:
    """Convert YYYYMMDD int/str → 'YYYY-MM-DD'. Returns '' if unparseable."""
    if raw is None:
        return ""
    try:
        s = str(int(float(raw)))
    except (TypeError, ValueError):
        s = str(raw).strip()
    if len(s) == 8 and s.isdigit():
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    return s


def _parse_coords(raw) -> tuple[float, float] | None:
    """Parse 'lat, lng' string → (lat, lng). Returns None on failure."""
    if not isinstance(raw, str):
        return None
    parts = raw.split(",")
    if len(parts) != 2:
        return None
    try:
        lat = float(parts[0].strip())
        lng = float(parts[1].strip())
    except ValueError:
        return None
    # Sanity-check Singapore extent (roughly).
    if not (1.1 <= lat <= 1.5 and 103.5 <= lng <= 104.1):
        return None
    return lat, lng


class DefectsStore:
    """Lazy in-memory cache of defect inspection records keyed by metric Point geometry."""

    def __init__(self, file_path: Path = DEFECT_FILE):
        self.file_path = file_path
        self._gdf: gpd.GeoDataFrame | None = None
        self._lock = threading.Lock()

    def _load(self) -> gpd.GeoDataFrame:
        if not self.file_path.exists():
            raise FileNotFoundError(f"Defect summary not found at {self.file_path}")

        df = pd.read_excel(self.file_path, header=HEADER_ROW)

        # Normalise column names — strip whitespace.
        df.columns = [str(c).strip() for c in df.columns]

        required = {"Geocoordinates", "Type of Defect", "Location", "Date of Inspection", "R.A.G"}
        missing = required - set(df.columns)
        if missing:
            raise ValueError(f"Defect xlsx missing columns: {missing}")

        df = df[["Geocoordinates", "Type of Defect", "Location", "Date of Inspection", "R.A.G"]].copy()

        # Only Red/Amber-flagged inspections are relevant defects.
        rag_norm = df["R.A.G"].fillna("").astype(str).str.strip().str.lower()
        df = df[rag_norm.isin(["red", "amber"])].copy()

        parsed = df["Geocoordinates"].map(_parse_coords)
        df = df[parsed.notna()].copy()
        df["lat"] = parsed[parsed.notna()].map(lambda t: t[0])
        df["lon"] = parsed[parsed.notna()].map(lambda t: t[1])

        df["type_of_defect"] = df["Type of Defect"].fillna("").astype(str).str.strip()
        df["location"] = df["Location"].fillna("").astype(str).str.strip()
        df["date_of_inspection"] = df["Date of Inspection"].map(_format_date)

        # Drop inspection rows with no actual defect ("NIL" or blank Type of Defect).
        defect_norm = df["type_of_defect"].str.upper()
        df = df[defect_norm.ne("") & defect_norm.ne("NIL")].copy()

        gdf = gpd.GeoDataFrame(
            df[["type_of_defect", "location", "date_of_inspection", "lat", "lon"]].reset_index(drop=True),
            geometry=gpd.points_from_xy(df["lon"], df["lat"]),
            crs=CRS_WGS84,
        ).to_crs(CRS_METRIC)

        # Materialize spatial index for fast bbox queries.
        _ = gdf.sindex
        return gdf

    def ensure_loaded(self) -> gpd.GeoDataFrame:
        if self._gdf is None:
            with self._lock:
                if self._gdf is None:
                    self._gdf = self._load()
        return self._gdf

    def query_near_line(self, geom_metric, radius_m: float) -> list[dict]:
        """Return defects within radius_m metres of geom_metric (already in EPSG:3414)."""
        gdf = self.ensure_loaded()
        buffer_geom = geom_metric.buffer(radius_m)
        candidate_idx = list(gdf.sindex.intersection(buffer_geom.bounds))
        if not candidate_idx:
            return []
        candidates = gdf.iloc[candidate_idx]
        within = candidates[candidates.distance(geom_metric) <= radius_m]
        if within.empty:
            return []
        return [
            {
                "lat": float(row["lat"]),
                "lon": float(row["lon"]),
                "type_of_defect": row["type_of_defect"],
                "location": row["location"],
                "date_of_inspection": row["date_of_inspection"],
            }
            for _, row in within.iterrows()
        ]

    def query_within(self, lon: float, lat: float, radius_m: float) -> list[dict]:
        gdf = self.ensure_loaded()

        pt_metric = (
            gpd.GeoSeries([Point(lon, lat)], crs=CRS_WGS84)
            .to_crs(CRS_METRIC)
            .iloc[0]
        )
        buffer_geom = pt_metric.buffer(radius_m)

        candidate_idx = list(gdf.sindex.intersection(buffer_geom.bounds))
        if not candidate_idx:
            return []

        candidates = gdf.iloc[candidate_idx]
        within = candidates[candidates.distance(pt_metric) <= radius_m]
        if within.empty:
            return []

        return [
            {
                "lat": float(row["lat"]),
                "lon": float(row["lon"]),
                "type_of_defect": row["type_of_defect"],
                "location": row["location"],
                "date_of_inspection": row["date_of_inspection"],
            }
            for _, row in within.iterrows()
        ]


_store_singleton: DefectsStore | None = None
_singleton_lock = threading.Lock()


def get_defects_store() -> DefectsStore:
    global _store_singleton
    if _store_singleton is None:
        with _singleton_lock:
            if _store_singleton is None:
                _store_singleton = DefectsStore()
    return _store_singleton
