#!/usr/bin/env bash
set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
RUN="$ROOT/.run"

stop_pidfile() {
  local file="$1" name="$2"
  [[ -f "$file" ]] || return 0
  local pid
  pid="$(cat "$file" 2>/dev/null || true)"
  if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    echo "Stopped $name ($pid)"
  fi
  rm -f "$file"
}

stop_pidfile "$RUN/editor.pid" "editor"
stop_pidfile "$RUN/sam.pid" "SAM"

# Catch stragglers we started on the usual ports.
for port in 8080 8765; do
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "$pids" | xargs kill 2>/dev/null || true
    echo "Freed port $port"
  fi
done
