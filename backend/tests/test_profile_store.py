from pathlib import Path
import json
import sys

import pytest
from flask import Flask


sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import profile_store  # noqa: E402


def _patch_roots(monkeypatch, tmp_path):
    profiles_root = tmp_path / "profiles"
    legacy_root = tmp_path / "data"
    monkeypatch.setattr(profile_store, "_profiles_root", lambda: profiles_root)
    monkeypatch.setattr(profile_store, "_legacy_projects_root", lambda: legacy_root)
    return profiles_root, legacy_root


def test_create_profile_hashes_pin(monkeypatch, tmp_path):
    profiles_root, _ = _patch_roots(monkeypatch, tmp_path)

    profile = profile_store.create_profile("Alice", "alice@lta.gov.sg", "1234", "Road Safety")

    registry = json.loads((profiles_root / "profiles.json").read_text(encoding="utf-8"))
    stored = registry["profiles"][0]
    assert profile["name"] == "Alice"
    assert profile["username"] == "Alice"
    assert profile["has_email"] is True
    assert "email" not in profile  # recovery email stays private
    assert profile["division"] == "Road Safety"
    assert stored["pin_hash"] != "1234"
    assert stored["pin_salt"]
    assert stored["email"] == "alice@lta.gov.sg"
    assert stored["slug"] == "alice"


def test_create_profile_requires_valid_email(monkeypatch, tmp_path):
    _patch_roots(monkeypatch, tmp_path)

    with pytest.raises(ValueError, match="Email"):
        profile_store.create_profile("Alice", "", "1234", "Road Safety")

    with pytest.raises(ValueError, match="valid email"):
        profile_store.create_profile("Bob", "not-an-email", "1234", "Road Safety")


def test_login_and_logout_profile(monkeypatch, tmp_path):
    _patch_roots(monkeypatch, tmp_path)
    profile = profile_store.create_profile("Office A", "office.a@lta.gov.sg", "2468", "Transport Planning")

    # The logged-in profile lives in the request's session cookie, so drive the
    # store from inside a request context.
    app = Flask(__name__)
    app.config["SECRET_KEY"] = "test-secret"
    with app.test_request_context():
        active = profile_store.login_profile(profile["id"], "2468")

        assert active["id"] == profile["id"]
        assert active["division"] == "Transport Planning"
        assert active["last_active_at"]
        assert profile_store.get_active_profile()["id"] == profile["id"]

        profile_store.logout_profile()

        assert profile_store.get_active_profile() is None


def test_move_legacy_projects_to_profile(monkeypatch, tmp_path):
    profiles_root, legacy_root = _patch_roots(monkeypatch, tmp_path)
    profile = profile_store.create_profile("Analyst", "analyst@lta.gov.sg", "4321", "Data Office")

    (legacy_root / "Project One").mkdir(parents=True)
    (legacy_root / "Project Two").mkdir(parents=True)

    result = profile_store.move_legacy_projects_to_profile(profile["id"])

    destination_root = profiles_root / profile["slug"] / "projects"
    assert result["moved"] == ["Project One", "Project Two"]
    assert not (legacy_root / "Project One").exists()
    assert (destination_root / "Project One").exists()
    assert (destination_root / "Project Two").exists()


def test_login_rejects_wrong_pin(monkeypatch, tmp_path):
    _patch_roots(monkeypatch, tmp_path)
    profile = profile_store.create_profile("Analyst", "analyst@lta.gov.sg", "4321", "Data Office")

    with pytest.raises(PermissionError):
        profile_store.login_profile(profile["id"], "1111")


def test_update_profile_changes_name_and_division(monkeypatch, tmp_path):
    profiles_root, _ = _patch_roots(monkeypatch, tmp_path)
    profile = profile_store.create_profile("Office A", "office.a@lta.gov.sg", "2468", "Transport Planning")

    updated = profile_store.update_profile(profile["id"], "2468", "Office B", "Road Safety")

    registry = json.loads((profiles_root / "profiles.json").read_text(encoding="utf-8"))
    stored = registry["profiles"][0]
    assert updated["name"] == "Office B"
    assert updated["username"] == "Office B"
    assert updated["division"] == "Road Safety"
    assert updated["slug"] == "office-a"
    assert stored["name"] == "Office B"
    assert stored["username"] == "Office B"
    assert stored["division"] == "Road Safety"
    # Recovery email is left untouched when not provided.
    assert stored["email"] == "office.a@lta.gov.sg"


def test_update_profile_changes_recovery_email(monkeypatch, tmp_path):
    profiles_root, _ = _patch_roots(monkeypatch, tmp_path)
    profile = profile_store.create_profile("Office A", "old@lta.gov.sg", "2468", "Transport Planning")

    profile_store.update_profile(profile["id"], "2468", "Office A", "Transport Planning", "new@lta.gov.sg")

    registry = json.loads((profiles_root / "profiles.json").read_text(encoding="utf-8"))
    assert registry["profiles"][0]["email"] == "new@lta.gov.sg"


def test_update_profile_rejects_duplicate_name(monkeypatch, tmp_path):
    _patch_roots(monkeypatch, tmp_path)
    profile_store.create_profile("Office A", "office.a@lta.gov.sg", "2468", "Transport Planning")
    second = profile_store.create_profile("Office B", "office.b@lta.gov.sg", "1357", "Road Safety")

    with pytest.raises(ValueError, match="already exists"):
        profile_store.update_profile(second["id"], "1357", "Office A", "Road Safety")


def test_reset_profile_pin_replaces_login_pin(monkeypatch, tmp_path):
    _patch_roots(monkeypatch, tmp_path)
    profile = profile_store.create_profile("Analyst", "analyst@lta.gov.sg", "4321", "Data Office")

    profile_store.reset_profile_pin(profile["id"], "4321", "6789")

    with pytest.raises(PermissionError):
        profile_store.login_profile(profile["id"], "4321")

    active = profile_store.login_profile(profile["id"], "6789")
    assert active["id"] == profile["id"]


def test_recover_profile_pin_with_email(monkeypatch, tmp_path):
    _patch_roots(monkeypatch, tmp_path)
    profile = profile_store.create_profile("Analyst", "analyst@lta.gov.sg", "4321", "Data Office")

    # Email match is case-insensitive and lets the user set a new PIN directly.
    profile_store.recover_profile_pin(profile["id"], "ANALYST@LTA.GOV.SG", "9999")

    active = profile_store.login_profile(profile["id"], "9999")
    assert active["id"] == profile["id"]


def test_recover_profile_pin_rejects_wrong_email(monkeypatch, tmp_path):
    _patch_roots(monkeypatch, tmp_path)
    profile = profile_store.create_profile("Analyst", "analyst@lta.gov.sg", "4321", "Data Office")

    with pytest.raises(PermissionError):
        profile_store.recover_profile_pin(profile["id"], "someone-else@lta.gov.sg", "9999")

    # Original PIN still works after a failed recovery attempt.
    assert profile_store.login_profile(profile["id"], "4321")["id"] == profile["id"]


def test_create_profile_requires_division(monkeypatch, tmp_path):
    _patch_roots(monkeypatch, tmp_path)

    with pytest.raises(ValueError):
        profile_store.create_profile("Analyst", "analyst@lta.gov.sg", "4321", "")


def test_legacy_profile_backfills_username_and_email(monkeypatch, tmp_path):
    profiles_root, _ = _patch_roots(monkeypatch, tmp_path)
    # Simulate a legacy registry where "name" held the LTA email and there is
    # no username/email split yet.
    (profiles_root).mkdir(parents=True, exist_ok=True)
    legacy_state = {
        "version": 1,
        "profiles": [
            {
                "id": "legacy1",
                "name": "legacy.user@lta.gov.sg",
                "slug": "legacy-user",
                "division": "Road Safety",
                "created_at": "2026-01-01T00:00:00+00:00",
                "last_active_at": None,
                "pin_hash": "hash",
                "pin_salt": "salt",
            }
        ],
    }
    (profiles_root / "profiles.json").write_text(json.dumps(legacy_state, indent=2), encoding="utf-8")

    profiles = profile_store.list_profiles()

    assert profiles[0]["username"] == "legacy.user@lta.gov.sg"
    assert profiles[0]["has_email"] is True


def test_save_state_writes_latest_registry_backup(monkeypatch, tmp_path):
    profiles_root, _ = _patch_roots(monkeypatch, tmp_path)

    profile_store.create_profile("Alice", "alice@lta.gov.sg", "1234", "Road Safety")

    latest_backup = profiles_root / "_registry_backups" / "profiles.latest.json"
    assert latest_backup.exists()
    backup_state = json.loads(latest_backup.read_text(encoding="utf-8"))
    assert backup_state["profiles"][0]["name"] == "Alice"


def test_list_profiles_refuses_missing_registry_when_profile_dirs_exist(monkeypatch, tmp_path):
    profiles_root, _ = _patch_roots(monkeypatch, tmp_path)
    (profiles_root / "alaster" / "projects").mkdir(parents=True, exist_ok=True)

    with pytest.raises(RuntimeError, match="Refusing to initialize empty local state"):
        profile_store.list_profiles()

    assert not (profiles_root / "profiles.json").exists()


def test_list_profiles_restores_latest_backup_when_registry_missing(monkeypatch, tmp_path):
    profiles_root, _ = _patch_roots(monkeypatch, tmp_path)
    (profiles_root / "alaster" / "projects").mkdir(parents=True, exist_ok=True)
    backup_root = profiles_root / "_registry_backups"
    backup_root.mkdir(parents=True, exist_ok=True)
    backup_state = {
        "version": 1,
        "profiles": [
            {
                "id": "abc123",
                "name": "Alaster",
                "slug": "alaster",
                "division": "Road Safety",
                "created_at": "2026-05-25T00:00:00+00:00",
                "last_active_at": None,
                "pin_hash": "hash",
                "pin_salt": "salt",
            }
        ],
    }
    (backup_root / "profiles.latest.json").write_text(json.dumps(backup_state, indent=2), encoding="utf-8")

    profiles = profile_store.list_profiles()

    assert profiles[0]["name"] == "Alaster"
    assert (profiles_root / "profiles.json").exists()

def _session_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = "test-secret"
    return app


def test_overview_lists_every_profile_when_private_mode_is_switched_off(monkeypatch, tmp_path):
    _patch_roots(monkeypatch, tmp_path)
    monkeypatch.setenv("PSAT_PRIVATE_PROFILES", "0")
    profile_store.create_profile("Alice", "alice@lta.gov.sg", "1234", "Road Safety")
    profile_store.create_profile("Bob", "bob@lta.gov.sg", "5678", "Road Safety")

    with _session_app().test_request_context():
        overview = profile_store.get_overview()

    assert overview["private_profiles"] is False
    assert [p["name"] for p in overview["profiles"]] == ["Alice", "Bob"]


def test_private_overview_only_lists_seeded_and_logged_in_profile(monkeypatch, tmp_path):
    profiles_root, _ = _patch_roots(monkeypatch, tmp_path)
    # Private mode is the default everywhere (desktop and cloud): no env var.
    monkeypatch.delenv("PSAT_PRIVATE_PROFILES", raising=False)
    alice = profile_store.create_profile("Alice", "alice@lta.gov.sg", "1234", "Road Safety")
    profile_store.create_profile("Bob", "bob@lta.gov.sg", "5678", "Road Safety")
    shared = profile_store.create_profile("Islandwide Data", "seed@lta.gov.sg", "1234", "LTA")
    (profiles_root / ".seeded.json").write_text(
        json.dumps({"islandwide-data": {"seed_version": 1, "profile_id": shared["id"]}}),
        encoding="utf-8",
    )

    with _session_app().test_request_context():
        # Logged out: only the shipped profile is listed.
        overview = profile_store.get_overview()
        assert overview["private_profiles"] is True
        assert [p["name"] for p in overview["profiles"]] == ["Islandwide Data"]

        # Logged in: plus the account itself, never anyone else's.
        profile_store.login_profile(alice["id"], "1234")
        assert [p["name"] for p in profile_store.get_overview()["profiles"]] == ["Alice", "Islandwide Data"]

        # Nothing is remembered: after logout the browser is back to the start.
        profile_store.logout_profile()
        overview = profile_store.get_overview()
        assert overview["active_profile"] is None
        assert [p["name"] for p in overview["profiles"]] == ["Islandwide Data"]


def test_find_profile_id_by_username_is_case_insensitive(monkeypatch, tmp_path):
    _patch_roots(monkeypatch, tmp_path)
    alice = profile_store.create_profile("Alice Tan", "alice@lta.gov.sg", "1234", "Road Safety")

    assert profile_store.find_profile_id_by_username("  alice   TAN ") == alice["id"]
    assert profile_store.find_profile_id_by_username("alice") is None
    assert profile_store.find_profile_id_by_username("") is None


def test_find_profile_ids_by_login_matches_email_or_username(monkeypatch, tmp_path):
    _patch_roots(monkeypatch, tmp_path)
    alice = profile_store.create_profile("Alice", "alice@lta.gov.sg", "1234", "Road Safety")
    # One person, two profiles under the same email.
    second = profile_store.create_profile("Alice Trial", "ALICE@lta.gov.sg", "5678", "Road Safety")
    profile_store.create_profile("Bob", "bob@lta.gov.sg", "1111", "Road Safety")

    assert profile_store.find_profile_ids_by_login(" Alice@LTA.gov.sg ") == [alice["id"], second["id"]]
    assert profile_store.find_profile_ids_by_login("alice trial") == [second["id"]]
    assert profile_store.find_profile_ids_by_login("nobody@lta.gov.sg") == []
    assert profile_store.find_profile_ids_by_login("") == []


def test_admin_flag_follows_the_logged_in_session(monkeypatch, tmp_path):
    _patch_roots(monkeypatch, tmp_path)
    monkeypatch.setenv("PSAT_PRIVATE_PROFILES", "1")
    monkeypatch.setenv("PSAT_ADMIN_EMAILS", "someone@lta.gov.sg, BOSS@lta.gov.sg")
    boss = profile_store.create_profile("Boss", "boss@lta.gov.sg", "1234", "Road Safety")
    alice = profile_store.create_profile("Alice", "alice@lta.gov.sg", "5678", "Planning")

    with _session_app().test_request_context():
        assert profile_store.active_profile_is_admin() is False  # logged out

        profile_store.login_profile(boss["id"], "1234")
        overview = profile_store.get_overview()
        assert overview["is_admin"] is True and profile_store.active_profile_is_admin() is True
        # Being admin does not widen the profile list itself.
        assert [p["name"] for p in overview["profiles"]] == ["Boss"]

        profile_store.logout_profile()
        assert profile_store.get_overview()["is_admin"] is False
        assert profile_store.active_profile_is_admin() is False

    with _session_app().test_request_context():
        profile_store.login_profile(alice["id"], "5678")
        assert profile_store.get_overview()["is_admin"] is False
        assert profile_store.active_profile_is_admin() is False


def test_list_all_accounts_is_username_and_division_only(monkeypatch, tmp_path):
    _patch_roots(monkeypatch, tmp_path)
    profile_store.create_profile("Boss", "boss@lta.gov.sg", "1234", "Road Safety")
    profile_store.create_profile("alice", "alice@lta.gov.sg", "5678", "Planning")

    assert profile_store.list_all_accounts() == [
        {"username": "alice", "division": "Planning"},
        {"username": "Boss", "division": "Road Safety"},
    ]


def _seed_shared_profile(profiles_root):
    shared = profile_store.create_profile("Islandwide Data", "seed@lta.gov.sg", "1234", "LTA")
    (profiles_root / ".seeded.json").write_text(
        json.dumps({"islandwide-data": {"seed_version": 1, "profile_id": shared["id"]}}),
        encoding="utf-8",
    )
    return shared


def test_shared_profile_cannot_be_changed(monkeypatch, tmp_path):
    profiles_root, _ = _patch_roots(monkeypatch, tmp_path)
    monkeypatch.delenv("PSAT_PRIVATE_PROFILES", raising=False)
    shared = _seed_shared_profile(profiles_root)
    alice = profile_store.create_profile("Alice", "alice@lta.gov.sg", "5678", "Road Safety")
    (profiles_root / "alice" / "projects" / "Road A").mkdir(parents=True)

    # Even with the right PIN / recovery email, every change is refused.
    with pytest.raises(profile_store.ProtectedProfileError):
        profile_store.update_profile(shared["id"], "1234", "Renamed", "LTA")
    with pytest.raises(profile_store.ProtectedProfileError):
        profile_store.reset_profile_pin(shared["id"], "1234", "9999")
    with pytest.raises(profile_store.ProtectedProfileError):
        profile_store.recover_profile_pin(shared["id"], "seed@lta.gov.sg", "9999")
    with pytest.raises(profile_store.ProtectedProfileError):
        profile_store.delete_profile(shared["id"], "1234")
    with pytest.raises(ValueError, match="shared profile"):
        profile_store.share_projects_to_profile(shared["id"], ["Road A"], alice["id"])

    with _session_app().test_request_context():
        # Still usable: the shared PIN logs in, and the overview flags it.
        assert profile_store.login_profile(shared["id"], "1234")["name"] == "Islandwide Data"
        assert profile_store.get_overview()["active_profile_protected"] is True
        profile_store.login_profile(alice["id"], "5678")
        assert profile_store.get_overview()["active_profile_protected"] is False

    # An ordinary profile is unaffected.
    assert profile_store.reset_profile_pin(alice["id"], "5678", "4321")["id"] == alice["id"]


def test_shared_profile_is_manageable_only_with_private_mode_switched_off(monkeypatch, tmp_path):
    profiles_root, _ = _patch_roots(monkeypatch, tmp_path)
    monkeypatch.setenv("PSAT_PRIVATE_PROFILES", "0")
    shared = _seed_shared_profile(profiles_root)

    assert profile_store.is_protected_profile(shared["id"]) is False
    profile_store.delete_profile(shared["id"], "1234")
    assert profile_store.list_profiles() == []
