from .projects import bp as projects_bp
from .profiles import bp as profiles_bp
from .health import bp as health_bp
from .cycleRAP import bp as cyclerap_bp
from .report import bp as report_bp

def register_blueprints(app):
    app.register_blueprint(projects_bp, url_prefix="/api/projects")
    app.register_blueprint(profiles_bp, url_prefix="/api/profiles")
    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(cyclerap_bp, url_prefix="/api/cyclerap")
    app.register_blueprint(report_bp, url_prefix="/api/report")
    # shapefiles blueprint is optional in some setups (e.g., missing folder in
    # source tree). Import lazily and register only if available to avoid
    # crashing the whole app on import-time ModuleNotFoundError.
    try:
        from .gis_layers import bp as shapefiles_bp
    except Exception as e:
        app.logger.error(f"Failed to load optional blueprint 'gis_layers': {e}")
        import traceback
        app.logger.error(traceback.format_exc())
    else:
        app.register_blueprint(shapefiles_bp, url_prefix="/api/shapefiles")

    # defects blueprint depends on backend/data/defects/defect_summary.xlsx;
    # register only if the module imports cleanly so a missing data file
    # does not crash the whole app.
    try:
        from .defects import bp as defects_bp
    except Exception:
        app.logger.warning("Optional blueprint 'defects' not available; skipping")
    else:
        app.register_blueprint(defects_bp, url_prefix="/api/defects")
