"""PSAT backend entrypoint.

Two modes:

* **Production (default)** -- served by **waitress**, a real WSGI server, with no
  auto-reloader and no debug. This is what the packaged desktop bundle runs.
* **Development** -- set ``PSAT_DEV=1`` to get the Flask dev server with the
  auto-reloader back, for the edit-and-refresh workflow.

Environment overrides: ``PSAT_HOST`` (default ``127.0.0.1``), ``PSAT_PORT``
(default ``8000``), ``PSAT_THREADS`` (default ``8``).

Note ``/api/health`` now lives on the health blueprint rather than here, so it
exists under both entrypoints -- waitress imports ``create_app()`` and never
runs this module's body.
"""

import os

from app import create_app

app = create_app()

# Bind to loopback by default. This is a single-user desktop app: binding
# 0.0.0.0 would publish every project's data to the whole office wifi with no
# authentication in front of it. Docker/compose can still opt out via PSAT_HOST.
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000
DEFAULT_THREADS = 8


def _run_dev(host: str, port: int) -> None:
    """Flask dev server + auto-reloader (PSAT_DEV=1)."""
    # The auto-reloader watches the whole backend/ tree. Several endpoints write
    # into subdirectories of backend/ during a request -- shapefile uploads
    # extract zip contents into backend/temp_uploads/ (preview) and
    # backend/shapefiles/ (save). Those file writes were being detected as a
    # "code change" and triggered a reload MID-REQUEST, resetting the connection
    # (the shapefile import in Create Project failed with a network/error toast
    # for exactly this reason). Exclude the data/upload directories from the
    # reloader watch so runtime file writes never restart the server.
    _base = os.path.dirname(os.path.abspath(__file__))
    _reloader_exclude = [
        os.path.join(_base, "temp_uploads", "*"),
        os.path.join(_base, "shapefiles", "*"),
        os.path.join(_base, "temp", "*"),
        os.path.join(_base, "profiles", "*"),
        os.path.join(_base, "data", "*"),
    ]
    app.run(
        host=host,
        port=port,
        debug=False,
        use_reloader=True,
        threaded=True,
        exclude_patterns=_reloader_exclude,
    )


def _run_prod(host: str, port: int, threads: int) -> None:
    """Production WSGI server."""
    from waitress import serve

    serve(app, host=host, port=port, threads=threads)


if __name__ == "__main__":
    host = os.environ.get("PSAT_HOST", DEFAULT_HOST)
    port = int(os.environ.get("PSAT_PORT", DEFAULT_PORT))

    if os.environ.get("PSAT_DEV") == "1":
        print(f"[PSAT] dev server (auto-reload) on http://{host}:{port}")
        _run_dev(host, port)
    else:
        threads = int(os.environ.get("PSAT_THREADS", DEFAULT_THREADS))
        print(f"[PSAT] waitress on http://{host}:{port} ({threads} threads)")
        _run_prod(host, port, threads)
