#!/usr/bin/env bash
# sync_docs.sh — Copy docs/ canonical source → frontend/public/docs/
#
# Run this after editing any file under docs/ to update the in-app Help page.
# The in-app Help fetches markdown from /docs/... paths served from
# frontend/public/docs/, so frontend/public/docs/ must mirror the user/admin/
# developer subtrees of docs/ (archive/ is excluded — it is not in-app content).
#
# Usage:
#   bash scripts/sync_docs.sh          # from repo root
#   npm run docs:sync                  # from frontend/ (calls this script)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$REPO_ROOT/docs"
DST="$REPO_ROOT/frontend/public/docs"

if ! command -v rsync &>/dev/null; then
  echo "Error: rsync is not installed. Please install rsync and retry." >&2
  exit 1
fi

mkdir -p "$DST/user" "$DST/admin" "$DST/developer"

rsync -av --delete "$SRC/user/"      "$DST/user/"
rsync -av --delete "$SRC/admin/"     "$DST/admin/"
rsync -av --delete "$SRC/developer/" "$DST/developer/"

echo ""
echo "Sync complete: docs/ → frontend/public/docs/"
echo "Commit the updated frontend/public/docs/ together with any docs/ edits."
