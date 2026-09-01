"""Per-browser sessions and the ``/api/*`` login gate.

PSAT started life as a single-user desktop app where "logged in" was one
process-wide value. On a shared server that means the last person to enter a
PIN owns the session for *everyone*, and nothing stops an unauthenticated
client from calling any route. This module makes the PIN login mean something
per browser:

* the active profile lives in Flask's signed cookie session (see
  ``services/profile_store.py``), so each browser carries its own login;
* every ``/api/*`` request must carry a session naming an existing profile,
  except the handful of routes needed *before* login: the health probes, the
  landing page's profile list / create / login, and the PIN- or email-verified
  profile-management routes the landing page offers ("Manage Selected",
  "Forgot PIN?").

The signing key comes from ``PSAT_SECRET_KEY`` or, failing that, a random key
generated once and stored next to the profile registry so a restart does not
log everyone out. Rotating the key (or deleting the file) invalidates every
existing cookie by design.
"""

from __future__ import annotations

import logging
import os
import secrets
from pathlib import Path

from flask import Flask, jsonify, request

from app.services import paths, profile_store

logger = logging.getLogger(__name__)

# Marker header on the gate's 401s. The SPA keys off this to drop its active
# profile; a wrong-PIN 401 from the profile-management routes carries no marker
# and must NOT log the browser out.
AUTH_HEADER = "X-PSAT-Auth"
AUTH_HEADER_LOGIN_REQUIRED = "login-required"

_SECRET_FILE = ".secret_key"
_SECRET_ENV = "PSAT_SECRET_KEY"
_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}

# ``<blueprint>.<view function>`` names, matched against ``request.endpoint``
# (populated by URL matching before ``before_request`` runs, so immune to
# trailing-slash / encoding variations). See api/profiles/routes.py and
# api/health.py. Logout is idempotent and stays open so a browser whose cookie
# already died does not get a "Logout failed" toast on its way out.
_PUBLIC_ENDPOINTS = frozenset(
    {
        "health.ping",
        "health.health",
        "profiles.list_profiles",
        "profiles.create_profile",
        "profiles.login_profile",
        "profiles.logout_profile",
        "profiles.update_profile",       # requires the current PIN
        "profiles.reset_profile_pin",    # requires the current PIN
        "profiles.recover_profile_pin",  # requires the recovery email
        "profiles.delete_profile",       # requires the PIN
    }
)


def _secret_key_path() -> Path:
    # Under profiles/ rather than the user-data root itself: in the compose
    # deployment only profiles/, data/, in/ and Generated Reports/ are bind
    # mounts, so anywhere else would be wiped by `docker compose up --build`
    # and log everyone out. profile_store's registry guard ignores non-dirs
    # and dot-names, so the file does not disturb it.
    return paths.profiles_dir() / _SECRET_FILE


def load_or_create_secret_key() -> str:
    env_key = os.environ.get(_SECRET_ENV, "").strip()
    if env_key:
        return env_key

    path = _secret_key_path()
    try:
        existing = path.read_text(encoding="utf-8").strip()
        if len(existing) >= 32:
            return existing
    except OSError:
        pass

    key = secrets.token_hex(32)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(path.name + ".tmp")
    tmp_path.write_text(key, encoding="utf-8")
    try:
        os.chmod(tmp_path, 0o600)
    except OSError:
        pass
    tmp_path.replace(path)
    logger.info("Generated session secret key at %s", path)
    return key


def configure_session(app: Flask) -> None:
    """Install the signing key and the environment-dependent cookie flags.

    The static cookie settings (name, HttpOnly, SameSite, lifetime) live in
    ``config.Config``; only what depends on the runtime environment is set here.
    """
    app.config["SECRET_KEY"] = load_or_create_secret_key()
    # Browser cookies are scoped by host, not port. Two PSAT instances on one
    # machine (the packaged bundle on :8000 next to a source checkout on :8001)
    # would otherwise overwrite each other's login on every sign-in, so the
    # cookie name carries the port the instance serves on.
    port = os.environ.get("PSAT_PORT", "").strip() or "8000"
    app.config["SESSION_COOKIE_NAME"] = f"{app.config.get('SESSION_COOKIE_NAME') or 'psat_session'}_{port}"
    # The pilot may run on plain HTTP, where a Secure cookie is never sent back
    # and login silently fails. Opt in once TLS is in front of the app.
    app.config["SESSION_COOKIE_SECURE"] = os.environ.get("PSAT_COOKIE_SECURE", "").lower() in (
        "1",
        "true",
        "yes",
    )


def auth_disabled() -> bool:
    """``PSAT_AUTH_DISABLED=1`` switches the login gate off -- on a loopback bind only.

    Exists for the maintainers' seed-data pipeline
    (``scripts/bundle/preprune_seed_data.ps1``), which drives a throwaway
    backend on 127.0.0.1 with no browser and no profile and creates the
    pre-seeded road projects in the legacy ``data/`` root. On any other bind
    address the flag is ignored with a warning, so it can never open a shared
    server by accident.
    """
    if os.environ.get("PSAT_AUTH_DISABLED", "").strip() != "1":
        return False
    host = os.environ.get("PSAT_HOST", "127.0.0.1").strip().lower()
    if host in _LOOPBACK_HOSTS:
        return True
    logger.warning("PSAT_AUTH_DISABLED=1 ignored: PSAT_HOST=%s is not a loopback address", host)
    return False


def register_auth_gate(app: Flask) -> None:
    """Reject ``/api/*`` requests without a session naming an existing profile.

    Registered on the app (not a blueprint): Flask runs app-level
    ``before_request`` hooks before blueprint-level ones, so this precedes the
    projects blueprint's context warm-up.
    """
    if auth_disabled():
        logger.warning(
            "Login gate DISABLED (PSAT_AUTH_DISABLED=1 on a loopback bind): every /api/* route is open"
        )
        return

    @app.before_request
    def _require_login():
        if not request.path.startswith("/api/"):
            return None  # the SPA and its assets (webui.py)
        if request.method == "OPTIONS" or request.endpoint is None:
            return None  # CORS preflight; unknown URL -> Flask's own 404/405
        if request.endpoint in _PUBLIC_ENDPOINTS:
            return None

        profile_id = profile_store.get_active_profile_id()
        if profile_id and not profile_store.profile_exists(profile_id):
            # Stale cookie (profile deleted, registry restored from backup...).
            # Clearing the session here makes Flask drop the cookie on this
            # very response.
            profile_store.logout_profile()
            profile_id = None

        if not profile_id:
            response = jsonify({"error": "Not logged in"})
            response.status_code = 401
            response.headers[AUTH_HEADER] = AUTH_HEADER_LOGIN_REQUIRED
            return response
        return None
