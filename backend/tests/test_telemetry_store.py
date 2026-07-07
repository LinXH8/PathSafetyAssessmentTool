from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import telemetry_store  # noqa: E402


def _patch_db(monkeypatch, tmp_path):
    db_path = tmp_path / "profiles" / "telemetry.sqlite3"
    config_path = tmp_path / "profiles" / "report-upload.json"
    monkeypatch.setattr(telemetry_store, "_telemetry_db_path", lambda: db_path)
    monkeypatch.setattr(telemetry_store, "_remote_export_config_path", lambda: config_path)
    return db_path


def test_record_event_creates_local_db(monkeypatch, tmp_path):
    db_path = _patch_db(monkeypatch, tmp_path)

    event_id = telemetry_store.record_event(
        "project_list_viewed",
        "profile-a",
        "Road Safety",
        payload={"project_count": 4},
    )

    assert event_id
    assert db_path.exists()
    assert telemetry_store.get_installation_id()


def test_generate_weekly_report_groups_by_division_and_profile(monkeypatch, tmp_path):
    _patch_db(monkeypatch, tmp_path)

    telemetry_store.record_event(
        "profile_login",
        "profile-a",
        "Road Safety",
        occurred_at="2026-05-18T09:00:00+00:00",
    )
    telemetry_store.record_event(
        "project_opened",
        "profile-a",
        "Road Safety",
        project_name="AMK AVE 8",
        occurred_at="2026-05-18T09:10:00+00:00",
    )
    telemetry_store.record_event(
        "project_created",
        "profile-b",
        "Transport Planning",
        project_name="Serangoon Avenue 1",
        occurred_at="2026-05-19T10:00:00+00:00",
    )

    report = telemetry_store.generate_weekly_report(
        "2026-05-18T00:00:00+00:00",
        "2026-05-25T00:00:00+00:00",
    )

    assert report["summary"]["total_events"] == 3
    assert report["summary"]["active_profiles"] == 2
    assert report["summary"]["division_count"] == 2
    assert report["event_totals"]["project_opened"] == 1
    assert report["remote_export"]["status"] == "not_configured"
    assert report["profiles"][0]["last_active_at"] >= report["profiles"][1]["last_active_at"]
    assert any(item["division"] == "Road Safety" for item in report["divisions"])


def test_generate_weekly_report_derives_daily_and_usage_metrics(monkeypatch, tmp_path):
    _patch_db(monkeypatch, tmp_path)

    telemetry_store.record_event(
        "profile_login",
        "profile-a",
        "Road Safety",
        occurred_at="2026-05-18T09:00:00+00:00",
    )
    telemetry_store.record_event(
        "page_view",
        "profile-a",
        "Road Safety",
        payload={"page": "/home"},
        occurred_at="2026-05-18T09:01:00+00:00",
    )
    telemetry_store.record_event(
        "project_created",
        "profile-a",
        "Road Safety",
        project_name="AMK AVE 8",
        payload={"duration_ms": 1800, "used_selection_geometry": True},
        occurred_at="2026-05-18T09:05:00+00:00",
    )
    telemetry_store.record_event(
        "autocode_single_requested",
        "profile-a",
        "Road Safety",
        project_name="AMK AVE 8",
        payload={"saved": True, "field_count": 6, "changed_field_count": 4},
        occurred_at="2026-05-18T09:10:00+00:00",
    )
    telemetry_store.record_event(
        "manual_corrections_saved",
        "profile-a",
        "Road Safety",
        project_name="AMK AVE 8",
        payload={"changed_row_count": 2, "changed_cell_count": 5},
        occurred_at="2026-05-18T09:12:00+00:00",
    )
    telemetry_store.record_event(
        "project_deleted",
        "profile-a",
        "Road Safety",
        project_name="Old Project",
        occurred_at="2026-05-18T09:15:00+00:00",
    )
    telemetry_store.record_event(
        "treatments_applied",
        "profile-a",
        "Road Safety",
        project_name="AMK AVE 8",
        payload={"mode": "segment", "segment_count": 1, "treatment_ids": [1, 9]},
        occurred_at="2026-05-18T09:18:00+00:00",
    )

    report = telemetry_store.generate_weekly_report(
        "2026-05-18T00:00:00+00:00",
        "2026-05-25T00:00:00+00:00",
    )

    assert report["daily_activity"] == [
        {
            "date": "2026-05-18",
            "total_events": 7,
            "login_count": 1,
            "session_count_proxy": 1,
            "unique_active_profiles": 1,
            "page_view_count": 1,
        }
    ]
    assert report["derived_metrics"]["projects_deleted"] == 1
    assert report["derived_metrics"]["page_views"] == 1
    assert report["derived_metrics"]["single_item_autocode_runs"] == 1
    assert report["derived_metrics"]["manual_correction_events"] == 1
    assert report["derived_metrics"]["manual_correction_rows"] == 2
    assert report["derived_metrics"]["manual_correction_cells"] == 5
    assert report["derived_metrics"]["workflows_using_imported_geometry"] == 1
    assert report["derived_metrics"]["project_creation_duration"]["average_ms"] == 1800.0
    assert report["derived_metrics"]["most_used_pages"] == [{"page": "/home", "visit_count": 1}]
    assert report["derived_metrics"]["most_used_treatments"] == [
        {"treatment_id": 1, "application_count": 1},
        {"treatment_id": 9, "application_count": 1},
    ]


def test_generate_weekly_report_reflects_remote_export_configuration(monkeypatch, tmp_path):
    _patch_db(monkeypatch, tmp_path)
    monkeypatch.setenv(
        "PSAT_REPORT_WEB_APP_URL",
        "https://script.google.com/macros/s/example/exec",
    )
    monkeypatch.setenv("PSAT_UPLOAD_SECRET", "secret-123")

    report = telemetry_store.generate_weekly_report(
        "2026-05-18T00:00:00+00:00",
        "2026-05-25T00:00:00+00:00",
    )

    assert report["remote_export"]["status"] == "configured"
    assert report["remote_export"]["destination"] == "https://script.google.com/macros/s/example/exec"


def test_upload_weekly_report_persists_uploaded_batch(monkeypatch, tmp_path):
    _patch_db(monkeypatch, tmp_path)
    monkeypatch.setenv(
        "PSAT_REPORT_WEB_APP_URL",
        "https://script.google.com/macros/s/example/exec",
    )
    monkeypatch.setenv("PSAT_UPLOAD_SECRET", "secret-123")

    class FakeResponse:
        status_code = 200
        text = '{"status":"ok"}'

        def json(self):
            return {
                "status": "ok",
                "spreadsheet_id": "sheet-123",
                "spreadsheet_url": "https://docs.google.com/spreadsheets/d/sheet-123/edit",
            }

        def raise_for_status(self):
            return None

    monkeypatch.setattr(telemetry_store.requests, "post", lambda *args, **kwargs: FakeResponse())

    report = telemetry_store.generate_weekly_report(
        "2026-05-18T00:00:00+00:00",
        "2026-05-25T00:00:00+00:00",
    )
    telemetry_store.upload_weekly_report(report)

    assert report["remote_export"]["status"] == "uploaded"
    assert report["remote_export"]["pending_batches"] == 0
    assert report["remote_export"]["response"]["spreadsheet_id"] == "sheet-123"

    conn = telemetry_store._connect()
    try:
        rows = conn.execute("SELECT status, destination, payload_json FROM report_batches").fetchall()
    finally:
        conn.close()

    assert len(rows) == 1
    assert rows[0]["status"] == "uploaded"
    assert rows[0]["destination"] == "https://script.google.com/macros/s/example/exec"


def test_upload_weekly_report_marks_failed_batch(monkeypatch, tmp_path):
    _patch_db(monkeypatch, tmp_path)
    monkeypatch.setenv(
        "PSAT_REPORT_WEB_APP_URL",
        "https://script.google.com/macros/s/example/exec",
    )
    monkeypatch.setenv("PSAT_UPLOAD_SECRET", "secret-123")

    class FakeResponse:
        status_code = 500
        text = "server exploded"

        def json(self):
            return {"error": "server exploded"}

        def raise_for_status(self):
            raise telemetry_store.requests.HTTPError("500 Server Error", response=self)

    monkeypatch.setattr(telemetry_store.requests, "post", lambda *args, **kwargs: FakeResponse())

    report = telemetry_store.generate_weekly_report(
        "2026-05-18T00:00:00+00:00",
        "2026-05-25T00:00:00+00:00",
    )

    try:
        telemetry_store.upload_weekly_report(report)
    except RuntimeError as exc:
        assert "HTTP 500" in str(exc)
    else:
        raise AssertionError("Expected upload_weekly_report to fail on HTTP errors")

    assert report["remote_export"]["status"] == "failed"
    assert report["remote_export"]["pending_batches"] == 1
    assert "HTTP 500" in report["remote_export"]["error"]

    conn = telemetry_store._connect()
    try:
        rows = conn.execute("SELECT status, payload_json FROM report_batches").fetchall()
    finally:
        conn.close()

    assert len(rows) == 1
    assert rows[0]["status"] == "failed"


def test_upload_weekly_report_marks_failed_batch_on_error_payload(monkeypatch, tmp_path):
    _patch_db(monkeypatch, tmp_path)
    monkeypatch.setenv(
        "PSAT_REPORT_WEB_APP_URL",
        "https://script.google.com/macros/s/example/exec",
    )
    monkeypatch.setenv("PSAT_UPLOAD_SECRET", "secret-123")

    class FakeResponse:
        status_code = 200
        text = '{"status":"error","error":"Bad secret"}'

        def json(self):
            return {"status": "error", "error": "Bad secret"}

        def raise_for_status(self):
            return None

    monkeypatch.setattr(telemetry_store.requests, "post", lambda *args, **kwargs: FakeResponse())

    report = telemetry_store.generate_weekly_report(
        "2026-05-18T00:00:00+00:00",
        "2026-05-25T00:00:00+00:00",
    )

    try:
        telemetry_store.upload_weekly_report(report)
    except RuntimeError as exc:
        assert "Bad secret" in str(exc)
    else:
        raise AssertionError("Expected upload_weekly_report to fail on error payloads")

    assert report["remote_export"]["status"] == "failed"
    assert report["remote_export"]["response"]["status"] == "error"
    assert report["remote_export"]["error"] == "Bad secret"


def test_upload_weekly_report_marks_failed_batch_on_non_json_response(monkeypatch, tmp_path):
    _patch_db(monkeypatch, tmp_path)
    monkeypatch.setenv(
        "PSAT_REPORT_WEB_APP_URL",
        "https://script.google.com/macros/s/example/exec",
    )
    monkeypatch.setenv("PSAT_UPLOAD_SECRET", "secret-123")

    class FakeResponse:
        status_code = 200
        text = "<html><body>Script function not found: doPost</body></html>"

        def json(self):
            raise ValueError("not json")

        def raise_for_status(self):
            return None

    monkeypatch.setattr(telemetry_store.requests, "post", lambda *args, **kwargs: FakeResponse())

    report = telemetry_store.generate_weekly_report(
        "2026-05-18T00:00:00+00:00",
        "2026-05-25T00:00:00+00:00",
    )

    try:
        telemetry_store.upload_weekly_report(report)
    except RuntimeError as exc:
        assert "Script function not found: doPost" in str(exc)
    else:
        raise AssertionError("Expected upload_weekly_report to fail on non-JSON HTML responses")

    assert report["remote_export"]["status"] == "failed"
    assert report["remote_export"]["response"]["non_json"] is True
    assert "Script function not found: doPost" in report["remote_export"]["error"]


def test_generate_weekly_report_rejects_invalid_window(monkeypatch, tmp_path):
    _patch_db(monkeypatch, tmp_path)

    try:
        telemetry_store.generate_weekly_report(
            "2026-05-25T00:00:00+00:00",
            "2026-05-18T00:00:00+00:00",
        )
    except ValueError as exc:
        assert "window_end" in str(exc)
    else:
        raise AssertionError("Expected generate_weekly_report to reject an invalid window")