#!/usr/bin/env bash
# Launch Freetoshop: editor + local SAM 2. Ctrl+C (or ./stop.sh) stops both.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
RUN="$ROOT/.run"
EDITOR_PORT="${EDITOR_PORT-8080}"
SAM_PORT="${SAM_PORT-8765}"
if [[ -z "${EDITOR_PORT}" ]]; then EDITOR_PORT=8080; fi
if [[ -z "${SAM_PORT}" ]]; then SAM_PORT=8765; fi
EDITOR_URL="http://127.0.0.1:${EDITOR_PORT}/"
SAM_URL="http://127.0.0.1:${SAM_PORT}/health"
VENV="$ROOT/sam-server/.venv/bin/python"

mkdir -p "$RUN"

alive() { curl -sf --max-time 1 "$1" >/dev/null 2>&1; }

if [[ ! -x "$VENV" ]]; then
  echo "Missing $VENV"
  echo "From sam-server/:  python3 -m venv .venv && source .venv/bin/activate"
  echo "Then see SAM.md for torch + SAM 2 install."
  exit 1
fi

started_editor=0
started_sam=0

if alive "$EDITOR_URL"; then
  echo "Editor already up at ${EDITOR_URL}"
else
  echo "Starting editor on ${EDITOR_PORT}..."
  (
    cd "$ROOT"
    exec python3 -m http.server "$EDITOR_PORT" --bind 127.0.0.1
  ) >"$RUN/editor.log" 2>&1 &
  echo $! >"$RUN/editor.pid"
  started_editor=1
fi

if alive "$SAM_URL"; then
  echo "SAM already up at ${SAM_URL}"
else
  echo "Starting SAM 2 (first load can take a bit)..."
  (
    cd "$ROOT/sam-server"
    exec "$VENV" server.py --host 127.0.0.1 --port "$SAM_PORT"
  ) >"$RUN/sam.log" 2>&1 &
  echo $! >"$RUN/sam.pid"
  started_sam=1
fi

wait_for() {
  local url="$1" name="$2" tries="${3:-90}"
  local i
  for ((i = 1; i <= tries; i++)); do
    if alive "$url"; then
      echo "$name ready"
      return 0
    fi
    sleep 0.5
  done
  echo "$name did not start. Last log:"
  return 1
}

if ! wait_for "$EDITOR_URL" "Editor" 20; then
  tail -n 20 "$RUN/editor.log" || true
  exit 1
fi

if ! wait_for "$SAM_URL" "SAM" 120; then
  echo "Editor still works without it. SAM log:"
  tail -n 40 "$RUN/sam.log" || true
fi

if command -v open >/dev/null; then
  open "$EDITOR_URL"
elif command -v xdg-open >/dev/null; then
  xdg-open "$EDITOR_URL"
fi

echo
echo "Freetoshop  $EDITOR_URL"
echo "SAM         $SAM_URL"
echo "Stop with Ctrl+C or:  $ROOT/stop.sh"

if [[ "$started_editor" -eq 0 && "$started_sam" -eq 0 ]]; then
  exit 0
fi

cleanup() {
  echo
  echo "Stopping Freetoshop..."
  "$ROOT/stop.sh" || true
}
trap cleanup INT TERM

# Keep this terminal attached so closing it / Ctrl+C shuts the servers down.
while true; do
  if [[ -f "$RUN/editor.pid" ]] && ! kill -0 "$(cat "$RUN/editor.pid")" 2>/dev/null; then
    echo "Editor exited. See $RUN/editor.log"
    break
  fi
  if [[ -f "$RUN/sam.pid" ]] && ! kill -0 "$(cat "$RUN/sam.pid")" 2>/dev/null; then
    echo "SAM exited. See $RUN/sam.log"
    break
  fi
  sleep 2
done
cleanup
