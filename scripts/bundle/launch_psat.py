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
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
import zipfile
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
    """Per-user writable root. Mirrors backend/app/services/paths.py.

    Resolution order:
      1. PSAT_DATA_DIR env var
      2. data_dir.txt in the install root -- written by the installer when the
         user picks a location. A quarter of survey data is ~45 GB, which many
         machines cannot spare on the system drive, so this must be movable.
         It sits outside every update component, so updates never clobber it.
      3. %LOCALAPPDATA%\\PSAT\\data
    """
    override = os.environ.get("PSAT_DATA_DIR")
    if override:
        return Path(override)

    configured = BUNDLE_ROOT / "data_dir.txt"
    try:
        if configured.is_file():
            # utf-8-sig, not utf-8: Windows PowerShell 5.1 writes a BOM with
            # -Encoding UTF8, and Notepad adds one too if anyone hand-edits this.
            # A stray BOM would silently turn the path into garbage.
            value = configured.read_text(encoding="utf-8-sig").strip()
            if value:
                return Path(value)
    except (OSError, ValueError):
        pass

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


def wait_for_health(port: int, process: subprocess.Popen, timeout: int,
                    fatal: bool = True) -> dict | None:
    """Poll /api/health until the server answers, the process dies, or we time out.

    fatal=False returns None instead of exiting, so a freshly-applied update that
    will not start can be rolled back rather than leaving the user stuck.
    """
    url = f"http://127.0.0.1:{port}/api/health"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            if not fatal:
                return None
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
    if not fatal:
        return None
    fail(
        f"PSAT started but did not become ready within {timeout} seconds.\n"
        f"  This can happen on a slow disk the very first time. Try again; if it\n"
        f"  persists, the GIS data may be missing or damaged."
    )
    raise AssertionError("unreachable")


def start_server(port: int, env: dict) -> subprocess.Popen:
    return subprocess.Popen(
        [str(sys.executable), str(BACKEND_DIR / "app.py")],
        cwd=str(BACKEND_DIR),
        env=env,
    )


# ── Staged-update application ────────────────────────────────────────────────
# Runs BEFORE the server starts, because a process cannot replace the files it is
# currently executing. Everything here is designed so that an interrupted update
# (power cut, hard kill) leaves either the old version or the new one, never a mix.

PENDING_DIR = BUNDLE_ROOT / "pending"
BACKUP_DIR = BUNDLE_ROOT / "rollback"
INSTALLED_STATE = BUNDLE_ROOT / "installed.json"
PLAN_FILE = "plan.json"


def _read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _top_level_targets(archive: Path) -> set[str]:
    """First path segment of every entry, i.e. which install dirs an archive touches."""
    with zipfile.ZipFile(archive) as zf:
        return {name.split("/")[0] for name in zf.namelist() if "/" in name or name}


def apply_pending_update() -> bool:
    """Apply a staged update. Returns True if anything was applied.

    Strategy: move the directories an update touches into rollback/, extract the
    new ones, and keep rollback/ until the new version passes its health check.
    Moves are same-volume renames, so they are effectively atomic and fast even
    for the 5 GB shapefile tree.
    """
    plan_path = PENDING_DIR / PLAN_FILE
    if not plan_path.is_file():
        return False

    plan = _read_json(plan_path, None)
    if not plan or not plan.get("components"):
        shutil.rmtree(PENDING_DIR, ignore_errors=True)
        return False

    print(f"Applying update {plan.get('app_version', '?')} ...")

    # Reconstruct split archives and work out which top-level dirs are affected.
    archives: list[tuple[str, Path]] = []
    touched: set[str] = set()
    for name, spec in plan["components"].items():
        parts = [PENDING_DIR / p for p in spec.get("parts", [])]
        if not parts or not all(p.is_file() for p in parts):
            fail(f"The staged update is incomplete (missing files for '{name}').\n"
                 f"  It has been discarded; PSAT will start on the current version.")
        if len(parts) == 1:
            archive = parts[0]
        else:
            archive = PENDING_DIR / f"{name}.joined.zip"
            with open(archive, "wb") as out:
                for part in parts:
                    with open(part, "rb") as chunk:
                        shutil.copyfileobj(chunk, out, length=8 * 1024 * 1024)
        archives.append((name, archive))
        touched |= _top_level_targets(archive)

    if BACKUP_DIR.exists():
        shutil.rmtree(BACKUP_DIR, ignore_errors=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    try:
        # 1. move current versions aside (rename, not copy)
        for target in sorted(touched):
            src = BUNDLE_ROOT / target
            if src.exists():
                src.rename(BACKUP_DIR / target)

        # 2. extract the new ones
        for name, archive in archives:
            print(f"  installing {name} ...")
            with zipfile.ZipFile(archive) as zf:
                zf.extractall(BUNDLE_ROOT)
    except Exception as exc:
        # Put everything back before anything else can run.
        print(f"  update failed ({exc}); rolling back ...")
        for target in sorted(touched):
            live = BUNDLE_ROOT / target
            saved = BACKUP_DIR / target
            if saved.exists():
                if live.exists():
                    shutil.rmtree(live, ignore_errors=True)
                saved.rename(live)
        shutil.rmtree(PENDING_DIR, ignore_errors=True)
        fail("The update could not be installed. PSAT has been restored to the "
             "previous version and will start normally next time.")

    # 3. record what is now installed, so the updater stops offering it
    state = _read_json(INSTALLED_STATE, {})
    for name, spec in plan["components"].items():
        state[name] = spec.get("digest")
    try:
        INSTALLED_STATE.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    except OSError:
        pass

    shutil.rmtree(PENDING_DIR, ignore_errors=True)
    print("Update installed.")
    return True


def rollback_after_failed_start(touched_marker: bool) -> None:
    """Restore the previous version after the updated app failed to become healthy."""
    if not touched_marker or not BACKUP_DIR.is_dir():
        return
    print("The updated version did not start. Rolling back ...")
    for saved in BACKUP_DIR.iterdir():
        live = BUNDLE_ROOT / saved.name
        if live.exists():
            shutil.rmtree(live, ignore_errors=True)
        try:
            saved.rename(live)
        except OSError as exc:
            print(f"  could not restore {saved.name}: {exc}")
    shutil.rmtree(BACKUP_DIR, ignore_errors=True)
    # Drop the recorded digests so the updater offers the update again rather than
    # believing a version that never actually ran is installed.
    try:
        INSTALLED_STATE.unlink(missing_ok=True)
    except OSError:
        pass


def main() -> int:
    if not BACKEND_DIR.is_dir():
        fail(f"The PSAT installation looks incomplete — no 'backend' folder at {BACKEND_DIR}.")

    data_dir = user_data_dir()
    check_disk_space(data_dir)
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        fail(f"Could not create the PSAT data folder at {data_dir}.\n  ({exc})")

    # Apply any staged update before the server touches its own files.
    applied = False
    try:
        applied = apply_pending_update()
    except SystemExit:
        raise
    except Exception as exc:
        print(f"Could not apply the staged update ({exc}); starting current version.")
        shutil.rmtree(PENDING_DIR, ignore_errors=True)

    port = find_free_port(DEFAULT_PORT, PORT_SCAN_LIMIT)

    env = os.environ.copy()
    env["PSAT_DATA_DIR"] = str(data_dir)
    env["PSAT_PORT"] = str(port)
    env["PSAT_HOST"] = "127.0.0.1"
    env.pop("PSAT_DEV", None)  # never the auto-reloading dev server in a bundle

    print(f"Starting PSAT on http://127.0.0.1:{port} ...")
    print(f"Your projects are stored in: {data_dir}")

    process = start_server(port, env)

    # After an update, a failure to come up must not strand the user on a broken
    # install -- restore the previous version and start that instead.
    info = wait_for_health(port, process, HEALTH_TIMEOUT_SECONDS, fatal=not applied)
    if info is None:
        try:
            process.terminate()
            process.wait(timeout=15)
        except Exception:
            pass
        rollback_after_failed_start(applied)
        process = start_server(port, env)
        info = wait_for_health(port, process, HEALTH_TIMEOUT_SECONDS)
        print("Rolled back to the previous version.")
    elif applied:
        # New version is healthy: drop the backup. It is a full copy of everything
        # the update touched (potentially gigabytes) and must not linger on disk.
        shutil.rmtree(BACKUP_DIR, ignore_errors=True)

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
