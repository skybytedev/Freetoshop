#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "== JavaScript (Vitest) =="
npm test

echo
echo "== Python (SAM server, demo mode) =="
if [[ ! -x "$ROOT/sam-server/.venv/bin/python" ]]; then
  echo "Missing sam-server/.venv — create it before Python tests."
  exit 1
fi
SAM_DEMO=1 "$ROOT/sam-server/.venv/bin/python" -m unittest discover -s tests -p "test_*.py" -v

echo
echo "All tests passed."
