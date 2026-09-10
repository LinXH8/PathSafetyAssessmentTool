from pathlib import Path
import json
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import profile_store, seed_profiles  # noqa: E402


DESCRIPTOR = {
    "id": "5eed15142026a11d",
    "name": "Islandwide Data",
    "username": "Islandwide Data",
    "email": "islandwide.data@lta.gov.sg",
    "division": "R&TS",
    "pin": "1234",
    "seed_version": 1,
}


def _patch_roots(monkeypatch, tmp_path, descriptor=None):
    """Point both stores at tmp_path and lay down one fake seed."""
    profiles_root = tmp_path / "profiles"
    monkeypatch.setattr(profile_store, "_profiles_root", lambda: profiles_root)
    monkeypatch.setattr(profile_store, "_legacy_projects_root", lambda: tmp_path / "data")
    # Pre-session-auth branches keep the active profile in a module global.
    monkeypatch.setattr(profile_store, "_ACTIVE_PROFILE_ID", None, raising=False)
    monkeypatch.setattr(seed_profiles.paths, "profiles_dir", lambda: profiles_root)

    seed_root = tmp_path / "seed_profiles"
    seed_dir = seed_root / "islandwide-data"
    project_dir = seed_dir / "projects" / "Autocoded Singapore (Islandwide)"
    project_dir.mkdir(parents=True)
    (project_dir / "project_metadata.json").write_text("{}", encoding="utf-8")
    (seed_dir / "profile.json").write_text(
        json.dumps(descriptor or DESCRIPTOR), encoding="utf-8"
    )
    monkeypatch.setattr(seed_profiles, "seed_profiles_root", lambda: seed_root)
    monkeypatch.delenv("PSAT_SKIP_SEED_PROFILES", raising=False)
    return profiles_root, seed_dir


def test_seeding_creates_profile_and_copies_projects(monkeypatch, tmp_path):
    profiles_root, _ = _patch_roots(monkeypatch, tmp_path)

    seed_profiles.ensure_seed_profiles()

    profiles = profile_store.list_profiles()
    assert [p["name"] for p in profiles] == ["Islandwide Data"]
    assert profiles[0]["id"] == DESCRIPTOR["id"]
    assert profiles[0]["project_count"] == 1
    assert (profiles_root / "islandwide-data" / "projects"
            / "Autocoded Singapore (Islandwide)" / "project_metadata.json").is_file()
    # The shipped PIN works.
    assert profile_store.login_profile(DESCRIPTOR["id"], "1234")["name"] == "Islandwide Data"


def test_seeding_is_idempotent(monkeypatch, tmp_path):
    profiles_root, _ = _patch_roots(monkeypatch, tmp_path)

    seed_profiles.ensure_seed_profiles()
    # A local edit must survive a second launch.
    project_file = (profiles_root / "islandwide-data" / "projects"
                    / "Autocoded Singapore (Islandwide)" / "project_metadata.json")
    project_file.write_text('{"edited": true}', encoding="utf-8")

    seed_profiles.ensure_seed_profiles()

    assert len(profile_store.list_profiles()) == 1
    assert project_file.read_text(encoding="utf-8") == '{"edited": true}'


def test_deleted_seed_profile_is_not_resurrected(monkeypatch, tmp_path):
    _patch_roots(monkeypatch, tmp_path)

    seed_profiles.ensure_seed_profiles()
    profile_store.delete_profile(DESCRIPTOR["id"], "1234")

    seed_profiles.ensure_seed_profiles()

    assert profile_store.list_profiles() == []


def test_bumped_seed_version_reseeds(monkeypatch, tmp_path):
    profiles_root, seed_dir = _patch_roots(monkeypatch, tmp_path)
    seed_profiles.ensure_seed_profiles()
    profile_store.delete_profile(DESCRIPTOR["id"], "1234")

    (seed_dir / "profile.json").write_text(
        json.dumps({**DESCRIPTOR, "seed_version": 2}), encoding="utf-8"
    )
    seed_profiles.ensure_seed_profiles()

    assert [p["name"] for p in profile_store.list_profiles()] == ["Islandwide Data"]
    state = json.loads((profiles_root / ".seeded.json").read_text(encoding="utf-8"))
    assert state["islandwide-data"]["seed_version"] == 2


def test_env_var_disables_seeding(monkeypatch, tmp_path):
    _patch_roots(monkeypatch, tmp_path)
    monkeypatch.setenv("PSAT_SKIP_SEED_PROFILES", "1")

    seed_profiles.ensure_seed_profiles()

    assert profile_store.list_profiles() == []
