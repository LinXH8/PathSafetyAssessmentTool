# PSAT Cloud Pilot: Capacity Today and Scaling Path

---

## 1. What the pilot supports today

| Activity                                                           | Comfortable limit | What happens past it                                                                                     |
| ------------------------------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------- |
| Registered accounts                                                | ~1,000            | No hard limit; profile registry is one JSON file                                                         |
| Concurrent users browsing, coding, editing segments, saving        | 20 to 30          | Slower page loads                                                                                        |
| Concurrent users running Autocode or creating a project            | 3 to 4            | Each run slows down; requests exceed the 60 s CloudFront origin timeout and the user sees an error       |
| Concurrent heavy operations (Autocode + project creation combined) | 8                 | All 8 backend threads are busy. Every user, including those just browsing, is stalled until one finishes |

Where these numbers come from:

| Setting                   | Value                                        | Location                                                              |
| ------------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| Server                    | 1 EC2 host, `m6i.xlarge` (4 vCPU, 16 GB RAM) | `platform-infra/env/dev/main.tf`                                      |
| Backend                   | 1 Python process, 8 waitress threads         | `backend/app.py` (`DEFAULT_THREADS = 8`, override via `PSAT_THREADS`) |
| CloudFront origin timeout | 60 s (AWS maximum without a quota increase)  | `platform-infra/modules/cloudfront/main.tf`                           |
| nginx proxy timeout       | 3600 s                                       | `frontend/nginx.conf`                                                 |
| Storage                   | 1 × 150 GB gp3 root volume                   | `platform-infra/modules/psat/variables.tf`                            |

---

## 2. Why it cannot simply be scaled up

The application is **not stateless**. Everything a request needs lives inside the single Python process or on the server's local disk, so a second server would have no way to see what the first one is doing.

**State held in memory (lost on restart, invisible to other servers)**

| What                                                                                                         | Where in code                                                         | Why it blocks scaling                                                                                        |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Per-profile project contexts holding the loaded attributes / results / treatment tables as pandas DataFrames | `backend/app/api/projects/_helpers.py` (`_CTXS`)                      | Edits live in one process's memory until saved. Two servers would hold different copies of the same project. |
| "Inference in progress" counter and the queue of metadata updates deferred during Autocode                   | `_helpers.py` (`_INFERENCE_DEPTH`, `_PENDING_METADATA_UPDATES`)       | Counter is per-process. Queued updates are lost if the process dies mid-run.                                 |
| Gradient cache                                                                                               | `backend/app/api/projects/gradient.py` (`_PROJECT_GRADIENT_CACHE`)    | Keyed by project name only, not profile, so same-named projects in two profiles already collide.             |
| Geo-points cache                                                                                             | `backend/app/api/projects/source_folders.py` (`_GEO_POINTS_CACHE`)    | Per-process.                                                                                                 |
| Loaded YOLO models and GIS layers                                                                            | `backend/app/services/prediction.py`, `_helpers.py` (`_GIS_INSTANCE`) | Fine to keep per-process, but they belong in a worker, not the web server.                                   |
| Known-profile-ID set                                                                                         | `backend/app/services/profile_store.py` (`_KNOWN_PROFILE_IDS`)        | Stale on other servers after a profile is created or deleted.                                                |

**State held on local disk (not shared between servers)**

| What                                                              | Path                                                              | Notes                                                                                                 |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Profile registry: profiles, PIN hashes, emails, divisions, shares | `profiles/profiles.json`                                          | Read-modify-write JSON guarded by an in-process lock only.                                            |
| Project metadata                                                  | `<project>/project_metadata.json`                                 | No file locking; concurrent edits are last-writer-wins.                                               |
| Coded segment data                                                | `<project>/<date>/attributes.csv`, `results.csv`, `treatment.csv` | Written by bare `to_csv`; no locking.                                                                 |
| Survey images                                                     | `in/<folder>/*.jpg`                                               | ~28 GB per quarter.                                                                                   |
| Shapefiles, gradient profiles, models                             | `backend/shapefiles/`, `backend/models/`                          | Parquet caches are written next to the shapefiles at runtime.                                         |
| Generated reports                                                 | `Generated Reports/`                                              | Accumulate indefinitely.                                                                              |
| Session secret key                                                | `profiles/.secret_key`                                            | Auto-generated per host unless `PSAT_SECRET_KEY` is set, so login cookies would break across servers. |
| Basemap tile cache, telemetry SQLite, shapefile upload staging    | `tiles/`, `profiles/telemetry.sqlite3`, OS temp dir               | Per-host.                                                                                             |
| Shared projects                                                   | hard-links via `os.link`                                          | Assumes one filesystem.                                                                               |

**Autocode runs inside the web request.** `POST /api/projects/<name>/autocode/all` loads the models, then loops over every segment on the request thread, streaming progress over Server-Sent Events. There is no job ID, no way to resume, and no concurrency cap. If the connection drops, the run is discarded before it saves.

---

## 3. The plan

The work splits into two tracks that share the same phase numbers:

- **Part A, Development side**: changes to the PSAT codebase (`PathSafetyAssessmentTool`). Owned by the application developers.
- **Part B, Cloud side**: changes to AWS infrastructure (`platform-infra` Terraform). Owned by the cloud / platform engineer.

Phases 1 to 4 can each ship to the pilot on their own without breaking the current single-server deployment. Phase 5 is where capacity actually multiplies. Section 3.3 lists what Cloud must hand over before each Development step can be tested.

---

### Part A: Development side

#### Phase 0: Quick wins (1 to 2 days)

- [ ] **Cap concurrent Autocode runs** with a semaphore (start at 3). Return HTTP 429 with a "busy, try again" message instead of letting the 9th run stall everyone. `backend/app/api/projects/autocode.py`
- [ ] **Fix the gradient-cache key** to include profile ID. `backend/app/api/projects/gradient.py`
- [ ] **Show a friendly "server busy" state** in the Autocode progress UI when the backend returns 429. `frontend/src/pages/CodingPage/hooks/useAutocode.ts`
- [ ] Document `PSAT_SECRET_KEY` and `PSAT_THREADS` in `backend/ONBOARDING.md` so the cloud side knows what to inject.

#### Phase 1: Move structured data into PostgreSQL (2 to 3 weeks)

Goal: no application data in JSON or CSV on the server.

Schema (one table per thing that is a file today)

| Table                                                                                        | Replaces                                         |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `profiles` (id, slug, name, pin_hash, pin_salt, email, division, created_at)                 | `profiles.json`                                  |
| `project_shares` (project_id, from_profile, to_profile)                                      | share entries + hard-linked copies               |
| `projects` (id, profile_id, name, source_folder, status, path_key, verified, counters, tags) | `project_metadata.json`                          |
| `project_versions` (id, project_id, snapshot_date)                                           | the `<YYYYMMDD>/` folders                        |
| `segments` (version_id, index, attributes JSONB, results JSONB, treatment JSONB)             | `attributes.csv`, `results.csv`, `treatment.csv` |
| `geo_points` (project_id, index, lat, lon, ...)                                              | `geo_location_points.csv`                        |
| `pending_metadata_updates` (project_id, fields JSONB, created_at)                            | `_PENDING_METADATA_UPDATES`                      |
| `telemetry_events`                                                                           | `telemetry.sqlite3`                              |

Steps

- [ ] Add SQLAlchemy + Alembic to `backend/requirements.txt`; create `backend/app/db/` with models and migrations. Read the connection string from `PSAT_DATABASE_URL`.
- [ ] Rewrite `profile_store.py` against the `profiles` table. Keep the public function names so `api/profiles/routes.py` and `auth.py` do not change.
- [ ] Add a repository layer for `ProjectMetadata` and the three segment tables. `serializer.py` keeps its `parse` / `serialize` names but reads and writes rows instead of files. `project_version.py` `load_all` / `save_all` call the repository.
- [ ] Replace the pending-updates dict with inserts into `pending_metadata_updates`; apply them when the Autocode job finishes (Phase 4) rather than on a process-level counter.
- [ ] Write a one-off migration script that walks `profiles/*/projects/*` and imports every JSON and CSV. Run it against a copy of the pilot data first; keep the files read-only as a fallback for one release.
- [ ] Wrap each save endpoint in a transaction and use `SELECT ... FOR UPDATE` on the project row so two users saving the same project no longer overwrite each other.
- [ ] Keep a local-files backend behind the same repository interface if the desktop bundle (`scripts/bundle`) must keep working.
- [ ] Add a `docker-compose` Postgres service so developers can run the stack locally without RDS.

Files touched: `profile_store.py`, `serializer.py`, `project_version.py`, `project.py`, `project_manager.py`, `_helpers.py`, `api/projects/crud.py`, `treatments.py`, `autocode.py`, `segments.py`, `export.py`, `baseline.py`, `telemetry_store.py`.

#### Phase 2: Move files to shared storage (1 to 2 weeks, can run in parallel with Phase 1)

Goal: the server's disk is disposable.

| Data                                     | Destination                    | Code change                                                                                                                                  |
| ---------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Survey images (`in/`)                    | S3                             | `images.py` and `image_utils.py` resolve keys instead of paths; serve via pre-signed URLs. Uploads in `source_folders.py` go straight to S3. |
| Generated reports                        | S3                             | `generated_reports/routes.py` list / save / serve / delete via boto3.                                                                        |
| Post-treatment photos, shapefile uploads | S3                             | Same pattern.                                                                                                                                |
| Shapefiles, gradient profiles, models    | Baked into the container image | Move the parquet layer cache out of the shapefile tree into `/tmp`.                                                                          |
| Basemap tile cache                       | Drop                           | `tiles.py` streams through without caching to disk.                                                                                          |
| Temp files during import/export          | Container-local `/tmp`         | Already the case for shapefile uploads.                                                                                                      |

Steps

- [ ] Introduce a `storage` service with `get`, `put`, `list`, `delete`, `url_for`, backed by S3 in cloud and by the local folder in the desktop bundle. Every module above calls it instead of `pathlib` / `send_from_directory`. Configure via `PSAT_STORAGE_BUCKET`; empty means local.
- [ ] Remove the bind mounts for `in`, `Generated Reports` and `profiles` from `docker-compose.yml`. Add `.dockerignore` entries so shapefiles and models are copied into the image on purpose, not by accident.
- [ ] Update the one-off migration script to upload existing images and reports to S3 with the same key layout.

#### Phase 3: Remove in-process caches (1 week, after Phase 1)

Goal: any server can answer any request.

- [ ] Delete `_CTXS`, `_CTX_LOCK`, `get_ctx`, `invalidate_ctx`. The `bp.before_request` hook builds a lightweight `ProjectContext` per request from the DB (project row + the version being edited).
- [ ] Replace `_KNOWN_PROFILE_IDS` with a DB lookup (or a 30 s TTL cache; staleness only affects the auth gate).
- [ ] Gradient cache and geo-points cache: keep as per-process TTL caches keyed by `(profile, project)`. Measure. If rebuild cost matters, add a `PSAT_REDIS_URL` option and ask Cloud for ElastiCache.
- [ ] Add a lock around `_ROAD_SECTIONS_GDF` / `_LAYER_CACHE` lazy loads (race on first concurrent call).
- [ ] Set `SESSION_COOKIE_NAME` independent of `PSAT_PORT`.
- [ ] Delete the `move_legacy_projects_to_profile` call on login once the migration script has run.

#### Phase 4: Autocode as a background job (2 weeks, after Phases 1 and 3)

Goal: the web tier never runs inference.

Backend

- [ ] `autocode_jobs` table (Alembic migration): id, project_id, profile_id, mode (`all` / `indices` / `image` / `gis`), options, status (`queued` / `running` / `done` / `failed`), processed, total, errors, result, created_at, finished_at.
- [ ] `POST /autocode/all` inserts a job row, sends the ID to the queue (`PSAT_JOB_QUEUE_URL`), returns `202 {job_id}` immediately.
- [ ] `GET /autocode/jobs/<id>` returns status, processed, total, errors.
- [ ] Worker entrypoint `python -m app.worker`: long-poll SQS, load the project from DB, run the existing `_bulk_gen` loop, update `processed` every 10 rows, write segments back through the Phase 1 repository, apply queued metadata updates, mark `done`.
- [ ] Idempotency: worker checks status before starting so an SQS redelivery does not run the job twice.
- [ ] Delete `enter_inference` / `exit_inference` / `_INFERENCE_DEPTH` and the Phase 0 semaphore.
- [ ] `worker.Dockerfile` that reuses `backend/` with models and shapefiles baked in.

Frontend (small change)

- [ ] `frontend/src/api/autocode.ts`: replace `autocodeAllStream` (SSE reader) with `submitAutocode` + `pollAutocodeJob` (2 s interval). Keep the same `onProgress(processed, total, errors)` callback signature.
- [ ] `useAutocode.ts` (three call sites) and `AutocodeValidation.tsx` keep working because they only consume the callback. Downstream refreshes of `/results`, `/baseline` and `/autocode-metadata` are unchanged.
- [ ] Add a "queued, N ahead of you" state to the progress UI.
- [ ] `nginx.conf`: `proxy_read_timeout` drops from 3600 s to 120 s; `proxy_buffering off` is no longer needed.

Project creation (`POST /api/projects/folders`) uses the same job pattern if it still exceeds 60 s after Phase 2.

#### Phase 5: Make the web container fleet-ready (2 to 3 days)

- [ ] Add `GET /api/health` (no auth) that checks DB connectivity, for the load balancer health check.
- [ ] Confirm every path, secret and endpoint is read from environment variables; nothing from `config.json` at runtime.
- [ ] Remove the startup model warm-up thread from the web image (`_helpers.py` `_warmup_thread`); only the worker loads models.
- [ ] Write a Locust or k6 script that logs in, browses a project, saves a segment and submits an Autocode job, for the Phase 5 load test.

---

### Part B: Cloud side

#### Phase 0: Quick wins on the current server (1 to 2 days)

- [ ] **Store `PSAT_SECRET_KEY`** in SSM Parameter Store (SecureString) and inject it via the EC2 user-data / `.env`. Sessions then survive rebuilds and are ready for multiple servers.
- [ ] **Request the CloudFront origin-timeout quota increase** to 180 s (Service Quotas, "Response timeout per origin").
- [ ] **Upsize the instance** to `m6i.2xlarge` or `m6i.4xlarge` in `env/dev/main.tf` and set `PSAT_THREADS` to match vCPUs.
- [ ] **CloudWatch alarm** on root volume usage at 80 % (CloudWatch agent `disk_used_percent`) so the 150 GB volume cannot fill silently.
- [ ] **Add an S3 lifecycle rule** on the existing `15-psat-assets` bucket for the reports prefix (expire after 12 months).

#### Phase 1: PostgreSQL (3 to 5 days)

- [ ] Add an `rds` module: Postgres 16, `db.t4g.medium` for pilot, gp3 storage, private subnets, Multi-AZ off for pilot (on for prod), automated backups 7 days, deletion protection on.
- [ ] Security group: inbound 5432 only from the PSAT EC2 / ECS security group.
- [ ] Store the connection string in Secrets Manager; expose the secret ARN as a module output. Inject as `PSAT_DATABASE_URL` on the host.
- [ ] Access path for migrations: SSM Session Manager port-forward through the existing EC2 host (same pattern as the Solaris staging bastion), no public endpoint.
- [ ] Hand over to Development: endpoint, secret ARN, and a scratch database for the migration-script dry run.

#### Phase 2: Shared file storage (2 to 3 days, parallel with Phase 1)

- [ ] Extend the `s3` module: prefixes `images/`, `reports/`, `uploads/`, `post-treatment/`; lifecycle rule on `reports/`; versioning on; block public access on.
- [ ] IAM: give the EC2 instance role (later the ECS task role) `GetObject` / `PutObject` / `DeleteObject` / `ListBucket` on the bucket. Retire the `psat-uploader` IAM user and its access key once uploads go through the app.
- [ ] Optional: a second CloudFront origin pointing at the bucket for `images/` so image serving bypasses the web tier. Use an Origin Access Control, not a public bucket.
- [ ] Hand over to Development: bucket name (`PSAT_STORAGE_BUCKET`), prefix layout, and confirmation the role is attached.

#### Phase 3: Caches (0 to 2 days, only if Development asks)

- [ ] If the Phase 3 measurement shows cache rebuilds matter: add an `elasticache` module (Redis 7, `cache.t4g.micro`, private subnet) and expose `PSAT_REDIS_URL`. Otherwise nothing to do.

#### Phase 4: Job queue and worker fleet (1 week)

- [ ] `sqs` module: standard queue `psat-autocode-jobs`, visibility timeout 2 h (a run can approach an hour), dead-letter queue after 3 receives, alarm on DLQ depth.
- [ ] `ecr` module: repositories for `psat-web` and `psat-worker`. Build and push from CI or from the developer's machine (see the buildx gotcha in the deployment notes).
- [ ] `ecs` module, worker service: cluster, task definition for `psat-worker` (4 vCPU / 16 GB on Fargate for CPU, or an EC2 capacity provider on `g4dn.xlarge` for GPU), task role with SQS receive/delete, S3 read/write, Secrets Manager read.
- [ ] Autoscaling on `ApproximateNumberOfMessagesVisible`: 0 tasks when idle, scale out one task per N queued jobs, max to be set by budget.
- [ ] CloudWatch log groups for worker output; alarm on task failures.
- [ ] Hand over to Development: queue URL (`PSAT_JOB_QUEUE_URL`), ECR repository URIs, task role ARN.

#### Phase 5: Stateless web fleet (1 week)

- [ ] `alb` module: Application Load Balancer in public subnets, HTTPS listener with an ACM certificate, target group with health check on `/api/health`, stickiness off.
- [ ] `ecs` web service: `psat-web` task (2 vCPU / 4 GB), minimum 2 tasks, autoscale on CPU or `RequestCountPerTarget`, task role as above minus SQS receive.
- [ ] Networking: VPC with public subnets for the ALB and private subnets for ECS, RDS and Redis; NAT gateway or VPC endpoints for S3, SQS, Secrets Manager, ECR.
- [ ] Repoint the `cloudfront` module's origin from the EC2 public DNS to the ALB. Keep the 60 s origin timeout; nothing should need longer once Autocode is a job.
- [ ] Retire the single EC2 host, its Elastic IP, the DLM snapshot policy and the SSM-only access path. Replace with an ECS Exec or a small bastion for DB access.
- [ ] Copy `env/dev` to `env/prod` with production sizes and Multi-AZ on.
- [ ] Run the load test from Development's Phase 5 script with 200 simulated users before opening to all of TRO.

---

### 3.3 Handoffs between the two tracks

| Phase | Cloud delivers first                          | Then Development can                                            |
| ----- | --------------------------------------------- | --------------------------------------------------------------- |
| 0     | `PSAT_SECRET_KEY` in SSM, bigger instance     | Ship the semaphore and cache fix; no dependency                 |
| 1     | RDS endpoint, Secrets Manager ARN, scratch DB | Run the migration dry run, then cut over                        |
| 2     | Bucket prefixes, IAM role attached            | Switch `PSAT_STORAGE_BUCKET` on and run the image/report upload |
| 3     | Redis URL (only if requested)                 | Point caches at Redis                                           |
| 4     | Queue URL, ECR repos, worker task definition  | Push the worker image and submit the first real job             |
| 5     | ALB + ECS web service, VPC                    | Verify `/api/health`, run the load test                         |

Development can build and test Phases 1, 2 and 4 locally with the Postgres compose service, a local folder as the storage backend, and an in-process queue stub, so the two tracks do not block each other day to day.

---

## 4. Target architecture

```
Browser ── CloudFront ── ALB ── ECS Fargate: web (N × Flask/waitress, stateless)
                                     │            │
                                     │            ├── RDS Postgres  (profiles, projects, segments, jobs)
                                     │            ├── S3            (images, reports, uploads)
                                     │            └── SQS           (autocode jobs)
                                     │                                 │
                                     └──────── ECS: workers (M × inference, CPU or GPU) ◄──┘
                                                   ├── RDS (writes results, progress)
                                                   └── S3 (reads images)
```

Capacity after each phase (estimates, to be confirmed by load test):

| After                            | Concurrent light users | Concurrent Autocode runs                   |
| -------------------------------- | ---------------------- | ------------------------------------------ |
| Today                            | 20 to 30               | 3 to 4                                     |
| Phase 0 (upsize + cap)           | 40 to 60               | 6 to 8, others queued with a clear message |
| Phases 1 to 3 (still one server) | 60 to 100              | unchanged, but no data-corruption risk     |
| Phase 4 (workers)                | 60 to 100              | limited only by worker count               |
| Phase 5 (N web tasks)            | hundreds to 1,000+     | limited only by worker count               |

---

## 5. Sequence and effort summary

| Phase              | Depends on                | Development      | Cloud            | Delivers                                 |
| ------------------ | ------------------------- | ---------------- | ---------------- | ---------------------------------------- |
| 0 Quick wins       | nothing                   | 1 to 2 days      | 1 to 2 days      | Safer pilot, ~2× heavy-op headroom       |
| 1 PostgreSQL       | nothing                   | 2 to 3 weeks     | 3 to 5 days      | No JSON/CSV state, no silent overwrites  |
| 2 S3 storage       | nothing (parallel with 1) | 1 to 2 weeks     | 2 to 3 days      | Disposable server disk, report retention |
| 3 Remove caches    | 1                         | 1 week           | 0 to 2 days      | Any server can serve any request         |
| 4 Autocode workers | 1, 3                      | 2 weeks          | 1 week           | Web tier never blocks on inference       |
| 5 Stateless fleet  | 1 to 4                    | 2 to 3 days      | 1 week           | Horizontal scale to whole of TRO         |
| **Total**          |                           | **7 to 9 weeks** | **3 to 4 weeks** |                                          |

Development is the critical path. Cloud work for each phase can be done ahead of time, so the cloud engineer is never the bottleneck.

Decisions still open

- S3 vs EFS for files (recommendation: S3).
- Redis vs per-request rebuild for caches (recommendation: measure after Phase 3, add Redis only if needed).
- CPU vs GPU workers (recommendation: start CPU on Fargate, benchmark segments per minute, switch to `g4dn` if throughput is the bottleneck).
- Whether the desktop bundle (`scripts/bundle`) must keep working. If yes, the `storage` and repository layers need a local-files backend, which is why the plan keeps the existing function names.
