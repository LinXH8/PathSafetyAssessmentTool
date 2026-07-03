import os

from app import create_app
app = create_app()

@app.get("/api/health")
def health():
    return {"status": "ok"}

if __name__ == "__main__":
    # The auto-reloader watches the whole backend/ tree. Several endpoints write
    # into subdirectories of backend/ during a request — shapefile uploads extract
    # zip contents into backend/temp_uploads/ (preview) and backend/shapefiles/
    # (save). Those file writes were being detected as a "code change" and
    # triggered a reload MID-REQUEST, resetting the connection (the shapefile
    # import in Create Project failed with a network/error toast for exactly this
    # reason). Exclude the data/upload directories from the reloader watch so
    # runtime file writes never restart the server.
    _base = os.path.dirname(os.path.abspath(__file__))
    _reloader_exclude = [
        os.path.join(_base, "temp_uploads", "*"),
        os.path.join(_base, "shapefiles", "*"),
        os.path.join(_base, "temp", "*"),
        os.path.join(_base, "profiles", "*"),
        os.path.join(_base, "data", "*"),
    ]
    app.run(
        host="0.0.0.0",
        port=8000,
        debug=False,
        use_reloader=True,
        threaded=True,
        exclude_patterns=_reloader_exclude,
    )