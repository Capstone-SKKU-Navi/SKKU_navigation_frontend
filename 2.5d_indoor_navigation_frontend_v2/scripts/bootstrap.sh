#!/usr/bin/env bash
# bootstrap.sh — bash mirror of bootstrap.ps1
# Brings up the SKKU 2.5D Navigation full stack: DB → seed → backend → frontend.

set -euo pipefail

SKIP_SEED=0
NO_FRONTEND=0
STOP_DOCKER=0
BACKEND_PATH="${SKKU_BACKEND_DIR:-}"

usage() {
  cat <<'EOF'
Usage: bootstrap.sh [options]
  --backend-path <path>   Override backend repo location (default: ../../SKKU-2.5D-Navigation)
  --skip-seed             Skip seed.py wrapper
  --no-frontend           Bring backend up only
  --stop-docker           docker compose down on exit (default: leave DB up)
  -h, --help              Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend-path) BACKEND_PATH="$2"; shift 2 ;;
    --skip-seed)    SKIP_SEED=1; shift ;;
    --no-frontend)  NO_FRONTEND=1; shift ;;
    --stop-docker)  STOP_DOCKER=1; shift ;;
    -h|--help)      usage; exit 0 ;;
    *) echo "Unknown arg: $1"; usage; exit 2 ;;
  esac
done

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
FRONTEND_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

if [[ -z "$BACKEND_PATH" ]]; then
  BACKEND_PATH="$( cd "$FRONTEND_ROOT/../../SKKU-2.5D-Navigation" 2>/dev/null && pwd || true )"
fi
if [[ -z "$BACKEND_PATH" || ! -d "$BACKEND_PATH" ]]; then
  echo "Backend repo not found. Pass --backend-path or set SKKU_BACKEND_DIR." >&2
  exit 1
fi

GRADLE_CMD="$BACKEND_PATH/gradlew"
[[ -x "$BACKEND_PATH/gradlew" ]] || GRADLE_CMD="$BACKEND_PATH/gradlew.bat"
[[ -f "$GRADLE_CMD" ]] || { echo "gradlew not found at $GRADLE_CMD" >&2; exit 1; }
[[ -f "$BACKEND_PATH/docker-compose.yaml" ]] || { echo "docker-compose.yaml not found in $BACKEND_PATH" >&2; exit 1; }

step() { printf '\n=== %s ===\n' "$1"; }

BACKEND_PID=
cleanup() {
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Stopping backend (PID $BACKEND_PID)..."
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ "$STOP_DOCKER" -eq 1 ]]; then
    echo "Stopping Docker stack..."
    ( cd "$BACKEND_PATH" && docker compose down )
  fi
}
trap cleanup EXIT INT TERM

# ---- Step 1: Docker DB up ----
step "Docker: bringing up PostgreSQL/PostGIS"
( cd "$BACKEND_PATH" && docker compose up -d )
echo "Waiting for DB..."
deadline=$(( $(date +%s) + 60 ))
while [[ $(date +%s) -lt $deadline ]]; do
  if ( cd "$BACKEND_PATH" && docker compose ps 2>/dev/null | grep -E 'db' | grep -qE 'healthy|running|Up' ); then
    echo "DB is up."; break
  fi
  sleep 2
done

# ---- Step 2 + 3: Seed ----
if [[ "$SKIP_SEED" -eq 0 ]]; then
  step "Seed: ensuring psycopg2-binary"
  if ! python -m pip show psycopg2-binary >/dev/null 2>&1; then
    echo "Installing psycopg2-binary..."
    python -m pip install --quiet psycopg2-binary
  fi

  step "Seed: running scripts/seed.py"
  ( cd "$FRONTEND_ROOT" && python scripts/seed.py --backend "$BACKEND_PATH" --frontend "$FRONTEND_ROOT" )
else
  step "Seed: skipped (--skip-seed)"
fi

# ---- Step 4: Backend boot ----
step "Backend: starting Spring Boot (gradlew bootRun)"
BACKEND_LOG="$(mktemp -t skku-backend.XXXXXX.log)"
( cd "$BACKEND_PATH" && "$GRADLE_CMD" bootRun ) >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
echo "Backend job PID: $BACKEND_PID, log: $BACKEND_LOG"

echo "Polling http://localhost:8080/api/nodes ..."
deadline=$(( $(date +%s) + 120 ))
ready=0
while [[ $(date +%s) -lt $deadline ]]; do
  if curl --fail --silent --max-time 3 http://localhost:8080/api/nodes >/dev/null 2>&1; then
    ready=1; break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Backend process died. Last 60 lines of log:" >&2
    tail -n 60 "$BACKEND_LOG" >&2
    exit 1
  fi
  sleep 3
done
if [[ "$ready" -ne 1 ]]; then
  echo "Backend did not respond on :8080 within 120s. Last 60 lines:" >&2
  tail -n 60 "$BACKEND_LOG" >&2
  exit 1
fi
echo "Backend is up."

# ---- Step 5: Smoke test ----
step "Smoke test: /api/nodes and /api/graph"
NODE_COUNT=$(curl --fail --silent http://localhost:8080/api/nodes | grep -oE '"id"' | wc -l | tr -d ' ')
TOTAL_IDS=$(curl --fail --silent http://localhost:8080/api/graph | grep -oE '"id"' | wc -l | tr -d ' ')
EDGES_ONLY=$(( TOTAL_IDS - NODE_COUNT ))
echo "Seeded: $NODE_COUNT nodes, $EDGES_ONLY edges (approx)"
if [[ "$NODE_COUNT" -eq 0 ]]; then
  echo "Seed produced an empty graph; investigate seed.py output and Flyway logs." >&2
  exit 1
fi

# ---- Step 6: Frontend ----
if [[ "$NO_FRONTEND" -eq 1 ]]; then
  step "Frontend: skipped (--no-frontend)"
  echo "Backend running. Press Ctrl+C to stop."
  wait "$BACKEND_PID"
else
  step "Frontend: npm run dev (Webpack on :8082)"
  cd "$FRONTEND_ROOT"
  if [[ ! -d node_modules ]]; then
    echo "Installing npm dependencies..."
    npm install --silent
  fi
  npm run dev
fi
