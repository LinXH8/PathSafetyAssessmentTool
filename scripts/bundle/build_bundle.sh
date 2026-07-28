#!/usr/bin/env bash
#
# Build the portable PSAT bundle on macOS / Linux — the Unix counterpart of
# build_bundle.ps1 (the Windows build). Together they are the "dual build system".
#
# CRITICAL PLATFORM CAVEAT — read before relying on this:
#   The frozen `python/` component (conda-pack) is the CURRENT machine's
#   interpreter + native binaries (torch, GDAL, fiona...). A macOS build produces
#   a macOS interpreter; a Linux build a Linux one. It CANNOT run on Windows.
#   So this script's `python/` output is only for macOS/Linux TARGETS or local
#   testing — never to update the Windows fleet.
#
#   Every OTHER component is platform-independent (backend = Python source,
#   webui = built React, models = weights, shapefiles = data), and clients compare
#   CONTENT digests. So a Unix machine CAN build a valid `--skip-python` update for
#   the Windows fleet: run with --no-python and package with make_release.py
#   --skip-python. The Windows machines' existing frozen interpreter runs the new
#   source. (Only a dependency change — a new/updated `python/` component — must be
#   built on Windows.)
#
# Layout produced (full build):
#     <out>/PSAT/
#       python/    frozen, relocated CPython + deps (conda-pack + conda-unpack)  [omitted with --no-python]
#       backend/   app code + models/ + shapefiles/                             [GIS omitted with --skip-gis]
#       webui/     built React bundle                                           [omitted with --skip-frontend]
#       launcher/  launch_psat.py
#       PSAT.command  double-click entry point (macOS/Linux)
#
# Writable state is NOT here: it lives under the user-data root at runtime
# (see backend/app/services/paths.py).
#
# Usage:
#   scripts/bundle/build_bundle.sh --out-dir temp/PSAT-build            # full local bundle
#   scripts/bundle/build_bundle.sh --out-dir temp/PSAT-build --no-python --skip-frontend --skip-gis
#                                                                       # backend-only update bundle
#
# Flags:
#   --out-dir DIR        Staging directory (default: temp/PSAT-build). Needs ~10 GB for a full build.
#   --conda-env NAME|PATH  conda env to freeze (default: $CONDA_PREFIX or "psat"). Ignored with --no-python.
#   --skip-env           Reuse an already-packed python/ (the slow ~4 GB step).
#   --skip-frontend      Reuse existing frontend/dist; if none, omit webui/ from the bundle.
#   --no-webui           Do NOT build OR include webui/ (produces a backend-only update — avoids
#                        shipping a rebuilt/mismatched frontend when only the backend changed).
#   --no-python          Do NOT build the frozen interpreter (and skip its smoke test). For
#                        building platform-independent update components on a machine without the env.
#   --skip-gis           Do NOT copy models/ and shapefiles/ into the bundle (lean backend-only update).
#   -h | --help          Show this help.

set -euo pipefail

# ── args ──────────────────────────────────────────────────────────────────────
OUT_DIR="temp/PSAT-build"
CONDA_ENV="${CONDA_DEFAULT_ENV:-psat}"
SKIP_ENV=0
SKIP_FRONTEND=0
NO_WEBUI=0
NO_PYTHON=0
SKIP_GIS=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --out-dir)     OUT_DIR="$2"; shift 2 ;;
        --conda-env)   CONDA_ENV="$2"; shift 2 ;;
        --skip-env)    SKIP_ENV=1; shift ;;
        --skip-frontend) SKIP_FRONTEND=1; shift ;;
        --no-webui)    NO_WEBUI=1; shift ;;
        --no-python)   NO_PYTHON=1; shift ;;
        --skip-gis)    SKIP_GIS=1; shift ;;
        -h|--help)     sed -n '2,52p' "$0"; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; exit 2 ;;
    esac
done

# ── helpers ───────────────────────────────────────────────────────────────────
c_cyan='\033[36m'; c_red='\033[31m'; c_green='\033[32m'; c_yellow='\033[33m'; c_off='\033[0m'
step() { printf "\n${c_cyan}=== %s ===${c_off}\n" "$1"; }
info() { printf "    %s\n" "$1"; }
die()  { printf "${c_red}ERROR: %s${c_off}\n" "$1" >&2; exit 1; }

dir_bytes() { [[ -d "$1" ]] && { du -sk "$1" 2>/dev/null | awk '{print $1*1024}'; } || echo 0; }
human_mb()  { awk -v b="$1" 'BEGIN{ printf "%.0f", b/1048576 }'; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# Resolve OUT_DIR relative to the repo root when it is not absolute.
case "$OUT_DIR" in /*) : ;; *) OUT_DIR="$REPO_ROOT/$OUT_DIR" ;; esac
BUNDLE_ROOT="$OUT_DIR/PSAT"

# ── preflight ─────────────────────────────────────────────────────────────────
step "Preflight"
[[ -f "$REPO_ROOT/backend/app.py" ]] || die "repo root looks wrong: $REPO_ROOT"
if [[ "$SKIP_GIS" -eq 0 ]]; then
    [[ -d "$REPO_ROOT/backend/shapefiles" ]] || die "missing GIS shapefiles: $REPO_ROOT/backend/shapefiles (or pass --skip-gis)"
    [[ -d "$REPO_ROOT/backend/models" ]]     || die "missing YOLO models: $REPO_ROOT/backend/models (or pass --skip-gis)"
fi
info "Repo:    $REPO_ROOT"
info "Bundle:  $BUNDLE_ROOT"
[[ "$NO_PYTHON" -eq 1 ]] && info "Mode:    --no-python (platform-independent components only)"
[[ "$SKIP_GIS" -eq 1 ]] && info "Mode:    --skip-gis (no models/ or shapefiles/)"
mkdir -p "$BUNDLE_ROOT"

# ── 1. Frontend ───────────────────────────────────────────────────────────────
if [[ "$NO_WEBUI" -eq 1 ]]; then
    step "Frontend build"; info "skipped (--no-webui: backend-only bundle)"
elif [[ "$SKIP_FRONTEND" -eq 1 && ! -f "$REPO_ROOT/frontend/dist/index.html" ]]; then
    step "Frontend build"; info "skipped (no dist present; webui will be omitted)"
elif [[ "$SKIP_FRONTEND" -eq 1 ]]; then
    step "Frontend build"; info "skipped (reusing frontend/dist)"
else
    step "Frontend build"
    ( cd "$REPO_ROOT/frontend" && npm run build ) || die "frontend build failed"
    [[ -f "$REPO_ROOT/frontend/dist/index.html" ]] || die "no frontend/dist/index.html after build"
fi

# ── 2. Frozen Python ──────────────────────────────────────────────────────────
PYTHON_DIR="$BUNDLE_ROOT/python"
if [[ "$NO_PYTHON" -eq 1 ]]; then
    step "Frozen Python environment"; info "skipped (--no-python)"
elif [[ "$SKIP_ENV" -eq 1 && -x "$PYTHON_DIR/bin/python" ]]; then
    step "Frozen Python environment"; info "skipped (reusing $PYTHON_DIR)"
else
    step "Frozen Python environment"
    command -v conda-pack >/dev/null 2>&1 || die "conda-pack not found (conda install -c conda-forge conda-pack, or 'pip install conda-pack' inside $CONDA_ENV)"
    [[ -d "$PYTHON_DIR" ]] && { info "removing previous env..."; rm -rf "$PYTHON_DIR"; }
    info "packing (several minutes, ~4 GB)..."
    conda-pack -n "$CONDA_ENV" --format no-archive -o "$PYTHON_DIR" --n-threads -1 \
        || conda-pack -p "$CONDA_ENV" --format no-archive -o "$PYTHON_DIR" --n-threads -1 \
        || die "conda-pack failed for env '$CONDA_ENV'"
    info "running conda-unpack (rebases absolute paths)..."
    ( cd "$PYTHON_DIR" && ./bin/conda-unpack ) || die "conda-unpack failed"
fi

# ── 3. Backend ────────────────────────────────────────────────────────────────
# Ship code + config + version only. User data (data/, profiles/, in/,
# temp_uploads/) must never be baked into the bundle. tests/ and caches are dead
# weight. rsync --exclude with a LEADING SLASH anchors to the transfer root, so we
# exclude only the top-level dirs (the equivalent of robocopy /XD with full paths;
# a bare name would wrongly strip nested app/services/data/, app/api/profiles/).
step "Backend"
BACKEND_DST="$BUNDLE_ROOT/backend"
rm -rf "$BACKEND_DST"; mkdir -p "$BACKEND_DST"
RSYNC_EXCLUDES=(
    --exclude='/data' --exclude='/profiles' --exclude='/in'
    --exclude='/temp_uploads' --exclude='/temp' --exclude='/tests'
    --exclude='/venv' --exclude='/.venv' --exclude='/.pytest_cache'
    --exclude='__pycache__/' --exclude='*.pyc' --exclude='*.log' --exclude='*_log.txt'
)
if [[ "$SKIP_GIS" -eq 1 ]]; then
    RSYNC_EXCLUDES+=(--exclude='/models' --exclude='/shapefiles')
fi
rsync -a "${RSYNC_EXCLUDES[@]}" "$REPO_ROOT/backend/" "$BACKEND_DST/" || die "backend copy failed"

# ── 4. webui ──────────────────────────────────────────────────────────────────
WEBUI_DST="$BUNDLE_ROOT/webui"
rm -rf "$WEBUI_DST"
if [[ "$NO_WEBUI" -eq 1 ]]; then
    step "Web UI"; info "omitted (--no-webui: backend-only bundle)"
elif [[ -f "$REPO_ROOT/frontend/dist/index.html" ]]; then
    step "Web UI"
    rsync -a "$REPO_ROOT/frontend/dist/" "$WEBUI_DST/" || die "webui copy failed"
else
    step "Web UI"; info "omitted (no frontend/dist — expected with --skip-frontend)"
fi

# ── 5. Launcher ───────────────────────────────────────────────────────────────
step "Launcher"
LAUNCHER_DST="$BUNDLE_ROOT/launcher"
mkdir -p "$LAUNCHER_DST"
cp -f "$SCRIPT_DIR/launch_psat.py" "$LAUNCHER_DST/"
# Entry point. Keeps a console so a start-up failure is visible.
cat > "$BUNDLE_ROOT/PSAT.command" <<'EOF'
#!/usr/bin/env bash
cd "$(dirname "$0")"
if [[ -x "./python/bin/python" ]]; then PY="./python/bin/python"; else PY="python3"; fi
"$PY" "./launcher/launch_psat.py" "$@"
EOF
chmod +x "$BUNDLE_ROOT/PSAT.command"

# ── 6. Verify ─────────────────────────────────────────────────────────────────
step "Verify"
required=( "backend/app.py" "backend/version.json"
    "backend/app/services/data/cyclerap_v214_model.json"
    "backend/app/services/data/stm_v214_treatments.json"
    "backend/app/api/profiles" "backend/app/api/tiles.py"
    "backend/app/services/paths.py" "launcher/launch_psat.py" "PSAT.command" )
[[ "$NO_PYTHON" -eq 0 ]] && required+=( "python/bin/python" "python/share/proj" "python/share/gdal" )
[[ "$SKIP_GIS" -eq 0 ]]  && required+=( "backend/models" "backend/shapefiles" )
[[ "$NO_WEBUI" -eq 0 && -f "$REPO_ROOT/frontend/dist/index.html" ]] && required+=( "webui/index.html" "webui/assets" )

missing=()
for rel in "${required[@]}"; do [[ -e "$BUNDLE_ROOT/$rel" ]] || missing+=("$rel"); done
if [[ ${#missing[@]} -gt 0 ]]; then
    printf "${c_red}Missing from bundle:${c_off}\n"; printf "    %s\n" "${missing[@]}"
    die "bundle is incomplete"
fi
info "all required paths present"

if [[ "$NO_PYTHON" -eq 0 ]]; then
    # Strongest check without a browser: import the whole app in the FROZEN interpreter.
    if smoke="$("$BUNDLE_ROOT/python/bin/python" -c "import sys; sys.path.insert(0, r'$BUNDLE_ROOT/backend'); from app import create_app; create_app(); import os; print('SMOKE_OK', os.environ.get('GDAL_DATA') is not None)" 2>&1)" \
        && grep -q "SMOKE_OK" <<<"$smoke"; then
        info "frozen interpreter imports the app cleanly"
        grep -q "SMOKE_OK True" <<<"$smoke" && info "GDAL_DATA bound from the bundled env" \
            || printf "${c_yellow}    WARNING: GDAL_DATA was not bound${c_off}\n"
    else
        printf "%s\n" "$smoke" >&2; die "frozen interpreter could not import the app"
    fi
else
    info "frozen-interpreter smoke test skipped (--no-python)"
fi

# ── report ────────────────────────────────────────────────────────────────────
step "Result"
total=0
for pair in "python (frozen env):$PYTHON_DIR" \
            "backend/shapefiles:$BACKEND_DST/shapefiles" \
            "backend/models:$BACKEND_DST/models" \
            "webui:$WEBUI_DST"; do
    label="${pair%%:*}"; path="${pair#*:}"; b="$(dir_bytes "$path")"
    printf "%-22s %8s MB\n" "$label" "$(human_mb "$b")"; total=$((total + b))
done
bcode=$(( $(dir_bytes "$BACKEND_DST") - $(dir_bytes "$BACKEND_DST/shapefiles") - $(dir_bytes "$BACKEND_DST/models") ))
printf "%-22s %8s MB\n" "backend (code)" "$(human_mb "$bcode")"; total=$((total + bcode))
printf "${c_green}%-22s %8s MB${c_off}\n" "TOTAL" "$(human_mb "$total")"
printf "\nBundle ready: %s\n" "$BUNDLE_ROOT"
[[ "$NO_PYTHON" -eq 0 ]] && printf "Test it with:  %s/PSAT.command\n" "$BUNDLE_ROOT"
