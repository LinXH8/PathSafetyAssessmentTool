# 4. Troubleshooting & Health

This section covers how to check system health, read logs, and diagnose common issues.

---

## Table of Contents

- [4.1 Health Endpoints](#41-health-endpoints)
- [4.2 Reading Logs](#42-reading-logs)
- [4.3 Common Issues](#43-common-issues)

---

### 4.1 Health Endpoints

Two endpoints are available to verify the backend is responsive and models are loaded:

| Endpoint | Returns |
|---|---|
| `/api/health` | `{"status": "ok"}` when backend is up and models loaded |
| `/api/ping` | Simple liveness check |

Query these from a browser or `curl` to confirm the service is running before investigating further.

### 4.2 Reading Logs

If auto-coding fails or the backend behaves unexpectedly, check the server logs:

```
docker compose logs -f backend
```

This streams live output from the Flask backend, including full Python stack traces for any unhandled exceptions. Look for lines starting with `ERROR` or `Traceback` to identify the root cause.

For a specific time window, use:

```
docker compose logs --since 1h backend
```

### 4.3 Common Issues

| Symptom | Likely cause | Fix |
|---|---|---|
| Auto-code returns no results | CV model failed to load | Check logs for model load errors; verify `.pt` files are present in `backend/models/` |
| GIS attributes not updating | Shapefile missing or wrong CRS | Verify shapefile exists in `backend/shapefiles/`; check it uses EPSG:4326 or EPSG:3414 |
| `/api/health` returns 500 | Backend crashed on startup | Run `docker compose logs backend` immediately after startup for the traceback |
| Frontend shows blank page | Build error or API unreachable | Check browser console; verify backend container is running |
| Segments not loading in Coding | Project metadata corrupt | Check `profiles/<slug>/projects/<name>/project_metadata.json` for invalid JSON |

> For a full troubleshooting reference covering Docker startup, model loading, `in/` folder setup, polygon road selection, and scoring issues, see the [Developer Guide → 8. Common Issues](../developer/common-issues.md).
