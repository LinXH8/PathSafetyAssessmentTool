"""Basemap tile endpoint -- the indirection layer for offline basemaps.

Every map in the app used to fetch tiles straight from ``basemaps.cartocdn.com``,
so on an offline machine every map (and every exported PDF report) rendered on a
blank grey background. The frontend now points at ``/api/tiles/...`` instead, so
the tile *source* is a backend concern and can change without touching the UI.

Current backing source: CARTO, with a per-user on-disk cache. A tile already
seen is served from disk, so previously-visited areas keep working offline. This
is incidental caching driven by real use -- do NOT add a bulk pre-seed/scrape
step against CARTO, which their basemap terms prohibit. Shipping a genuinely
offline-from-first-launch basemap is a separate change (a bundled PMTiles /
Protomaps extract) that slots in behind this same endpoint.

Cache lives under the user-data root, so it is writable on a packaged install and
is never touched by the updater.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import requests
from flask import Blueprint, Response, jsonify, request, send_file

from app.services import paths

logger = logging.getLogger(__name__)

bp = Blueprint("tiles", __name__)

_THEMES = {"light": "light_all", "dark": "dark_all"}
_UPSTREAM = "https://basemaps.cartocdn.com/{style}/{z}/{x}/{y}{r}.png"
_MAX_ZOOM = 22
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


def _cache_path(theme: str, z: int, x: int, y: int, retina: bool) -> Path:
    name = f"{y}@2x.png" if retina else f"{y}.png"
    return _cache_root() / theme / str(z) / str(x) / name


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
    style = _THEMES.get(theme)
    if style is None:
        return jsonify({"error": f"Unknown theme '{theme}'"}), 400
    if not (0 <= z <= _MAX_ZOOM):
        return jsonify({"error": "z out of range"}), 400
    # Tile indices must be within the pyramid for this zoom level.
    limit = 1 << z
    if not (0 <= x < limit and 0 <= y < limit):
        return jsonify({"error": "x/y out of range for zoom"}), 400

    retina = request.args.get("r") == "@2x"

    cached = _cache_path(theme, z, x, y, retina)
    if cached.is_file():
        resp = send_file(cached, mimetype="image/png")
        resp.headers["Cache-Control"] = "public, max-age=604800"
        return resp

    url = _UPSTREAM.format(style=style, z=z, x=x, y=y, r="@2x" if retina else "")
    try:
        upstream = requests.get(url, timeout=6, headers={"User-Agent": "PSAT"})
    except requests.RequestException:
        # Offline, or upstream unreachable -- expected on a disconnected machine.
        return _blank()

    if upstream.status_code != 200 or not upstream.content:
        return _blank()

    if _cache_size_ok():
        try:
            cached.parent.mkdir(parents=True, exist_ok=True)
            # Write via a temp file so a crash mid-write cannot leave a
            # truncated PNG that would then be served forever from cache.
            tmp = cached.with_suffix(".part")
            tmp.write_bytes(upstream.content)
            tmp.replace(cached)
        except OSError as exc:
            logger.debug("Tile cache write failed for %s: %s", cached, exc)

    resp = Response(upstream.content, mimetype="image/png")
    resp.headers["Cache-Control"] = "public, max-age=604800"
    return resp
