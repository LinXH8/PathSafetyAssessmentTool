# 1. Deployment & Infrastructure

This section covers how to start the application, manage data persistence, and ensure the system is running correctly.

---

## Table of Contents

- [1.1 Starting the App](#11-starting-the-app)
- [1.2 Data Persistence](#12-data-persistence)

---

### 1.1 Starting the App

The application is typically orchestrated via **Docker Compose**. Run the following command to build and start both the Flask backend and the React frontend:

```
docker compose up --build
```

For direct local launching on Windows, you can use the `Run-PSAT.bat` script in the project root instead.

> Rebuilding with `--build` is recommended after any code or dependency changes. For subsequent starts without changes, `docker compose up` (without `--build`) is faster.

### 1.2 Data Persistence

User-created projects, images, and results are stored in the `data/` directory, which is bind-mounted into the backend container.

**Backing up user data:**

1. Stop the application (`docker compose down`).
2. Copy the entire `data/` directory to a backup location.
3. Restart the application (`docker compose up`).

Restoring from backup is the reverse: stop, replace `data/`, restart. This covers all user projects, coded segments, treatment data, and saved results.
