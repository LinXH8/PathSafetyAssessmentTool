"""PSAT launcher — the entry point of the packaged bundle.

Runs INSIDE the bundled interpreter (``python\\python.exe launcher\\launch_psat.py``)
and is responsible for everything that must happen before the app is usable:

  1. point the app at the per-user writable data root (``PSAT_DATA_DIR``)
  2. find a free port (:8000 is often taken on a shared machine)
  3. start the server
  4. wait for /api/health, then open the browser

Deliberately dependency-free beyond the standard library + the bundled app, so a
failure here can never be a missing-package problem.

Update-applying and rollback are NOT handled here — those belong to the
bootstrapper that runs before this (Day 3), because files in use cannot be
replaced by the process using them.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

# launcher/ lives next to python/ and backend/ in the bundle root.
BUNDLE_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = BUNDLE_ROOT / "backend"

DEFAULT_PORT = 8000
PORT_SCAN_LIMIT = 20          # try 8000..8019 before giving up
HEALTH_TIMEOUT_SECONDS = 180  # first start loads the GIS layers, so be generous
# Enough for the app itself; project data is extra and checked separately.
MIN_FREE_DISK_BYTES = 500 * 1024 * 1024


def user_data_dir() -> Path:
    """Per-user writable root. Mirrors backend/app/services/paths.py."""
    override = os.environ.get("PSAT_DATA_DIR")
    if override:
        return Path(override)
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA")
        root = Path(base) if base else Path.home() / "AppData" / "Local"
        return root / "PSAT" / "data"
    return Path.home() / ".local" / "share" / "PSAT"


def fail(message: str) -> None:
    """Report a fatal startup problem in terms a non-technical user can act on."""
    print("\n" + "=" * 68)
    print("  PSAT could not start")
    print("=" * 68)
    print(f"\n  {message}\n")
    print("  If this keeps happening, send this window's text to the PSAT team.")
    print("=" * 68)
    try:
        input("\n  Press Enter to close...")
    except EOFError:
        pass
    sys.exit(1)


def check_disk_space(target: Path) -> None:
    """Refuse to start rather than half-write data onto a full disk."""
    probe = target
    while not probe.exists() and probe.parent != probe:
        probe = probe.parent
    try:
        free = __import__("shutil").disk_usage(probe).free
    except OSError:
        return  # not worth blocking startup over an unreadable drive
    if free < MIN_FREE_DISK_BYTES:
        fail(
            f"Not enough free disk space.\n"
            f"  PSAT needs at least {MIN_FREE_DISK_BYTES // (1024*1024)} MB free "
            f"to store project data.\n"
            f"  Drive containing {probe} has {free // (1024*1024)} MB free.\n\n"
            f"  Free up some space and start PSAT again."
        )


def find_free_port(start: int, limit: int) -> int:
    for port in range(start, start + limit):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    fail(
        f"Could not find a free network port between {start} and {start + limit - 1}.\n"
        f"  Another program may be using them. Restarting the computer usually clears this."
    )
    raise AssertionError("unreachable")


def wait_for_health(port: int, process: subprocess.Popen, timeout: int) -> dict:
    """Poll /api/health until the server answers, the process dies, or we time out."""
    url = f"http://127.0.0.1:{port}/api/health"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            fail(
                f"The PSAT server stopped unexpectedly during start-up "
                f"(exit code {process.returncode}).\n"
                f"  The window above may show what went wrong."
            )
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                if response.status == 200:
                    return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, OSError, ValueError):
            time.sleep(1.0)
    fail(
        f"PSAT started but did not become ready within {timeout} seconds.\n"
        f"  This can happen on a slow disk the very first time. Try again; if it\n"
        f"  persists, the GIS data may be missing or damaged."
    )
    raise AssertionError("unreachable")


def main() -> int:
    if not BACKEND_DIR.is_dir():
        fail(f"The PSAT installation looks incomplete — no 'backend' folder at {BACKEND_DIR}.")

    data_dir = user_data_dir()
    check_disk_space(data_dir)
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        fail(f"Could not create the PSAT data folder at {data_dir}.\n  ({exc})")

    port = find_free_port(DEFAULT_PORT, PORT_SCAN_LIMIT)

    env = os.environ.copy()
    env["PSAT_DATA_DIR"] = str(data_dir)
    env["PSAT_PORT"] = str(port)
    env["PSAT_HOST"] = "127.0.0.1"
    env.pop("PSAT_DEV", None)  # never the auto-reloading dev server in a bundle

    print(f"Starting PSAT on http://127.0.0.1:{port} ...")
    print(f"Your projects are stored in: {data_dir}")

    process = subprocess.Popen(
        [str(sys.executable), str(BACKEND_DIR / "app.py")],
        cwd=str(BACKEND_DIR),
        env=env,
    )

    info = wait_for_health(port, process, HEALTH_TIMEOUT_SECONDS)
    print(f"PSAT {info.get('version', '?')} is ready.")

    webbrowser.open(f"http://127.0.0.1:{port}/")
    print("\nPSAT is running. Closing this window will shut it down.")
    try:
        return process.wait()
    except KeyboardInterrupt:
        process.terminate()
        return 0


if __name__ == "__main__":
    sys.exit(main())
