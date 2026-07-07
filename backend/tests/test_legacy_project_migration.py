from pathlib import Path
import json
import sys


sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import legacy_project_migration  # noqa: E402


def _write_project_metadata(project_dir: Path, *, source_folders: list[str], dataset: str | None = None) -> None:
    payload = {
        "project_name": project_dir.name,
        "source_folders": source_folders,
        "dataset": dataset,
    }
    (project_dir / "project_metadata.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def test_migrate_single_source_project_relinks_to_original_and_bootstraps_profiles(tmp_path):
    repo_root = tmp_path / "repo"
    backend_root = repo_root / "backend"
    profiles_root = repo_root / "profiles"
    legacy_root = repo_root / "data"
    in_root = repo_root / "in"

    (backend_root / "config.json").parent.mkdir(parents=True, exist_ok=True)
    (backend_root / "config.json").write_text(json.dumps({"destination_folder": "../data", "in_folder": "../in"}), encoding="utf-8")

    project_dir = legacy_root / "ProjectA"
    images_dir = project_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    _write_project_metadata(project_dir, source_folders=["AMK Ave 1"], dataset="AMK Ave 1")

    source_dir = in_root / "AMK Ave 1"
    source_dir.mkdir(parents=True, exist_ok=True)
    source_image = source_dir / "Cam1.jpg"
    source_image.write_bytes(b"source-image")

    project_image = images_dir / "ProjectA_Cam1.jpg"
    project_image.write_bytes(b"source-image")

    old_repo_root = legacy_project_migration._repo_root
    old_backend_root = legacy_project_migration._backend_root
    try:
        legacy_project_migration._repo_root = lambda: repo_root
        legacy_project_migration._backend_root = lambda: backend_root

        summary = legacy_project_migration.migrate_legacy_project_structure()
    finally:
        legacy_project_migration._repo_root = old_repo_root
        legacy_project_migration._backend_root = old_backend_root

    assert summary["relinked_files"] == 1
    assert summary["migrated_projects"] == 1
    assert summary["profiles_bootstrap"]["created_root"] is True
    assert summary["profiles_bootstrap"]["created_registry"] is True
    assert profiles_root.exists()
    assert project_image.samefile(source_image)


def test_migrate_multi_source_project_uses_namespace(tmp_path):
    legacy_root = tmp_path / "data"
    in_root = tmp_path / "in"

    project_dir = legacy_root / "ProjectB"
    images_dir = project_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    _write_project_metadata(project_dir, source_folders=["Road Alpha", "Road Beta"], dataset="MULTI_FOLDER_SELECTION")

    alpha_dir = in_root / "Road Alpha"
    beta_dir = in_root / "Road Beta"
    alpha_dir.mkdir(parents=True, exist_ok=True)
    beta_dir.mkdir(parents=True, exist_ok=True)
    (alpha_dir / "Cam1.jpg").write_bytes(b"alpha")
    beta_source = beta_dir / "Cam2.jpg"
    beta_source.write_bytes(b"beta")

    project_image = images_dir / "ProjectB_Road_Beta__Cam2.jpg"
    project_image.write_bytes(b"beta")

    summary = legacy_project_migration.migrate_legacy_project_structure(
        legacy_root=legacy_root,
        in_root=in_root,
        bootstrap_profiles=False,
    )

    assert summary["relinked_files"] == 1
    assert project_image.samefile(beta_source)


def test_migrate_skips_when_source_hash_differs(tmp_path):
    legacy_root = tmp_path / "data"
    in_root = tmp_path / "in"

    project_dir = legacy_root / "ProjectC"
    images_dir = project_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    _write_project_metadata(project_dir, source_folders=["Road Alpha"], dataset="Road Alpha")

    source_dir = in_root / "Road Alpha"
    source_dir.mkdir(parents=True, exist_ok=True)
    source_image = source_dir / "Cam3.jpg"
    source_image.write_bytes(b"new-source-bytes")

    project_image = images_dir / "ProjectC_Cam3.jpg"
    project_image.write_bytes(b"old-copied-bytes")

    summary = legacy_project_migration.migrate_legacy_project_structure(
        legacy_root=legacy_root,
        in_root=in_root,
        bootstrap_profiles=False,
    )

    assert summary["relinked_files"] == 0
    assert any(item["reason"] == "source_hash_mismatch" for item in summary["skipped"])
    assert project_image.read_bytes() == b"old-copied-bytes"


def test_bootstrap_profiles_storage_refuses_empty_registry_when_profile_dirs_exist(tmp_path):
    repo_root = tmp_path / "repo"
    profiles_root = repo_root / "profiles"
    (profiles_root / "alaster" / "projects").mkdir(parents=True, exist_ok=True)

    summary = legacy_project_migration.bootstrap_profiles_storage(repo_root=repo_root)

    assert summary["created_registry"] is False
    assert summary["blocked_registry_creation"] is True
    assert not (profiles_root / "profiles.json").exists()