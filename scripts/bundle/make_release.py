"""Turn a built PSAT bundle into an uploadable release: archives + manifest.json.

Run after build_bundle.ps1. Produces a folder whose entire contents get attached
to a GitHub Release; installed clients read manifest.json from there and download
only the components whose hash changed.

Component granularity is chosen so a routine change moves megabytes, not gigabytes:

    webui           frontend build            ~10 MB   changes often
    backend         app code                   ~2 MB   changes often
    models          YOLO weights               ~27 MB  rare
    python          frozen interpreter + deps  ~3.9 GB rare
    shp-<category>  ONE PER top-level shapefiles dir    every 2 weeks-ish

Shapefiles are split per top-level directory on purpose. As a single component a
one-layer fix would push 5.1 GB to every machine; per-directory it pushes only the
directory that changed. File-level granularity would be finer still, but GitHub
release assets are flat files and ~4,700 of them per release is not workable.

Integrity is sha256 per part. There is no signing: for an internal tool where the
same GitHub account already controls the source, key management costs more than it
buys (decision recorded 2026-07-21).

Usage:
    python scripts/bundle/make_release.py --bundle D:\\PSAT-build\\PSAT \\
        --out D:\\PSAT-build\\release --version 1.1 --notes "Fixed X"
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

# GitHub caps a single release asset at 2 GiB. Stay under it with room to spare.
PART_MAX_BYTES = 1_800_000_000
CHUNK = 1024 * 1024


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(CHUNK), b""):
            digest.update(block)
    return digest.hexdigest()


def zip_dir(src: Path, dest_zip: Path, arc_root: str) -> None:
    """Zip src into dest_zip, storing paths under arc_root/.

    ZIP_DEFLATED at level 6: the payload is mostly already-compressed imagery and
    binaries, so a higher level costs build minutes for almost nothing.
    """
    dest_zip.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(dest_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in sorted(src.rglob("*")):
            if path.is_file():
                zf.write(path, Path(arc_root) / path.relative_to(src))


def split_file(path: Path, max_bytes: int) -> list[Path]:
    """Split into .partNN files if oversized. Returns the parts (or [path])."""
    if path.stat().st_size <= max_bytes:
        return [path]
    parts: list[Path] = []
    with open(path, "rb") as handle:
        index = 0
        while True:
            chunk = handle.read(max_bytes)
            if not chunk:
                break
            part = path.with_suffix(path.suffix + f".part{index:02d}")
            part.write_bytes(chunk)
            parts.append(part)
            index += 1
    path.unlink()  # the joined file is reconstructed client-side
    return parts


def describe(parts: list[Path]) -> dict:
    return {
        "parts": [
            {"name": p.name, "sha256": sha256_file(p), "size": p.stat().st_size}
            for p in parts
        ],
        "size": sum(p.stat().st_size for p in parts),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a PSAT update release")
    parser.add_argument("--bundle", required=True, help="Built bundle root (contains python/, backend/, webui/)")
    parser.add_argument("--out", required=True, help="Output dir for archives + manifest.json")
    parser.add_argument("--version", required=True, help="Release version, e.g. 1.1")
    parser.add_argument("--notes", default="", help="Short human-readable change note")
    parser.add_argument("--base-url", default="", help="Where assets will be served from (optional; "
                                                       "clients can derive it from the release URL)")
    parser.add_argument("--skip-python", action="store_true",
                        help="Skip the ~3.9 GB interpreter when it has not changed")
    args = parser.parse_args()

    bundle = Path(args.bundle).resolve()
    out = Path(args.out).resolve()
    if not (bundle / "backend").is_dir():
        print(f"ERROR: {bundle} does not look like a built bundle")
        return 1

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    components: dict[str, dict] = {}

    def add(name: str, src: Path, arc_root: str) -> None:
        if not src.is_dir():
            print(f"  skip {name}: {src} missing")
            return
        print(f"  packing {name} ...", flush=True)
        archive = out / f"{name}.zip"
        zip_dir(src, archive, arc_root)
        parts = split_file(archive, PART_MAX_BYTES)
        components[name] = describe(parts)
        print(f"    {components[name]['size'] / 1e6:,.0f} MB in {len(parts)} part(s)")

    print("Packing components:")
    add("webui", bundle / "webui", "webui")
    add("models", bundle / "backend" / "models", "backend/models")

    # backend code only -- models and shapefiles are their own components so that
    # a code fix does not drag 5 GB of GIS data along with it.
    backend_src = bundle / "backend"
    print("  packing backend ...", flush=True)
    backend_zip = out / "backend.zip"
    backend_zip.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(backend_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in sorted(backend_src.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(backend_src)
            if rel.parts and rel.parts[0] in ("models", "shapefiles"):
                continue
            zf.write(path, Path("backend") / rel)
    backend_parts = split_file(backend_zip, PART_MAX_BYTES)
    components["backend"] = describe(backend_parts)
    print(f"    {components['backend']['size'] / 1e6:,.0f} MB in {len(backend_parts)} part(s)")

    if not args.skip_python:
        add("python", bundle / "python", "python")
    else:
        print("  skip python (--skip-python)")

    # One component per top-level shapefiles directory.
    shp_root = bundle / "backend" / "shapefiles"
    if shp_root.is_dir():
        for category in sorted(p for p in shp_root.iterdir() if p.is_dir()):
            add(f"shp-{category.name}", category, f"backend/shapefiles/{category.name}")

    manifest = {
        "schema": 1,
        "app_version": args.version,
        "released_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "notes": args.notes,
        "base_url": args.base_url,
        "components": components,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    total = sum(c["size"] for c in components.values())
    print(f"\nRelease {args.version}: {len(components)} components, {total / 1e9:.2f} GB")
    print(f"Written to {out}")
    print("\nUpload EVERY file in that folder as assets on the GitHub release,")
    print("manifest.json included.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
