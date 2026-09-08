#!/usr/bin/env bash
# Start Freetoshop with the FastAPI app server (temp / fts / output) + SAM.
# Use this instead of plain python -m http.server when you want session persistence.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
mkdir -p .run temp fts output

APP_HOST="${APP_HOST:-127.0.0.1}"
APP_PORT="${APP_PORT:-8080}"
SAM_HOST="${SAM_HOST:-127.0.0.1}"
SAM_PORT="${SAM_PORT:-8765}"

if [[ -f "$ROOT/stop.sh" ]]; then
  "$ROOT/stop.sh" 2>/dev/null || true
fi
# Also clear our pid files if stop.sh is older
for name in editor sam app; do
  if [[ -f ".run/${name}.pid" ]]; then
    kill "$(cat ".run/${name}.pid")" 2>/dev/null || true
    rm -f ".run/${name}.pid"
  fi
done

VENV_PY="$ROOT/sam-server/.venv/bin/python"
if [[ ! -x "$VENV_PY" ]]; then
  echo "Creating sam-server venv + deps (first run)…"
  python3 -m venv "$ROOT/sam-server/.venv"
  "$VENV_PY" -m pip install -U pip
  "$VENV_PY" -m pip install -r "$ROOT/sam-server/requirements.txt"
fi

echo "Installing app-server deps…"
"$VENV_PY" -m pip install -q -r "$ROOT/app-server/requirements.txt"

echo "Starting app server on http://${APP_HOST}:${APP_PORT}"
(
  cd "$ROOT/app-server"
  nohup env APP_HOST="$APP_HOST" APP_PORT="$APP_PORT" "$VENV_PY" server.py \
    >"$ROOT/.run/editor.log" 2>&1 &
  echo $! >"$ROOT/.run/editor.pid"
)

echo "Starting SAM on http://${SAM_HOST}:${SAM_PORT}"
(
  cd "$ROOT/sam-server"
  nohup "$VENV_PY" server.py --host "$SAM_HOST" --port "$SAM_PORT" \
    >"$ROOT/.run/sam.log" 2>&1 &
  echo $! >"$ROOT/.run/sam.pid"
)

# Health wait
for i in $(seq 1 40); do
  if curl -sf "http://${APP_HOST}:${APP_PORT}/api/health" >/dev/null \
    && curl -sf "http://${SAM_HOST}:${SAM_PORT}/health" >/dev/null; then
    break
  fi
  sleep 0.5
done

echo ""
echo "Editor + sessions:  http://${APP_HOST}:${APP_PORT}/"
echo "Sessions library:   http://${APP_HOST}:${APP_PORT}/sessions"
echo "SAM health:         http://${SAM_HOST}:${SAM_PORT}/health"
echo "Logs: .run/editor.log  .run/sam.log"
echo "Stop with: ./stop.sh   (or kill pids in .run/)"
echo ""

if command -v open >/dev/null 2>&1; then
  open "http://${APP_HOST}:${APP_PORT}/" || true
fi

# Keep foreground like classic start.sh when run in a terminal
if [[ -t 0 ]]; then
  echo "Press Ctrl+C to stop."
  trap '"$ROOT/stop.sh" 2>/dev/null || true; exit 0' INT TERM
  while kill -0 "$(cat .run/editor.pid 2>/dev/null)" 2>/dev/null; do
    sleep 2
  done
fi
