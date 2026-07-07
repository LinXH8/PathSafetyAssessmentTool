from pathlib import Path
import sys

import pandas as pd


sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.api.projects import routes  # noqa: E402
from app.services.project_manager import materialize_project_image  # noqa: E402


def test_materialize_project_image_uses_hardlink_when_possible(tmp_path):
    source = tmp_path / "source.jpg"
    target = tmp_path / "target.jpg"
    source.write_bytes(b"image-bytes")

    mode = materialize_project_image(source, target)

    assert mode == "hardlink"
    assert target.exists()
    assert target.read_bytes() == b"image-bytes"
    assert source.samefile(target)


def test_materialize_project_image_falls_back_to_copy(monkeypatch, tmp_path):
    source = tmp_path / "source.jpg"
    target = tmp_path / "target.jpg"
    source.write_bytes(b"image-bytes")

    def raise_cross_device(src, dst):
        raise OSError("cross-device link")

    monkeypatch.setattr("app.services.project_manager.os.link", raise_cross_device)

    mode = materialize_project_image(source, target)

    assert mode == "copy"
    assert target.exists()
    assert target.read_bytes() == b"image-bytes"
    assert not source.samefile(target)


def test_apply_image_namespaces_adds_prefix(tmp_path):
    filename_df = pd.DataFrame({"FILENAME": ["Cam1.jpg", "Cam2.jpg"]})

    result_df = routes.apply_image_namespaces(filename_df, filename_prefix="RoadA")

    assert result_df.loc[0, "FILENAME"] == "RoadA__Cam1.jpg"
    assert result_df.loc[1, "FILENAME"] == "RoadA__Cam2.jpg"
    # Original df must not be mutated
    assert filename_df.loc[0, "FILENAME"] == "Cam1.jpg"


def test_apply_image_namespaces_no_prefix_returns_unchanged(tmp_path):
    filename_df = pd.DataFrame({"FILENAME": ["Cam1.jpg"]})

    result_df = routes.apply_image_namespaces(filename_df, filename_prefix=None)

    assert result_df.loc[0, "FILENAME"] == "Cam1.jpg"
    # Should be the same object (no copy needed when no prefix)
    assert result_df is filename_df


def test_apply_image_namespaces_does_not_copy_files(tmp_path):
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    (source_dir / "Cam1.jpg").write_bytes(b"image-bytes")

    filename_df = pd.DataFrame({"FILENAME": ["Cam1.jpg"]})
    result_df = routes.apply_image_namespaces(filename_df, filename_prefix="RoadA")

    # FILENAME is updated with namespace prefix
    assert result_df.loc[0, "FILENAME"] == "RoadA__Cam1.jpg"
    # No file was created anywhere other than source
    assert not (tmp_path / "RoadA__Cam1.jpg").exists()
