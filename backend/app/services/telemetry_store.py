from __future__ import annotations

import datetime as dt
import json
import os
import sqlite3
import threading
import uuid
from collections import Counter
from pathlib import Path

import requests


def _json_loads_dict(value: str | None) -> dict:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _coerce_int(value: object, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


_DB_LOCK = threading.RLock()
_SCHEMA_VERSION = 1


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _telemetry_root() -> Path:
    # Writable state (sqlite db + upload config) -- must follow the user-data
    # root, not the install tree. Unchanged in a source checkout.
    import app.services.paths as paths
    return paths.profiles_dir()


def _telemetry_db_path() -> Path:
    return _telemetry_root() / "telemetry.sqlite3"


def _remote_export_config_path() -> Path:
    return _telemetry_root() / "report-upload.json"


def _utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _isoformat(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).isoformat()


def _coerce_datetime(value: dt.datetime | str | None) -> dt.datetime:
    if value is None:
        return _utc_now()
    if isinstance(value, dt.datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=dt.timezone.utc)
        return value.astimezone(dt.timezone.utc)
    parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def _load_remote_export_config() -> dict:
    file_config: dict = {}
    config_path = _remote_export_config_path()
    if config_path.exists():
        try:
            with open(config_path, "r", encoding="utf-8") as handle:
                parsed = json.load(handle)
            if isinstance(parsed, dict):
                file_config = parsed
        except Exception:
            file_config = {}

    web_app_url = str(
        os.getenv("PSAT_REPORT_WEB_APP_URL")
        or os.getenv("PSAT_REPORT_UPLOAD_URL")
        or file_config.get("web_app_url")
        or file_config.get("upload_url")
        or ""
    ).strip()
    upload_secret = str(
        os.getenv("PSAT_UPLOAD_SECRET")
        or file_config.get("upload_secret")
        or ""
    ).strip()
    timeout_seconds_raw = (
        os.getenv("PSAT_REPORT_UPLOAD_TIMEOUT_SECONDS")
        or file_config.get("timeout_seconds")
        or 30
    )
    try:
        timeout_seconds = max(1, int(timeout_seconds_raw))
    except (TypeError, ValueError):
        timeout_seconds = 30

    enabled = bool(web_app_url and upload_secret)
    return {
        "enabled": enabled,
        "web_app_url": web_app_url or None,
        "upload_secret": upload_secret or None,
        "timeout_seconds": timeout_seconds,
        "destination": web_app_url or None,
    }


def _connect() -> sqlite3.Connection:
    db_path = _telemetry_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    _ensure_schema(conn)
    return conn


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS activity_events (
            event_id TEXT PRIMARY KEY,
            occurred_at TEXT NOT NULL,
            event_type TEXT NOT NULL,
            profile_id TEXT NOT NULL,
            division TEXT NOT NULL,
            project_name TEXT,
            install_id TEXT NOT NULL,
            payload_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS report_batches (
            batch_id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            window_start TEXT NOT NULL,
            window_end TEXT NOT NULL,
            status TEXT NOT NULL,
            destination TEXT,
            payload_json TEXT NOT NULL DEFAULT '{}'
        );
        """
    )
    conn.execute(
        "INSERT OR IGNORE INTO metadata(key, value) VALUES ('schema_version', ?)",
        (str(_SCHEMA_VERSION),),
    )
    conn.execute(
        "INSERT OR IGNORE INTO metadata(key, value) VALUES ('installation_id', ?)",
        (uuid.uuid4().hex,),
    )
    conn.commit()


def get_installation_id() -> str:
    with _DB_LOCK:
        conn = _connect()
        try:
            row = conn.execute("SELECT value FROM metadata WHERE key = 'installation_id'").fetchone()
            return str(row["value"] if row else "")
        finally:
            conn.close()


def record_event(
    event_type: str,
    profile_id: str,
    division: str,
    *,
    project_name: str | None = None,
    payload: dict | None = None,
    occurred_at: dt.datetime | str | None = None,
) -> str:
    event_id = uuid.uuid4().hex
    occurred = _isoformat(_coerce_datetime(occurred_at))
    payload_json = json.dumps(payload or {}, sort_keys=True)

    with _DB_LOCK:
        conn = _connect()
        try:
            install_id = get_installation_id()
            conn.execute(
                """
                INSERT INTO activity_events(
                    event_id, occurred_at, event_type, profile_id, division,
                    project_name, install_id, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event_id,
                    occurred,
                    str(event_type or "").strip(),
                    str(profile_id or "").strip(),
                    str(division or "").strip() or "Unassigned",
                    str(project_name or "").strip() or None,
                    install_id,
                    payload_json,
                ),
            )
            conn.commit()
            return event_id
        finally:
            conn.close()


def pending_batch_count() -> int:
    with _DB_LOCK:
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT COUNT(*) AS count FROM report_batches WHERE status != 'uploaded'"
            ).fetchone()
            return int(row["count"] if row else 0)
        finally:
            conn.close()


def _create_report_batch(
    window_start: str,
    window_end: str,
    *,
    status: str,
    destination: str | None,
    payload: dict | None = None,
) -> str:
    batch_id = uuid.uuid4().hex
    created_at = _isoformat(_utc_now())
    payload_json = json.dumps(payload or {}, sort_keys=True)

    with _DB_LOCK:
        conn = _connect()
        try:
            conn.execute(
                """
                INSERT INTO report_batches(
                    batch_id, created_at, window_start, window_end, status, destination, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (batch_id, created_at, window_start, window_end, status, destination, payload_json),
            )
            conn.commit()
            return batch_id
        finally:
            conn.close()


def _update_report_batch(
    batch_id: str,
    *,
    status: str,
    destination: str | None,
    payload: dict | None = None,
) -> None:
    payload_json = json.dumps(payload or {}, sort_keys=True)

    with _DB_LOCK:
        conn = _connect()
        try:
            conn.execute(
                """
                UPDATE report_batches
                SET status = ?, destination = ?, payload_json = ?
                WHERE batch_id = ?
                """,
                (status, destination, payload_json, batch_id),
            )
            conn.commit()
        finally:
            conn.close()


def _parse_remote_response(response: requests.Response) -> dict:
    try:
        parsed = response.json()
    except ValueError:
        text = (response.text or "").strip()
        return {
            "status_code": response.status_code,
            "non_json": True,
            "raw_text": text[:1000] if text else None,
        }

    if isinstance(parsed, dict):
        result = dict(parsed)
    else:
        result = {"data": parsed}
    result.setdefault("status_code", response.status_code)
    return result


def _format_remote_request_error(exc: requests.RequestException) -> str:
    response = getattr(exc, "response", None)
    if response is not None:
        try:
            body = (response.text or "").strip()
        except Exception:
            body = ""
        if body:
            if len(body) > 500:
                body = body[:500] + "..."
            return f"HTTP {response.status_code}: {body}"
        return f"HTTP {response.status_code}"

    message = str(exc).strip()
    return message or exc.__class__.__name__


def _apply_remote_export_status(
    report: dict,
    *,
    status: str,
    destination: str | None,
    batch_id: str | None = None,
    attempted_at: str | None = None,
    uploaded_at: str | None = None,
    response_payload: dict | None = None,
    error: str | None = None,
) -> dict:
    remote_export = report.setdefault("remote_export", {})
    remote_export["status"] = status
    remote_export["destination"] = destination
    remote_export["pending_batches"] = pending_batch_count()

    if batch_id is not None:
        remote_export["batch_id"] = batch_id
    if attempted_at is not None:
        remote_export["attempted_at"] = attempted_at
    if uploaded_at is not None:
        remote_export["uploaded_at"] = uploaded_at
    else:
        remote_export.pop("uploaded_at", None)
    if response_payload is not None:
        remote_export["response"] = response_payload
    else:
        remote_export.pop("response", None)
    if error is not None:
        remote_export["error"] = error
    else:
        remote_export.pop("error", None)

    return report


def _remote_response_error(response_payload: dict) -> str | None:
    if response_payload.get("non_json"):
        raw_text = str(response_payload.get("raw_text") or "").strip()
        if raw_text:
            lowered = raw_text.lower()
            if "script function not found" in lowered:
                return raw_text
            return f"Remote receiver returned a non-JSON response: {raw_text}"
        return "Remote receiver returned a non-JSON response."

    status = str(response_payload.get("status") or "").strip().lower()
    if status in {"error", "failed"}:
        detail = str(response_payload.get("error") or response_payload.get("message") or "").strip()
        return detail or "Remote receiver returned an error response."
    if response_payload.get("ok") is False:
        detail = str(response_payload.get("error") or response_payload.get("message") or "").strip()
        return detail or "Remote receiver reported ok=false."
    return None


def upload_weekly_report(report: dict) -> dict:
    remote_export_config = _load_remote_export_config()
    destination = remote_export_config["destination"]

    if not remote_export_config["enabled"]:
        _apply_remote_export_status(
            report,
            status="not_configured",
            destination=destination,
            error="Remote export is not configured.",
        )
        raise RuntimeError(
            "Remote export is not configured. Set PSAT_REPORT_WEB_APP_URL and PSAT_UPLOAD_SECRET, "
            "or create profiles/report-upload.json."
        )

    window = report.get("window") or {}
    window_start = str(window.get("start") or "").strip()
    window_end = str(window.get("end") or "").strip()
    if not window_start or not window_end:
        raise ValueError("Report window is missing start/end timestamps")

    attempted_at = _isoformat(_utc_now())
    batch_payload = {
        "attempted_at": attempted_at,
        "installation_id": ((report.get("installation") or {}).get("installation_id")),
        "report_type": report.get("report_type"),
        "summary": report.get("summary") or {},
    }
    batch_id = _create_report_batch(
        window_start,
        window_end,
        status="pending",
        destination=destination,
        payload=batch_payload,
    )

    request_payload = {
        "secret": remote_export_config["upload_secret"],
        "batch": {
            "batch_id": batch_id,
            "attempted_at": attempted_at,
            "window_start": window_start,
            "window_end": window_end,
            "report_type": report.get("report_type"),
            "installation_id": ((report.get("installation") or {}).get("installation_id")),
        },
        "report": report,
    }
    headers = {
        "Content-Type": "application/json",
        "X-PSAT-Upload-Secret": str(remote_export_config["upload_secret"] or ""),
    }

    try:
        response = requests.post(
            str(remote_export_config["web_app_url"]),
            json=request_payload,
            headers=headers,
            timeout=remote_export_config["timeout_seconds"],
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        error_message = _format_remote_request_error(exc)
        failed_payload = dict(batch_payload)
        failed_payload["error"] = error_message
        _update_report_batch(
            batch_id,
            status="failed",
            destination=destination,
            payload=failed_payload,
        )
        _apply_remote_export_status(
            report,
            status="failed",
            destination=destination,
            batch_id=batch_id,
            attempted_at=attempted_at,
            error=error_message,
        )
        raise RuntimeError(f"Remote export failed: {error_message}") from exc

    response_payload = _parse_remote_response(response)
    response_error = _remote_response_error(response_payload)
    if response_error:
        failed_payload = dict(batch_payload)
        failed_payload["error"] = response_error
        failed_payload["response"] = response_payload
        _update_report_batch(
            batch_id,
            status="failed",
            destination=destination,
            payload=failed_payload,
        )
        _apply_remote_export_status(
            report,
            status="failed",
            destination=destination,
            batch_id=batch_id,
            attempted_at=attempted_at,
            response_payload=response_payload,
            error=response_error,
        )
        raise RuntimeError(f"Remote export failed: {response_error}")

    uploaded_at = _isoformat(_utc_now())
    uploaded_payload = dict(batch_payload)
    uploaded_payload["uploaded_at"] = uploaded_at
    uploaded_payload["response"] = response_payload
    _update_report_batch(
        batch_id,
        status="uploaded",
        destination=destination,
        payload=uploaded_payload,
    )
    return _apply_remote_export_status(
        report,
        status="uploaded",
        destination=destination,
        batch_id=batch_id,
        attempted_at=attempted_at,
        uploaded_at=uploaded_at,
        response_payload=response_payload,
    )


def generate_weekly_report(window_start: dt.datetime | str, window_end: dt.datetime | str) -> dict:
    start = _coerce_datetime(window_start)
    end = _coerce_datetime(window_end)
    if end <= start:
        raise ValueError("window_end must be after window_start")

    remote_export_config = _load_remote_export_config()

    start_iso = _isoformat(start)
    end_iso = _isoformat(end)

    with _DB_LOCK:
        conn = _connect()
        try:
            install_id = get_installation_id()
            rows = conn.execute(
                """
                SELECT occurred_at, event_type, profile_id, division, project_name, payload_json
                FROM activity_events
                WHERE occurred_at >= ? AND occurred_at < ?
                ORDER BY occurred_at ASC
                """,
                (start_iso, end_iso),
            ).fetchall()
        finally:
            conn.close()

    event_totals: Counter[str] = Counter()
    profiles: dict[str, dict] = {}
    divisions: dict[str, dict] = {}
    daily_activity: dict[str, dict] = {}
    page_totals: Counter[str] = Counter()
    treatment_totals: Counter[int] = Counter()
    manual_correction_events = 0
    manual_correction_rows = 0
    manual_correction_cells = 0
    project_creation_durations_ms: list[int] = []
    workflows_using_imported_geometry = 0

    for row in rows:
        profile_id = str(row["profile_id"])
        division = str(row["division"] or "Unassigned")
        event_type = str(row["event_type"])
        occurred_at = str(row["occurred_at"])
        project_name = str(row["project_name"] or "") or None
        payload = _json_loads_dict(row["payload_json"])
        occurred_dt = _coerce_datetime(occurred_at)
        day_key = occurred_dt.date().isoformat()

        event_totals[event_type] += 1

        day_summary = daily_activity.setdefault(
            day_key,
            {
                "date": day_key,
                "total_events": 0,
                "login_count": 0,
                "page_view_count": 0,
                "profile_ids": set(),
            },
        )
        day_summary["total_events"] += 1
        day_summary["profile_ids"].add(profile_id)
        if event_type == "profile_login":
            day_summary["login_count"] += 1
        if event_type == "page_view":
            day_summary["page_view_count"] += 1

        if event_type == "page_view":
            page = str(payload.get("page") or "").strip() or "unknown"
            page_totals[page] += 1

        if event_type == "manual_corrections_saved":
            manual_correction_events += 1
            manual_correction_rows += _coerce_int(payload.get("changed_row_count"))
            manual_correction_cells += _coerce_int(payload.get("changed_cell_count"))

        if event_type == "project_created":
            duration_ms = _coerce_int(payload.get("duration_ms"), default=-1)
            if duration_ms >= 0:
                project_creation_durations_ms.append(duration_ms)
            if payload.get("used_selection_geometry"):
                workflows_using_imported_geometry += 1

        if event_type == "treatments_applied":
            treatment_counts = payload.get("treatment_counts")
            if isinstance(treatment_counts, dict):
                for treatment_id, count in treatment_counts.items():
                    numeric_id = _coerce_int(treatment_id, default=-1)
                    if numeric_id > 0:
                        treatment_totals[numeric_id] += max(0, _coerce_int(count))
            else:
                segment_count = max(1, _coerce_int(payload.get("segment_count"), default=1))
                raw_treatment_ids = payload.get("treatment_ids")
                if isinstance(raw_treatment_ids, list):
                    for treatment_id in raw_treatment_ids:
                        numeric_id = _coerce_int(treatment_id, default=-1)
                        if numeric_id > 0:
                            treatment_totals[numeric_id] += segment_count

        profile_summary = profiles.setdefault(
            profile_id,
            {
                "profile_id": profile_id,
                "division": division,
                "last_active_at": occurred_at,
                "total_events": 0,
                "event_totals": Counter(),
                "projects_touched": set(),
            },
        )
        profile_summary["division"] = division
        profile_summary["last_active_at"] = max(profile_summary["last_active_at"], occurred_at)
        profile_summary["total_events"] += 1
        profile_summary["event_totals"][event_type] += 1
        if project_name:
            profile_summary["projects_touched"].add(project_name)

        division_summary = divisions.setdefault(
            division,
            {
                "division": division,
                "profile_ids": set(),
                "total_events": 0,
                "last_active_at": occurred_at,
                "event_totals": Counter(),
            },
        )
        division_summary["profile_ids"].add(profile_id)
        division_summary["total_events"] += 1
        division_summary["last_active_at"] = max(division_summary["last_active_at"], occurred_at)
        division_summary["event_totals"][event_type] += 1

    profile_list = []
    for profile_summary in profiles.values():
        profile_list.append(
            {
                "profile_id": profile_summary["profile_id"],
                "division": profile_summary["division"],
                "last_active_at": profile_summary["last_active_at"],
                "total_events": profile_summary["total_events"],
                "event_totals": dict(sorted(profile_summary["event_totals"].items())),
                "projects_touched": sorted(profile_summary["projects_touched"]),
            }
        )
    profile_list.sort(key=lambda item: (item["last_active_at"], item["profile_id"]), reverse=True)

    division_list = []
    for division_summary in divisions.values():
        division_list.append(
            {
                "division": division_summary["division"],
                "profile_count": len(division_summary["profile_ids"]),
                "last_active_at": division_summary["last_active_at"],
                "total_events": division_summary["total_events"],
                "event_totals": dict(sorted(division_summary["event_totals"].items())),
            }
        )
    division_list.sort(key=lambda item: item["division"].lower())

    daily_activity_list = []
    for day_summary in sorted(daily_activity.values(), key=lambda item: item["date"]):
        daily_activity_list.append(
            {
                "date": day_summary["date"],
                "total_events": day_summary["total_events"],
                "login_count": day_summary["login_count"],
                "session_count_proxy": day_summary["login_count"],
                "unique_active_profiles": len(day_summary["profile_ids"]),
                "page_view_count": day_summary["page_view_count"],
            }
        )

    if project_creation_durations_ms:
        project_creation_duration = {
            "count": len(project_creation_durations_ms),
            "average_ms": round(sum(project_creation_durations_ms) / len(project_creation_durations_ms), 2),
            "minimum_ms": min(project_creation_durations_ms),
            "maximum_ms": max(project_creation_durations_ms),
        }
    else:
        project_creation_duration = {
            "count": 0,
            "average_ms": None,
            "minimum_ms": None,
            "maximum_ms": None,
        }

    most_used_pages = [
        {"page": page, "visit_count": count}
        for page, count in sorted(page_totals.items(), key=lambda item: (-item[1], item[0]))
    ]
    most_used_treatments = [
        {"treatment_id": treatment_id, "application_count": count}
        for treatment_id, count in sorted(treatment_totals.items(), key=lambda item: (-item[1], item[0]))
    ]

    return {
        "schema_version": 1,
        "generated_at": _isoformat(_utc_now()),
        "report_type": "weekly_activity_summary",
        "installation": {
            "installation_id": install_id,
            "scope": "single_device",
        },
        "window": {
            "start": start_iso,
            "end": end_iso,
        },
        "remote_export": {
            "status": "configured" if remote_export_config["enabled"] else "not_configured",
            "destination": remote_export_config["destination"],
            "pending_batches": pending_batch_count(),
        },
        "summary": {
            "total_events": len(rows),
            "active_profiles": len(profile_list),
            "division_count": len(division_list),
        },
        "daily_activity": daily_activity_list,
        "derived_metrics": {
            "session_count_proxy": event_totals.get("profile_login", 0),
            "projects_created": event_totals.get("project_created", 0),
            "projects_opened": event_totals.get("project_opened", 0),
            "projects_deleted": event_totals.get("project_deleted", 0),
            "page_views": event_totals.get("page_view", 0),
            "single_item_autocode_runs": event_totals.get("autocode_single_requested", 0),
            "full_project_autocode_runs": event_totals.get("autocode_bulk_requested", 0),
            "manual_correction_events": manual_correction_events,
            "manual_correction_rows": manual_correction_rows,
            "manual_correction_cells": manual_correction_cells,
            "workflows_using_imported_geometry": workflows_using_imported_geometry,
            "project_creation_duration": project_creation_duration,
            "most_used_pages": most_used_pages,
            "most_used_treatments": most_used_treatments,
        },
        "event_totals": dict(sorted(event_totals.items())),
        "divisions": division_list,
        "profiles": profile_list,
    }