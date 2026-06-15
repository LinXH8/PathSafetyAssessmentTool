from __future__ import annotations

from flask import jsonify, request

from . import bp
from app.services import profile_store
from app.services import telemetry_store


_CLIENT_ACTIVITY_EVENT_TYPES = {"page_view"}


def _invalidate_project_context() -> None:
    try:
        from app.api.projects import routes as project_routes
    except Exception as exc:
        print(f"[Profiles] Failed to import project routes for context invalidation: {exc}", flush=True)
        return

    invalidate = getattr(project_routes, "invalidate_ctx", None)
    if callable(invalidate):
        try:
            invalidate()
        except Exception as exc:
            print(f"[Profiles] Failed to invalidate project context: {exc}", flush=True)


def _record_profile_event(
    event_type: str,
    profile: dict,
    payload: dict | None = None,
    *,
    project_name: str | None = None,
) -> None:
    try:
        telemetry_store.record_event(
            event_type,
            profile["id"],
            profile["division"],
            project_name=project_name,
            payload=payload,
        )
    except Exception as exc:
        print(f"[Telemetry] Failed to record '{event_type}': {exc}", flush=True)


def _profile_error_status(exc: ValueError) -> int:
    return 404 if str(exc) == "Profile not found" else 400


@bp.get("")
def list_profiles():
    return jsonify(profile_store.get_overview())


@bp.post("")
def create_profile():
    data = request.get_json(silent=True) or {}
    try:
        profile = profile_store.create_profile(data.get("name"), data.get("pin"), data.get("division"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    _record_profile_event("profile_created", profile)

    return jsonify({"profile": profile, "overview": profile_store.get_overview()}), 201


@bp.post("/login")
def login_profile():
    data = request.get_json(silent=True) or {}
    try:
        profile = profile_store.login_profile(str(data.get("profile_id") or ""), str(data.get("pin") or ""))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 404
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 401

    _record_profile_event("profile_login", profile)

    _invalidate_project_context()
    return jsonify({"active_profile": profile, "overview": profile_store.get_overview()})


@bp.post("/logout")
def logout_profile():
    active_profile = profile_store.get_active_profile()
    profile_store.logout_profile()
    if active_profile is not None:
        _record_profile_event("profile_logout", active_profile)
    _invalidate_project_context()
    return jsonify({"ok": True, "overview": profile_store.get_overview()})


@bp.post("/activity")
def record_profile_activity():
    data = request.get_json(silent=True) or {}
    event_type = str(data.get("event_type") or "").strip()
    if event_type not in _CLIENT_ACTIVITY_EVENT_TYPES:
        return jsonify({"error": "Unsupported activity event"}), 400

    payload = data.get("payload")
    if payload is not None and not isinstance(payload, dict):
        return jsonify({"error": "payload must be an object"}), 400

    project_name = str(data.get("project_name") or "").strip() or None
    active_profile = profile_store.get_active_profile()
    if active_profile is None:
        return jsonify({"ok": True, "recorded": False})

    _record_profile_event(event_type, active_profile, payload, project_name=project_name)
    return jsonify({"ok": True, "recorded": True})


@bp.patch("/<profile_id>")
def update_profile(profile_id: str):
    data = request.get_json(silent=True) or {}
    try:
        profile = profile_store.update_profile(
            profile_id,
            str(data.get("current_pin") or ""),
            data.get("name"),
            data.get("division"),
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), _profile_error_status(exc)
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 401

    _record_profile_event("profile_updated", profile)
    return jsonify({"profile": profile, "overview": profile_store.get_overview()})


@bp.post("/<profile_id>/reset-pin")
def reset_profile_pin(profile_id: str):
    data = request.get_json(silent=True) or {}
    try:
        profile = profile_store.reset_profile_pin(
            profile_id,
            str(data.get("current_pin") or ""),
            str(data.get("new_pin") or ""),
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), _profile_error_status(exc)
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 401

    _record_profile_event("profile_pin_reset", profile)
    return jsonify({"profile": profile, "overview": profile_store.get_overview()})


@bp.delete("/<profile_id>")
def delete_profile(profile_id: str):
    data = request.get_json(silent=True) or {}
    try:
        profile_store.delete_profile(profile_id, str(data.get("pin") or ""))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), _profile_error_status(exc)
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 401

    _invalidate_project_context()
    return jsonify({"ok": True, "overview": profile_store.get_overview()})


@bp.post("/migrate-legacy-projects")
def migrate_legacy_projects():
    data = request.get_json(silent=True) or {}
    profile_id = str(data.get("profile_id") or profile_store.get_active_profile_id() or "")
    if not profile_id:
        return jsonify({"error": "A profile must be active before moving legacy projects"}), 400

    raw_project_names = data.get("project_names")
    if raw_project_names is not None and not isinstance(raw_project_names, list):
        return jsonify({"error": "project_names must be an array"}), 400

    try:
        result = profile_store.move_legacy_projects_to_profile(profile_id, raw_project_names)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 404

    _invalidate_project_context()
    return jsonify({**result, "overview": profile_store.get_overview()})