from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import global_var  # noqa: E402
from app.services.project_manager import deduplicate_project_images  # noqa: E402


def _write_project_image(projects_root: Path, project_name: str, filename: str, content: bytes) -> Path:
    image_path = projects_root / project_name / global_var.PROJECT_IMAGES_FOLDER / filename
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(content)
    return image_path


def test_deduplicate_project_images_relinks_duplicate_files(tmp_path):
    projects_root = tmp_path / "projects"
    first = _write_project_image(projects_root, "Project A", "a.jpg", b"shared-bytes")
    second = _write_project_image(projects_root, "Project B", "b.jpg", b"shared-bytes")
    unique = _write_project_image(projects_root, "Project C", "c.jpg", b"other-bytes")

    result = deduplicate_project_images(projects_root)

    assert result["scanned_projects"] == 3
    assert result["scanned_files"] == 3
    assert result["duplicates_found"] == 1
    assert result["deduplicated_files"] == 1
    assert result["already_linked"] == 0
    assert result["bytes_reclaimed"] == len(b"shared-bytes")
    assert first.samefile(second)
    assert not first.samefile(unique)


def test_deduplicate_project_images_restores_duplicate_on_link_failure(monkeypatch, tmp_path):
    projects_root = tmp_path / "projects"
    first = _write_project_image(projects_root, "Project A", "a.jpg", b"shared-bytes")
    second = _write_project_image(projects_root, "Project B", "b.jpg", b"shared-bytes")

    def raise_cross_device(src, dst):
        raise OSError("cross-device link")

    monkeypatch.setattr("app.services.project_manager.os.link", raise_cross_device)

    result = deduplicate_project_images(projects_root)

    assert result["duplicates_found"] == 1
    assert result["deduplicated_files"] == 0
    assert len(result["skipped"]) == 1
    assert first.read_bytes() == b"shared-bytes"
    assert second.read_bytes() == b"shared-bytes"
    assert not first.samefile(second)


def test_deduplicate_project_images_reports_missing_requested_projects(tmp_path):
    projects_root = tmp_path / "projects"
    _write_project_image(projects_root, "Project A", "a.jpg", b"shared-bytes")

    result = deduplicate_project_images(projects_root, ["Project A", "Missing Project"])

    assert result["scanned_projects"] == 1
    assert result["missing_projects"] == ["Missing Project"]