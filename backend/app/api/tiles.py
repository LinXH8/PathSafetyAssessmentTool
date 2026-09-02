"""Basemap tile endpoint -- the indirection layer for offline basemaps.

Every map in the app used to fetch tiles straight from ``basemaps.cartocdn.com``,
so on an offline machine every map (and every exported PDF report) rendered on a
blank grey background. The frontend now points at ``/api/tiles/...`` instead, so
the tile *source* is a backend concern and can change without touching the UI.

Current backing source: OpenStreetMap's standard tile server
(tile.openstreetmap.org), with a per-user on-disk cache. A tile already seen is
served from disk, so previously-visited areas keep working offline, and it also
means we only make one upstream request per tile ever (not once per light/dark
theme, not repeatedly), which matters given OSM's usage policy discourages heavy
automated use. This is incidental caching driven by real use -- do NOT add a
bulk pre-seed/scrape step, which their tile usage policy prohibits. Shipping a
genuinely offline-from-first-launch basemap is a separate change (a bundled
PMTiles / Protomaps extract) that slots in behind this same endpoint.

Both "light" and "dark" theme requests are served the *same* underlying tile --
there is no free/keyless dark raster basemap left standing (see history below),
so dark mode is faked client-side with a CSS filter over the light tiles
(ThemeAwareTileLayer.tsx). The ``theme`` path segment is kept only so existing
callers/URLs don't need to change; it no longer selects a different upstream
style.

History -- why not CARTO or Esri:
CARTO (``basemaps.cartocdn.com``, the original source here) and Esri's free
"Canvas" basemap (``server.arcgisonline.com/.../Canvas/World_Light_Gray_Base``,
briefly used here in between) have both locked anonymous/keyless tile requests
behind a paywall/account. Both fail the exact same deceptive way: HTTP 200 with
a baked-in placeholder image ("API KEY REQUIRED" / "Map data not yet available")
instead of a real tile or an error status, so a naive status-code check can't
detect it -- it gets silently cached and served as if valid. Esri's placeholder
kicks in above zoom 16, which is too shallow for path/segment-level inspection.
OSM's standard tiles have real coverage past z19 with no key, at the cost of a
single fixed (colourful) style and stricter fair-use expectations.

OSM tile usage policy (see operations.osmfoundation.org/policies/tiles/):
identify the app via User-Agent (done below), keep request volume reasonable
(the on-disk cache is what makes that true here), and don't hotlink/bulk-scrape.
maxNativeZoom is capped at 19 on the frontend TileLayers -- OSM's tile server
answers z20+ with an HTTP 400, so requesting past 19 must be avoided rather than
just handled.

Cache lives under the user-data root, so it is writable on a packaged install and
is never touched by the updater.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import requests
from flask import Blueprint, Response, jsonify, send_file

from app.services import paths

logger = logging.getLogger(__name__)

bp = Blueprint("tiles", __name__)

_VALID_THEMES = {"light", "dark"}
_UPSTREAM = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
_MAX_ZOOM = 19
# 1x1 transparent PNG -- served when a tile is unavailable offline so Leaflet
# renders empty space instead of broken-image tiles and endless retries.
_BLANK_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000a49444154789c6300010000050001a5f645400000000049454e44ae426082"
)
# Soft ceiling for the on-disk cache (small SSDs are an explicit constraint).
_CACHE_MAX_BYTES = 512 * 1024 * 1024


def _cache_root() -> Path:
    return paths.user_data_root() / "tiles"


def _cache_path(z: int, x: int, y: int) -> Path:
    # Theme-agnostic: light and dark are the same upstream tile (see module
    # docstring), so they share one cache entry instead of duplicating it.
    return _cache_root() / str(z) / str(x) / f"{y}.png"


def _blank() -> Response:
    resp = Response(_BLANK_PNG, mimetype="image/png")
    # Never cache the placeholder: the real tile should be fetched next time the
    # machine is online.
    resp.headers["Cache-Control"] = "no-store"
    return resp


def _cache_size_ok() -> bool:
    """Cheap guard against unbounded cache growth."""
    root = _cache_root()
    if not root.exists():
        return True
    try:
        total = 0
        for dirpath, _dirnames, filenames in os.walk(root):
            for filename in filenames:
                try:
                    total += os.path.getsize(os.path.join(dirpath, filename))
                except OSError:
                    continue
                if total > _CACHE_MAX_BYTES:
                    return False
        return True
    except OSError:
        return True


@bp.get("/<theme>/<int:z>/<int:x>/<int:y>.png")
def get_tile(theme: str, z: int, x: int, y: int):
    """Serve a basemap tile from the local cache, falling back to upstream."""
    if theme not in _VALID_THEMES:
        return jsonify({"error": f"Unknown theme '{theme}'"}), 400
    if not (0 <= z <= _MAX_ZOOM):
        return jsonify({"error": "z out of range"}), 400
    # Tile indices must be within the pyramid for this zoom level.
    limit = 1 << z
    if not (0 <= x < limit and 0 <= y < limit):
        return jsonify({"error": "x/y out of range for zoom"}), 400

    cached = _cache_path(z, x, y)
    if cached.is_file():
        resp = send_file(cached, mimetype="image/png")
        resp.headers["Cache-Control"] = "public, max-age=604800"
        return resp

    url = _UPSTREAM.format(z=z, x=x, y=y)
    try:
        upstream = requests.get(
            url,
            timeout=6,
            headers={"User-Agent": "PathSafetyAssessmentTool/1.0 (LTA internal tool)"},
        )
    except requests.RequestException:
        # Offline, or upstream unreachable -- expected on a disconnected machine.
        return _blank()

    if upstream.status_code != 200 or not upstream.content:
        return _blank()

    if _cache_size_ok():
        try:
            cached.parent.mkdir(parents=True, exist_ok=True)
            # Write via a temp file so a crash mid-write cannot leave a
            # truncated tile that would then be served forever from cache.
            tmp = cached.with_suffix(".part")
            tmp.write_bytes(upstream.content)
            tmp.replace(cached)
        except OSError as exc:
            logger.debug("Tile cache write failed for %s: %s", cached, exc)

    resp = Response(upstream.content, mimetype="image/png")
    resp.headers["Cache-Control"] = "public, max-age=604800"
    return resp
