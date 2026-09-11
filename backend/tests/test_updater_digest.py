"""The installed-tree digest must describe only the files a bundle ships.

Regression cover for the "update is applied, then offered again forever" bug:
the interpreter writes __pycache__/*.pyc into backend/ as the app runs, but both
builders exclude those from the bundle, so hashing them made every installed
backend digest differ from the manifest permanently.
"""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import updater  # noqa: E402


BACKEND_EXCLUDE = {"models", "shapefiles", "seed_profiles"}


def _shipped_tree(root: Path) -> Path:
    """The files a bundle actually contains, as build_bundle produces them."""
    (root / "app" / "services").mkdir(parents=True)
    (root / "app" / "__init__.py").write_text("", encoding="utf-8")
    (root / "app" / "services" / "updater.py").write_text("x = 1\n", encoding="utf-8")
    (root / "version.json").write_text('{"version": "1.0"}\n', encoding="utf-8")
    return root


def _simulate_app_run(root: Path) -> None:
    """What the interpreter leaves behind once the app has started once."""
    for package in ("app", "app/services"):
        cache = root / package / "__pycache__"
        cache.mkdir(parents=True, exist_ok=True)
        (cache / "mod.cpython-313.pyc").write_bytes(b"\x00bytecode")
    (root / "app" / "stray.pyo").write_bytes(b"\x00legacy")


def test_bytecode_caches_do_not_change_the_digest(tmp_path):
    root = _shipped_tree(tmp_path / "backend")
    before = updater.component_tree_digest(root, BACKEND_EXCLUDE)

    _simulate_app_run(root)

    assert updater.component_tree_digest(root, BACKEND_EXCLUDE) == before


def test_bytecode_caches_do_not_invalidate_the_fingerprint_cache(tmp_path):
    """The cheap fingerprint gates the expensive hash; .pyc churn must not bust it."""
    root = _shipped_tree(tmp_path / "backend")
    _simulate_app_run(root)
    before = updater._component_fingerprint(root, BACKEND_EXCLUDE)

    (root / "app" / "__pycache__" / "another.cpython-313.pyc").write_bytes(b"\x00more")

    assert updater._component_fingerprint(root, BACKEND_EXCLUDE) == before


def test_a_real_code_change_is_still_detected(tmp_path):
    """The exclusion must not blind the updater to genuine changes."""
    root = _shipped_tree(tmp_path / "backend")
    before = updater.component_tree_digest(root, BACKEND_EXCLUDE)

    (root / "app" / "services" / "new_module.py").write_text("y = 2\n", encoding="utf-8")

    assert updater.component_tree_digest(root, BACKEND_EXCLUDE) != before


def test_excluded_top_level_dirs_are_still_ignored(tmp_path):
    """models/ and shapefiles/ ship as their own components."""
    root = _shipped_tree(tmp_path / "backend")
    before = updater.component_tree_digest(root, BACKEND_EXCLUDE)

    (root / "models").mkdir()
    (root / "models" / "weights.pt").write_bytes(b"\x00weights")

    assert updater.component_tree_digest(root, BACKEND_EXCLUDE) == before
