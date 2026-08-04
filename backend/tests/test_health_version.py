"""Tests for the version/release-date surfaced by /api/health.

The landing footer and sidebar read the installed version + release date from
GET /api/health, so the endpoint must expose ``released`` alongside version and
channel, and version.py must parse it from version.json (defaulting to "" on
older bundles that predate the field).
"""

from pathlib import Path
import sys

from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.api import health  # noqa: E402
from app.services import version  # noqa: E402


def _client_with_stub_version(monkeypatch, info):
    monkeypatch.setattr(health, "get_version_info", lambda: info)
    app = Flask(__name__)
    app.register_blueprint(health.bp, url_prefix="/api")
    return app.test_client()


def test_health_endpoint_includes_released(monkeypatch):
    client = _client_with_stub_version(
        monkeypatch,
        {"version": "1.05", "channel": "stable", "released": "2026-08-04"},
    )
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["status"] == "ok"
    assert data["version"] == "1.05"
    assert data["channel"] == "stable"
    assert data["released"] == "2026-08-04"


def test_health_released_defaults_empty_when_missing(monkeypatch):
    # An old bundle's get_version_info may omit "released" entirely.
    client = _client_with_stub_version(
        monkeypatch,
        {"version": "1.00", "channel": "stable"},
    )
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.get_json()["released"] == ""


def test_get_version_info_reads_released(monkeypatch, tmp_path):
    vf = tmp_path / "version.json"
    vf.write_text('{"version": "2.0", "channel": "beta", "released": "2027-12-31"}', encoding="utf-8")
    monkeypatch.setattr(version, "_cache", None)
    monkeypatch.setattr(version, "_version_file", lambda: vf)

    info = version.get_version_info()
    assert info["version"] == "2.0"
    assert info["channel"] == "beta"
    assert info["released"] == "2027-12-31"


def test_get_version_info_released_absent_defaults_empty(monkeypatch, tmp_path):
    vf = tmp_path / "version.json"
    vf.write_text('{"version": "2.0", "channel": "stable"}', encoding="utf-8")
    monkeypatch.setattr(version, "_cache", None)
    monkeypatch.setattr(version, "_version_file", lambda: vf)

    assert version.get_version_info()["released"] == ""
